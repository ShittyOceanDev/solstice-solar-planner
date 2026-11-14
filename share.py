"""Share a password-protected Solstice session through a Cloudflare Quick Tunnel."""

import hmac
from http.cookies import CookieError, SimpleCookie
from pathlib import Path
from queue import Empty, Queue
import re
import secrets
import shutil
from socketserver import ThreadingMixIn
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import Thread
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import urlopen
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

from public_app import SECURITY_HEADERS, PublicApplication, validate_origin


COOKIE_NAME = '__Host-solstice-share'
ORIGIN_PATTERN = re.compile(r'https://[a-z0-9-]+\.trycloudflare\.com(?=\s|["|]|$)')
BROWSER_RUNTIME = b'export const HOSTED = true;\nexport const BROWSER_DOWNLOADS = true;\n'
PROVIDER_ORIGINS = 'https://overpass.private.coffee https://overpass-api.de https://archive-api.open-meteo.com'
LOGIN_PAGE = b'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Solstice | Shared calculator</title>
<style>
  body { font: 1rem system-ui, sans-serif; margin: 12vh auto; padding: 0 1.25rem;
         max-width: 26rem; color: #231f16; background: #fffaf0; }
  label, input, button { display: block; }
  input, button { box-sizing: border-box; font: inherit; padding: .65rem; margin: .5rem 0 1rem; }
  input { width: 100%; }
</style>
</head>
<body>
<h1>Solstice solar calculator</h1>
{message}
<form method="post" action="/_share">
  <label for="password">Share password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Open calculator</button>
</form>
</body>
</html>
'''


class SharedCalculator:
    def __init__(self, origin, password):
        self.origin = validate_origin(origin)
        self.host = urlsplit(self.origin).hostname
        self.password = password.encode('ascii')
        self.session = secrets.token_urlsafe(32)

    def __call__(self, env, start_response):
        method = env['REQUEST_METHOD']
        path = env['PATH_INFO']

        def respond(status, body=b'', headers=(), content_type='text/html; charset=utf-8'):
            start_response(status, [
                ('Content-Type', content_type),
                ('Content-Length', str(len(body))),
                ('Cache-Control', 'no-store'),
                ('X-Robots-Tag', 'noindex'),
                *[(key, value) for key, value in SECURITY_HEADERS if key != 'Referrer-Policy'],
                ('Referrer-Policy', 'same-origin'),
                *headers,
            ])
            return [] if method == 'HEAD' else [body]

        host = self.host
        if env.get('HTTP_HOST', '').lower() not in (host, host + ':443'):
            return respond('403 Forbidden')

        if method == 'POST' and path == '/_share':
            if env.get('HTTP_ORIGIN') != self.origin:
                return respond('403 Forbidden')
            if env.get('CONTENT_TYPE', '').split(';', 1)[0] != 'application/x-www-form-urlencoded':
                return respond('415 Unsupported Media Type')
            try:
                length = int(env.get('CONTENT_LENGTH') or '0')
                if not 0 < length <= 512:
                    return respond('400 Bad Request')
                raw = env['wsgi.input'].read(length)
                if len(raw) != length:
                    return respond('400 Bad Request')
                form = parse_qs(raw.decode('ascii'), max_num_fields=1)
                supplied = form.get('password', [''])[0].encode('utf-8')
            except ValueError:
                return respond('400 Bad Request')
            if not hmac.compare_digest(supplied, self.password):
                return respond('401 Unauthorized', LOGIN_PAGE.replace(
                    b'{message}', b'<p role="alert">That password did not match. Try again.</p>'))
            return respond('303 See Other', headers=[
                ('Location', '/'),
                ('Set-Cookie', f'{COOKIE_NAME}={self.session}; Path=/; Secure; HttpOnly; SameSite=Lax'),
            ])

        cookies = SimpleCookie()
        try:
            cookies.load(env.get('HTTP_COOKIE', ''))
        except CookieError:
            return respond('400 Bad Request')
        session = cookies.get(COOKIE_NAME)
        if session and hmac.compare_digest(session.value.encode('utf-8'), self.session.encode('ascii')):
            if method not in ('GET', 'HEAD'):
                return respond('405 Method Not Allowed', headers=[('Allow', 'GET, HEAD')])
            if path == '/runtime.js':
                return respond('200 OK', BROWSER_RUNTIME, content_type='text/javascript; charset=utf-8')

            def private_response(status, headers, exc_info=None):
                headers = [(
                    key,
                    value.replace("connect-src 'self'", f"connect-src 'self' {PROVIDER_ORIGINS}")
                    if key == 'Content-Security-Policy' else value,
                ) for key, value in headers if key != 'Cache-Control']
                headers.extend([('Cache-Control', 'no-store'), ('X-Robots-Tag', 'noindex')])
                return start_response(status, headers, exc_info)

            return PublicApplication.static(path, method, private_response)

        if method in ('GET', 'HEAD') and path == '/':
            return respond('401 Unauthorized', LOGIN_PAGE.replace(b'{message}', b''))
        return respond('401 Unauthorized')


class LocalServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(15)
        return connection, address


class LocalRequestHandler(WSGIRequestHandler):
    def log_request(self, code='-', size='-'):
        pass


def read_tunnel_url(tunnel, result):
    origin = None
    for line in tunnel.stdout:
        match = ORIGIN_PATTERN.search(line)
        if match:
            if origin is None:
                origin = match.group()
                result.put(origin)
        else:
            print(line, end='', file=sys.stderr)
    if origin is None:
        result.put(None)


def wait_for_password_page(origin, tunnel):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline and tunnel.poll() is None:
        try:
            with urlopen(origin, timeout=4):
                pass
        except HTTPError as error:
            with error:
                if error.code == 401 and b'Share password' in error.read(4096):
                    return
        except (URLError, TimeoutError):
            pass
        time.sleep(1)
    raise RuntimeError('The tunnel did not reach the calculator password page.')


def main():
    cloudflared = shutil.which('cloudflared')
    if cloudflared is None:
        sys.exit('Install cloudflared and run python3 share.py again. See DEPLOYMENT.md.')

    password = secrets.token_urlsafe(18)
    result = Queue()
    with TemporaryDirectory(prefix='solstice-share-') as folder:
        config = Path(folder) / 'cloudflared.yml'
        config.write_text('{}\n', encoding='utf-8')
        with make_server('127.0.0.1', 0, None, LocalServer, LocalRequestHandler) as server:
            local_url = f'http://127.0.0.1:{server.server_port}'
            with subprocess.Popen([
                cloudflared, 'tunnel', '--config', str(config), '--no-autoupdate',
                '--no-chunked-encoding', '--url', local_url,
            ], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace') as tunnel:
                Thread(target=read_tunnel_url, args=(tunnel, result), daemon=True).start()
                serving = None
                try:
                    print('Starting the temporary share…', flush=True)
                    origin = result.get(timeout=45)
                    if origin is None:
                        raise RuntimeError('Cloudflare did not start a Quick Tunnel.')
                    server.set_app(SharedCalculator(origin, password))
                    serving = Thread(target=server.serve_forever, daemon=True)
                    serving.start()
                    wait_for_password_page(origin, tunnel)
                    print(f'\nLink: {origin}\nPassword: {password}\n\nPress Ctrl+C to stop sharing.', flush=True)
                    tunnel.wait()
                    raise RuntimeError('The tunnel stopped. Run the command again for a new link.')
                finally:
                    if tunnel.poll() is None:
                        tunnel.terminate()
                        try:
                            tunnel.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            tunnel.kill()
                    if serving and serving.is_alive():
                        server.shutdown()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nSharing stopped.')
    except Empty:
        sys.exit('Timed out waiting for a Cloudflare Quick Tunnel address.')
    except (OSError, RuntimeError) as error:
        sys.exit(str(error))
