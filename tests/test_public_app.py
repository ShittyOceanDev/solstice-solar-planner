import base64
import hashlib
import io
import json
import re
import unittest
from unittest.mock import patch
from public_app import PublicApplication, WindowLimit, validate_origin
import server

class HostedTests(unittest.TestCase):
    def setUp(self):
        self.app = PublicApplication('https://solar.example')

    def request(self, path='/', method='GET', data=None, **changes):
        raw = json.dumps(data).encode() if data is not None else b''
        env = {'REQUEST_METHOD': method, 'PATH_INFO': path.split('?')[0], 'QUERY_STRING': path.partition('?')[2],
               'HTTP_HOST': 'solar.example', 'HTTP_ORIGIN': 'https://solar.example',
               'REMOTE_ADDR': '192.0.2.1', 'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': str(len(raw)),
               'wsgi.input': io.BytesIO(raw), 'wsgi.url_scheme': 'http', **changes}
        captured = {}
        def start(status, headers):
            captured.update(status=int(status[:3]), headers=dict(headers))
        result = self.app(env, start)
        try:
            captured['body'] = b''.join(result)
        finally:
            if hasattr(result, 'close'):
                result.close()
        return captured

    def test_requires_an_explicit_https_origin(self):
        for origin in ('', 'http://solar.example', 'https://solar.example/path', 'https://user:pass@solar.example', 'https://solar.example:123'):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                validate_origin(origin)
        self.assertEqual(validate_origin('https://Solar.Example/'), 'https://solar.example')

    def test_host_and_origin_checks_survive_proxy_tls_termination_and_header_spoofing(self):
        job = {'job': 'a' * 32, 'status': 'loading'}
        with patch.object(self.app.maps, 'start', return_value=job) as start:
            response = self.request('/api/surroundings/jobs', 'POST', {'row': 7126, 'col': 5882})
            self.assertEqual(response['status'], 202)
            for changes in ({'HTTP_HOST': 'evil.example', 'HTTP_X_FORWARDED_HOST': 'solar.example'},
                            {'HTTP_ORIGIN': 'https://evil.example'}, {'HTTP_ORIGIN': ''}, {'HTTP_SEC_FETCH_SITE': 'cross-site'}):
                self.assertEqual(self.request('/api/surroundings/jobs', 'POST', {'row': 7126, 'col': 5882}, **changes)['status'], 403)
            self.assertEqual(start.call_count, 1)

    def test_private_fields_and_removed_sources_never_start_jobs(self):
        with patch.object(self.app.maps, 'start') as start:
            for extra in ({'lat': 52.51}, {'costs': {'hardware': 1234}}, {'source': 'de-bb-lod2'}, {'source': 'auto'}):
                self.assertEqual(self.request('/api/surroundings/jobs', 'POST', {'row': 7126, 'col': 5882, **extra})['status'], 400)
            start.assert_not_called()
        with patch.object(self.app.weather, 'start') as start:
            self.assertEqual(self.request('/api/weather/jobs', 'POST', {'lat': 52.5, 'lon': 13.4, 'grid': .1, 'year': 2025, 'usage': 3600})['status'], 400)
            start.assert_not_called()

    def test_invalid_bodies_and_types_are_bounded(self):
        for changes in ({'CONTENT_LENGTH': '5000'}, {'CONTENT_LENGTH': 'no'}, {'CONTENT_LENGTH': '12', 'wsgi.input': io.BytesIO(b'{}')},
                        {'CONTENT_LENGTH': '2', 'wsgi.input': io.BytesIO(b'[]')}):
            self.assertEqual(self.request('/api/weather/jobs', 'POST', **changes)['status'], 400)
        self.assertEqual(self.request('/api/weather/jobs', 'POST', {}, CONTENT_TYPE='text/plain')['status'], 415)
        self.assertEqual(self.request('/', 'DELETE')['status'], 405)

    def test_static_files_cannot_expose_code_caches_or_hidden_paths(self):
        for path in ('/../server.py', '/%2e%2e/server.py', '/.weather-cache/x', '/.git/config', '/vendor/../../server.py'):
            self.assertEqual(self.request(path)['status'], 404)
        response = self.request('/model.js')
        self.assertEqual(response['status'], 200)
        self.assertEqual(response['headers']['Content-Type'], 'text/javascript')
        self.assertEqual(int(response['headers']['Content-Length']), len(response['body']))
        head = self.request('/model.js', 'HEAD')
        self.assertEqual(head['body'], b'')
        self.assertEqual(head['headers']['Content-Length'], response['headers']['Content-Length'])

    def test_public_runtime_and_health_only_advertise_osm(self):
        self.assertIn(b'HOSTED = true', self.request('/runtime.js')['body'])
        health = json.loads(self.request('/api/health', HTTP_HOST='127.0.0.1:18767')['body'])
        self.assertEqual(health['deployment'], 'public')
        self.assertEqual(health['sources'], ['osm'])
        self.assertNotIn('instance', health)

    def test_diagnostics_do_not_disclose_other_visitors_or_accept_uploads(self):
        response = self.request('/api/diagnostics')
        self.assertEqual(json.loads(response['body'])['records'], [])
        self.assertEqual(self.request('/api/diagnostics/client', 'POST', {})['status'], 404)
        self.assertEqual(self.request('/api/weather', 'POST', {})['status'], 404)
        probe = self.request('/api/diagnostics/probe?size=999999999')
        self.assertLess(len(probe['body']), 66000)

    def test_download_allowance_stops_anonymous_abuse(self):
        with patch.object(self.app.maps, 'start', return_value={'job': 'a' * 32}):
            for _ in range(6):
                self.assertEqual(self.request('/api/surroundings/jobs', 'POST', {'row': 7126, 'col': 5882})['status'], 202)
            last = self.request('/api/surroundings/jobs', 'POST', {'row': 7126, 'col': 5882})
            self.assertEqual(last['status'], 429)
            self.assertEqual(last['headers']['Retry-After'], '3600')
        self.assertNotIn('192.0.2.1', repr(self.app.limits.entries))

    def test_tokenized_poll_and_segment_routes_work_without_synchronous_downloads(self):
        token = 'b' * 32
        with patch.object(self.app.maps, 'get', return_value={'status': 'complete', 'data': {'example': True}}):
            self.assertEqual(json.loads(self.request('/api/surroundings/jobs/' + token)['body'])['status'], 'complete')
        with patch.object(self.app.maps, 'part', return_value={'index': 0, 'parts': 1, 'text': '{}'}):
            self.assertEqual(json.loads(self.request('/api/surroundings/jobs/' + token + '/parts/0')['body'])['text'], '{}')
        self.assertEqual(self.request('/api/surroundings/jobs/not-a-token')['status'], 404)

    def test_script_policy_allows_the_actual_import_map_without_general_inline_scripts(self):
        page = self.request('/')
        policy = page['headers']['Content-Security-Policy']
        inline = re.search(r'<script type="importmap">(.*?)</script>', page['body'].decode()).group(1)
        digest = base64.b64encode(hashlib.sha256(inline.encode()).digest()).decode()
        script_policy = policy.split('script-src ')[1].split(';')[0]
        self.assertIn('sha256-' + digest, script_policy)
        self.assertNotIn('unsafe-inline', script_policy)
        self.assertIn("connect-src 'self'", policy)
        self.assertIn("frame-ancestors 'none'", policy)
        self.assertNotIn('Access-Control-Allow-Origin', page['headers'])

    def test_rate_limits_recover_after_window_and_remain_bounded(self):
        now = [1]
        limits = WindowLimit(lambda: now[0])
        self.assertTrue(limits.allow('test', 'client', 1, 60))
        self.assertFalse(limits.allow('test', 'client', 1, 60))
        now[0] += 61
        self.assertTrue(limits.allow('test', 'client', 1, 60))
        for i in range(2000):
            limits.allow('test', str(i), 1, 60)
        self.assertLessEqual(len(limits.entries), 1024)
