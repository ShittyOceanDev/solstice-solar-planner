"""Host-independent WSGI app for a small public deployment behind managed HTTPS."""
from collections import deque
import datetime as dt
import hashlib
import hmac
from http import HTTPStatus
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import parse_qs, urlsplit
from wsgiref.util import FileWrapper

from download_jobs import DownloadJobs, JobBusy
from map_jobs import MapJobs
from source_registry import fetch_scene, normalize_scene_request
import server
import transport

MAX_BODY = 1024
SECURITY_HEADERS = [
    ('X-Content-Type-Options', 'nosniff'),
    ('Referrer-Policy', 'no-referrer'),
    ('Permissions-Policy', 'geolocation=(), camera=(), microphone=()'),
    ('Content-Security-Policy', "default-src 'self'; script-src 'self' 'sha256-y0joblgLTLFGhbj/xXhGS1SyGmxly/oZpyENyx9LBXI='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"),
    ('X-Frame-Options', 'DENY'),
    ('Cross-Origin-Resource-Policy', 'same-origin'),
    ('Strict-Transport-Security', 'max-age=31536000'),
]

def validate_origin(value):
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError:
        raise ValueError('Set SOLSTICE_PUBLIC_ORIGIN to the site HTTPS origin.') from None
    if (parts.scheme != 'https' or not parts.hostname or parts.username or parts.password
            or parts.path not in ('', '/') or parts.query or parts.fragment
            or port not in (None, 443) or not re.fullmatch(r'[a-zA-Z0-9.-]+', parts.hostname)):
        raise ValueError('Set SOLSTICE_PUBLIC_ORIGIN to the site HTTPS origin, without a path.')
    return f'https://{parts.hostname.lower()}'

class WindowLimit:
    """Bounded rate-limit state; keys are salted hashes, never raw client IPs."""
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.entries = {}
        self.lock = threading.Lock()

    def allow(self, scope, key, limit, seconds):
        now = self.clock()
        with self.lock:
            self.entries = {k: v for k, v in self.entries.items() if v and v[-1] > now - 3600}
            entry_key = (scope, key)
            if entry_key not in self.entries and len(self.entries) >= 1024:
                return False
            times = self.entries.setdefault(entry_key, deque())
            while times and times[0] <= now - seconds:
                times.popleft()
            if len(times) >= limit:
                return False
            times.append(now)
            return True

