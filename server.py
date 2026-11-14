#!/usr/bin/env python3
"""Loopback-only static server and a location-coarsening weather gateway. No packages needed."""
from __future__ import annotations
import argparse
import datetime as dt
import gzip
import json
import math
import os
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import threading
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from map_gateway import fetch_surroundings
from map_jobs import MapJobs
from download_jobs import DownloadJobs
from source_registry import fetch_scene, normalize_scene_request, SOURCES
import transport
import cache_storage

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'
CACHE = cache_storage.directory('weather')
FIELDS = ['temperature_2m', 'wind_speed_10m', 'shortwave_radiation', 'direct_normal_irradiance', 'diffuse_radiation']
LOCK = threading.Lock()
MAP_JOBS = MapJobs(fetch_scene, normalize_scene_request)

def coarse_location(body):
    grid = float(body.get('grid', 0.1))
    lat, lon = float(body['lat']), float(body['lon'])
    if grid not in (0.1, 0.25, 0.5, 1) or not all(map(math.isfinite, (lat, lon))) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise ValueError('Choose valid coordinates and a privacy grid of at least 0.1 degrees.')
    # Match JavaScript Math.round even at negative half-grid boundaries.
    return round(max(-89.9, min(89.9, math.floor(lat / grid + .5) * grid)), 3), round(math.floor(lon / grid + .5) * grid, 3), grid

def weather_request(body):
    if not isinstance(body, dict) or set(body) != {'lat', 'lon', 'grid', 'year'}:
        raise ValueError('Weather requests accept only rounded coordinates, the privacy grid and a year.')
    lat, lon, grid = coarse_location(body)
    if type(body['year']) is not int:
        raise ValueError('Choose a whole calendar year.')
    year = int(body['year'])
    last = dt.date.today().year - 1
    if not last - 9 <= year <= last:
        raise ValueError(f'Choose a complete calendar year between {last - 9} and {last}.')
    return dict(lat=lat, lon=lon, grid=grid, year=year)

def fetch_weather(body):
    normalized = weather_request(body)
    lat, lon, grid, year = (normalized[field] for field in ('lat','lon','grid','year'))
    key = f'era5-v1-{lat:.3f}-{lon:.3f}-{year}.json.gz'
    with LOCK:
        path = CACHE / key
        if path.exists():
            try:
                result = cache_storage.read(path, 12_000_000)
                result['meta']['cached'] = True
                return result
            except (OSError, ValueError):
                pass
    # Padding permits a complete LOCAL calendar year, including UTC offsets and DST.
    start = (dt.date(year, 1, 1) - dt.timedelta(days=1)).isoformat()
    end = dt.date(year + 1, 1, 1).isoformat()
    query = urlencode(dict(latitude=lat, longitude=lon, start_date=start, end_date=end,
                          hourly=','.join(FIELDS), models='era5', timezone='UTC',
                          timeformat='unixtime', wind_speed_unit='ms', elevation='nan'))
    req = Request('https://archive-api.open-meteo.com/v1/archive?' + query,
                  headers={'User-Agent': 'Solstice-local-solar-planner/1.0', 'Accept': 'application/json'})
    with urlopen(req, timeout=75) as response:
        raw = response.read(12_000_001)
    if len(raw) > 12_000_000:
        raise ValueError('Weather response was unexpectedly large.')
    try:
        result = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise ValueError('Weather provider returned an empty or incomplete response. Retry later; existing data is unchanged.') from None
    if not isinstance(result, dict):
        raise ValueError('Weather provider returned unexpected data. Existing data is unchanged.')
    hourly = result.get('hourly', {})
    times = hourly.get('time', [])
    if len(times) < 8760 or any(len(hourly.get(field, [])) != len(times) for field in FIELDS):
        raise ValueError('Weather service returned an incomplete calendar year. No estimate was substituted.')
    if any(v is None or not isinstance(v, (int, float)) or not math.isfinite(v) for field in FIELDS for v in hourly[field]):
        raise ValueError('Weather service has missing hours. Please retry later; no values were invented.')
    if any(b - a != 3600 for a, b in zip(times, times[1:])):
        raise ValueError('Weather service returned non-contiguous hourly data.')
    result['meta'] = dict(year=year, requested_latitude=lat, requested_longitude=lon, grid=grid,
                          provider='Open-Meteo / Copernicus ERA5', model='era5',
                          downloaded_at=dt.datetime.now(dt.timezone.utc).isoformat(),
                          cached=False, radiation_interval='preceding-hour mean; evaluated at midpoint',
                          source_url='https://open-meteo.com/en/docs/historical-weather-api')
    cache_storage.write(path, result)
    return result

