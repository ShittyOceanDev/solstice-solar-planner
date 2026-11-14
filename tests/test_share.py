from io import BytesIO
import unittest
from urllib.parse import urlencode

from share import COOKIE_NAME, SharedCalculator


class SharedCalculatorTests(unittest.TestCase):
    origin = 'https://test.trycloudflare.com'
    password = 'example-password'

    def setUp(self):
        self.app = SharedCalculator(self.origin, self.password)

    def request(self, path, method='GET', body=b'', **headers):
        env = {
            'REQUEST_METHOD': method, 'PATH_INFO': path,
            'HTTP_HOST': 'test.trycloudflare.com', 'HTTP_ORIGIN': self.origin,
            'CONTENT_TYPE': 'application/x-www-form-urlencoded',
            'CONTENT_LENGTH': str(len(body)), 'wsgi.input': BytesIO(body),
            **headers,
        }
        response = {}

        def start(status, headers, exc_info=None):
            response.update(status=int(status[:3]), headers=dict(headers))

        result = self.app(env, start)
        try:
            response['body'] = b''.join(result)
        finally:
            if hasattr(result, 'close'):
                result.close()
        return response

    def test_pages_assets_and_apis_require_a_session(self):
        self.assertIn(b'Share password', self.request('/')['body'])
        for path in ('/app.js', '/worker.js', '/offline.js', '/api/weather/jobs', '/api/surroundings/jobs'):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)['status'], 401)
                self.assertEqual(self.request(path, 'POST', b'{}')['status'], 401)

    def test_password_unlocks_browser_app_and_session_ends_on_restart(self):
        body = urlencode({'password': self.password}).encode()
        login = self.request('/_share', 'POST', body)
        self.assertEqual(login['status'], 303)
        self.assertEqual(login['headers']['Location'], '/')
        cookie = login['headers']['Set-Cookie']
        self.assertTrue(cookie.startswith(f'{COOKIE_NAME}='))
        self.assertIn('Path=/; Secure; HttpOnly; SameSite=Lax', cookie)
        session = {'HTTP_COOKIE': cookie.split(';', 1)[0]}
        home = self.request('/', **session)
        self.assertEqual(home['status'], 200)
        self.assertIn("connect-src 'self' https://overpass.private.coffee https://overpass-api.de https://archive-api.open-meteo.com", home['headers']['Content-Security-Policy'])
        self.assertIn(b'BROWSER_DOWNLOADS = true', self.request('/runtime.js', **session)['body'])
        self.assertEqual(self.request('/offline.js', **session)['status'], 200)
        self.assertEqual(self.request('/app.js', **session)['headers']['Cache-Control'], 'no-store')
        self.assertEqual(self.request('/api/weather/jobs', 'POST', b'{}', **session)['status'], 405)
        self.app = SharedCalculator(self.origin, self.password)
        self.assertEqual(self.request('/app.js', **session)['status'], 401)

    def test_login_requires_correct_password_and_same_origin(self):
        password = urlencode({'password': self.password}).encode()
        self.assertEqual(self.request('/_share', 'POST', b'password=wrong')['status'], 401)
        self.assertEqual(self.request('/_share', 'POST', password, HTTP_ORIGIN='null')['status'], 403)
        self.assertEqual(self.request('/_share', 'POST', password, HTTP_HOST='other.example')['status'], 403)