class PublicApplication:
    def __init__(self, origin):
        self.origin = validate_origin(origin)
        self.host = urlsplit(self.origin).hostname
        self.limits = WindowLimit()
        self.salt = secrets.token_bytes(32)
        self.maps = MapJobs(fetch_scene, normalize_scene_request)
        self.weather = DownloadJobs(server.fetch_weather, server.weather_request, 'weather year',
                                    'Historical weather is unavailable. Please retry later; your project is unchanged.')

    def __call__(self, env, start_response):
        rid = transport.request_id(env.get('HTTP_X_SOLSTICE_REQUEST'))
        method, path = env.get('REQUEST_METHOD', 'GET'), env.get('PATH_INFO', '/')

        def reply(data, status=200, extra=()):
            raw = json.dumps(data, separators=(',', ':'), allow_nan=False).encode()
            headers = [('Content-Type', 'application/json; charset=utf-8'), ('Content-Length', str(len(raw))),
                       ('Cache-Control', 'no-store'), ('X-Solstice-Protocol', transport.PROTOCOL),
                       ('X-Solstice-Request', rid)] + SECURITY_HEADERS + list(extra)
            start_response(f'{status} {HTTPStatus(status).phrase}', headers)
            return [] if method == 'HEAD' else [raw]

        def fail(message, status=400):
            return reply({'error': message}, status)

        # Never trust forwarded Host/IP/Proto headers supplied by clients. The
        # configured external origin handles TLS termination at the managed edge.
        host = env.get('HTTP_HOST', '').lower()
        health = path == '/api/health' and method in ('GET', 'HEAD')
        if host not in (self.host, self.host + ':443'):
            if not (health and re.fullmatch(r'(localhost|127\.0\.0\.1)(:[0-9]{1,5})?', host)):
                return fail('Unrecognized site host.', 403)
        if method not in ('GET', 'HEAD', 'POST'):
            return reply({'error': 'Method not allowed.'}, 405, [('Allow', 'GET, HEAD, POST')])
        if method == 'POST':
            if env.get('HTTP_ORIGIN') != self.origin or env.get('HTTP_SEC_FETCH_SITE') == 'cross-site':
                return fail('Requests must come from this website.', 403)
            if env.get('CONTENT_TYPE', '').split(';')[0].strip().lower() != 'application/json':
                return fail('Send application/json.', 415)
        if path.startswith('/api/') and not health:
            remote = env.get('REMOTE_ADDR', 'unknown')
            key = hmac.new(self.salt, remote.encode(), hashlib.sha256).hexdigest()
            if not self.limits.allow('requests', key, 240, 60) or not self.limits.allow('all-requests', '', 1200, 60):
                return reply({'error': 'The shared service is busy. Please wait one minute and retry.'}, 429, [('Retry-After', '60')])
        try:
            if health:
                return reply({'ok': True, 'last_year': dt.date.today().year - 1, 'surroundings': True,
                              'map_jobs': True, 'weather_jobs': True, 'api_version': 4,
                              'protocol': transport.PROTOCOL, 'sources': ['osm'], 'deployment': 'public'})
            if path == '/runtime.js' and method in ('GET', 'HEAD'):
                raw = b'export const HOSTED = true;\nexport const BROWSER_DOWNLOADS = false;\n'
                start_response('200 OK', [('Content-Type', 'text/javascript; charset=utf-8'),
                    ('Content-Length', str(len(raw))), ('Cache-Control', 'no-store')] + SECURITY_HEADERS)
                return [] if method == 'HEAD' else [raw]
            if path == '/api/diagnostics' and method in ('GET', 'HEAD'):
                # The local server's shared trace must never be exposed publicly.
                return reply({'protocol': transport.PROTOCOL, 'records': [], 'diagnostics': 'browser-only'})
            if path == '/api/diagnostics/probe':
                if method == 'POST':
                    self.read_body(env)
                    size = 0
                else:
                    try:
                        size = int(parse_qs(env.get('QUERY_STRING', '')).get('size', ['64'])[0])
                    except ValueError:
                        size = 64
                    size = max(1, min(65536, size))
                return reply({'probe': True, 'padding': 'x' * size, 'protocol': transport.PROTOCOL})
            if method in ('GET', 'HEAD'):
                for prefix, jobs in (('/api/surroundings/jobs/', self.maps), ('/api/weather/jobs/', self.weather)):
                    if path.startswith(prefix):
                        pieces = path[len(prefix):].split('/')
                        if not re.fullmatch(r'[a-f0-9]{32}', pieces[0]):
                            return fail('Download lookup expired. Please retry.', 404)
                        data = None
                        if len(pieces) == 1:
                            data = jobs.get(pieces[0])
                        elif len(pieces) == 3 and pieces[1] == 'parts' and re.fullmatch(r'[0-9]{1,4}', pieces[2]):
                            data = jobs.part(pieces[0], int(pieces[2]))
                        return reply(data) if data else fail('Download lookup expired. Please retry.', 404)
                if path.startswith('/api/'):
                    return fail('Not found.', 404)
                return self.static(path, method, start_response)
            # Hosted requests always use jobs. Legacy synchronous download and
            # client-trace upload routes are intentionally unavailable.
            route = {'/api/surroundings/jobs': ('map', self.maps), '/api/weather/jobs': ('weather', self.weather)}.get(path)
            if not route:
                return fail('Not found.', 404)
            data = self.read_body(env)
            kind, jobs = route
            data = jobs.normalize(data)  # Reject unknown/private fields before retaining anything.
            per_client, global_limit = (6, 30) if kind == 'map' else (30, 120)
            if not self.limits.allow(kind, key, per_client, 3600) or not self.limits.allow('all-' + kind, '', global_limit, 3600):
                return reply({'error': f'The free shared {kind} download allowance is used up. Try again in an hour, or use data already saved in your browser.'}, 429, [('Retry-After', '3600')])
            return reply(jobs.start(data), 202)
        except JobBusy:
            return reply({'error': 'Another visitor is downloading this kind of data. Please retry shortly; your project is unchanged.'}, 503, [('Retry-After', '30')])
        except (ValueError, KeyError, TypeError, UnicodeError):
            return fail('Invalid request. Refresh the page and check the entered values.')
        except Exception:
            # Do not return stack traces, paths or upstream bodies to visitors.
            return fail('The service could not complete this request. Please retry later; your project is unchanged.', 503)

    @staticmethod
    def read_body(env):
        try:
            length = int(env.get('CONTENT_LENGTH', '0'))
        except ValueError:
            raise ValueError('Invalid request length.') from None
        if not 0 < length <= MAX_BODY:
            raise ValueError('Invalid request length.')
        raw = env['wsgi.input'].read(length)
        if len(raw) != length:
            raise ValueError('Incomplete request.')
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError('Expected an object.')
        return data

    @staticmethod
    def static(path, method, start_response):
        root = server.WEB.resolve()
        relative = 'index.html' if path == '/' else path.lstrip('/')
        target = (root / relative).resolve()
        if ('\\' in relative or any(part.startswith('.') for part in Path(relative).parts)
                or not target.is_relative_to(root) or not target.is_file()):
            raw = b'Not found.'
            start_response('404 Not Found', [('Content-Type', 'text/plain; charset=utf-8'), ('Content-Length', str(len(raw))), ('Cache-Control', 'no-store')] + SECURITY_HEADERS)
            return [] if method == 'HEAD' else [raw]
        content_type = {'js': 'text/javascript', 'css': 'text/css', 'html': 'text/html'}.get(target.suffix[1:]) or mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
        stream = target.open('rb')
        start_response('200 OK', [('Content-Type', content_type), ('Content-Length', str(os.fstat(stream.fileno()).st_size)), ('Cache-Control', 'no-cache')] + SECURITY_HEADERS)
        if method == 'HEAD':
            stream.close()
            return []
        return FileWrapper(stream, 65536)

def create_app():
    return PublicApplication(os.environ.get('SOLSTICE_PUBLIC_ORIGIN', ''))