WEATHER_JOBS = DownloadJobs(fetch_weather, weather_request, 'weather year',
                            'Could not download historical weather. Check the internet connection and retry. Existing data is unchanged.')

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def log_message(self, fmt, *args):
        # Deliberately do not log URLs, coordinates, request bodies, or scenes.
        pass

    def valid_host(self):
        return self.headers.get('Host', '').split(':')[0] in ('localhost', '127.0.0.1')

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Cache-Control', 'no-store' if self.path.startswith('/api/') else 'no-cache')
        self.send_header('Permissions-Policy', 'geolocation=(), camera=(), microphone=()')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'")
        super().end_headers()

    def json_response(self, data, status=200):
        raw = json.dumps(data, separators=(',', ':'), allow_nan=False).encode()
        rid=transport.request_id(self.headers.get('X-Solstice-Request'))
        # Avoid content-encoding/body mismatches in embedded local preview transports.
        # API transfers stay on loopback; disk caches and upstream map downloads use gzip.
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('X-Solstice-Protocol', transport.PROTOCOL)
        self.send_header('X-Solstice-Request',rid)
        self.send_header('X-Solstice-Instance',transport.INSTANCE)
        self.end_headers()
        written=0
        try:
            written=self.wfile.write(raw)
            self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError):pass
        finally:transport.sent(rid,urlsplit(getattr(self,'path','')).path,status,len(raw),written)

    def job_response(self,path,prefix,jobs):
        pieces=path[len(prefix):].split('/')
        if len(pieces)==1:result=jobs.get(pieces[0])
        elif len(pieces)==3 and pieces[1]=='parts' and pieces[2].isdigit():result=jobs.part(pieces[0],int(pieces[2]))
        else:result=None
        return self.json_response(result if result else {'error':'Download lookup expired. Please retry.'},200 if result else 404)

    def do_GET(self):
        if not self.valid_host():
            return self.json_response({'error': 'This app accepts localhost connections only.'}, 403)
        if urlsplit(self.path).path == '/api/health':
            return self.json_response({'ok': True, 'last_year': dt.date.today().year - 1, 'surroundings': True, 'map_jobs': True, 'weather_jobs': True, 'api_version': 4,'protocol':transport.PROTOCOL,'instance':transport.INSTANCE,'sources':list(SOURCES)})
        if urlsplit(self.path).path=='/api/diagnostics':return self.json_response(transport.snapshot())
        if urlsplit(self.path).path=='/api/diagnostics/probe':
            from urllib.parse import parse_qs
            try:size=int(parse_qs(urlsplit(self.path).query).get('size',['64'])[0])
            except ValueError:size=64
            size=max(1,min(524288,size))
            return self.json_response({'probe':True,'padding':'x'*size,'protocol':transport.PROTOCOL})
        if urlsplit(self.path).path.startswith('/api/surroundings/jobs/'):
            return self.job_response(urlsplit(self.path).path,'/api/surroundings/jobs/',MAP_JOBS)
        if urlsplit(self.path).path.startswith('/api/'):
            if urlsplit(self.path).path.startswith('/api/weather/jobs/'):
                return self.job_response(urlsplit(self.path).path,'/api/weather/jobs/',WEATHER_JOBS)
            return self.json_response({'error': 'Not found'}, 404)
        super().do_GET()

    def do_POST(self):
        origin = self.headers.get('Origin')
        allowed = f'http://{self.headers.get("Host", "")}'
        if not self.valid_host() or (origin and origin != allowed):
            return self.json_response({'error': 'Only the local application may request data.'}, 403)
        if self.path not in ('/api/weather','/api/weather/jobs','/api/surroundings','/api/surroundings/jobs','/api/diagnostics/client','/api/diagnostics/probe'):
            return self.json_response({'error': 'Not found'}, 404)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 1024:
                raise ValueError('Invalid request length.')
            data = json.loads(self.rfile.read(length))
            if self.path=='/api/diagnostics/client':
                transport.observed(data)
                return self.json_response({'ok':True})
            if self.path=='/api/diagnostics/probe':return self.json_response({'probe':True,'protocol':transport.PROTOCOL})
            if self.path == '/api/surroundings/jobs':
                return self.json_response(MAP_JOBS.start(data), 202)
            if self.path == '/api/weather/jobs':
                return self.json_response(WEATHER_JOBS.start(data), 202)
            return self.json_response(fetch_weather(data) if self.path=='/api/weather' else fetch_surroundings(data))
        except (ValueError, KeyError, TypeError) as error:
            return self.json_response({'error': str(error)}, 400)
        except Exception:
            message='Could not download historical weather. Check the internet connection or retry later. Existing data is unchanged.' if self.path=='/api/weather' else 'OpenStreetMap providers are unavailable. Please retry later or import GeoJSON. Your current scene is unchanged.'
            return self.json_response({'error': message}, 502)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Solstice is ready at http://127.0.0.1:{args.port}', flush=True)
    print('Local only. Weather downloads use rounded coordinates; no requests occur automatically.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
