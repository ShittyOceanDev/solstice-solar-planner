import datetime as dt
import json
import unittest
from unittest.mock import patch
import server

class PrivacyGatewayTests(unittest.TestCase):
    def test_precise_coordinates_are_coarsened_before_request(self):
        self.assertEqual(server.coarse_location({'lat':52.512345,'lon':13.412345,'grid':.1}),(52.5,13.4,.1))
        self.assertEqual(server.coarse_location({'lat':-33.891,'lon':151.198,'grid':.25}),(-34,151.25,.25))

    def test_invalid_and_overly_precise_requests_are_rejected(self):
        for body in [{'lat':91,'lon':0}, {'lat':0,'lon':181}, {'lat':float('nan'),'lon':0}, {'lat':1,'lon':2,'grid':.001}]:
            with self.subTest(body=body), self.assertRaises(ValueError):
                server.coarse_location(body)

    def test_incomplete_calendar_year_and_future_year_rejected(self):
        with self.assertRaises(ValueError):
            server.fetch_weather({'lat':52.5,'lon':13.4,'grid':.1,'year':dt.date.today().year})

    def test_weather_jobs_retain_only_canonical_rounded_request_fields(self):
        from download_jobs import DownloadJobs
        jobs=DownloadJobs(lambda request: {},server.weather_request,'weather year','Unavailable')
        started=jobs.start({'lat':52.512345,'lon':13.412345,'grid':.1,'year':dt.date.today().year-1})
        request=jobs.jobs[started['job']]['request']
        self.assertEqual(request,{'lat':52.5,'lon':13.4,'grid':.1,'year':dt.date.today().year-1})
        with self.assertRaises(ValueError):
            jobs.start({**request,'scene':{}})

    def test_json_transport_has_complete_uncompressed_bodies_even_when_browser_accepts_gzip(self):
        import io
        from email.message import Message
        for status,data in ((200,{'name':'Sunlight ☼','elements':[1,2]}),(202,{'status':'loading'}),(502,{'error':'Provider unavailable'})):
            handler=object.__new__(server.Handler);handler.headers=Message();handler.headers['Accept-Encoding']='gzip, br';handler.wfile=io.BytesIO()
            headers={};handler.send_response=lambda status: None;handler.send_header=lambda key,value:headers.update({key:value});handler.end_headers=lambda:None
            handler.json_response(data,status)
            body=handler.wfile.getvalue()
            self.assertEqual(json.loads(body),data)
            self.assertEqual(int(headers['Content-Length']),len(body))
            self.assertNotIn('Content-Encoding',headers)

    def test_static_root_does_not_expose_project_or_cache(self):
        self.assertEqual(server.WEB.name,'web')
        self.assertNotEqual(server.WEB,server.CACHE)

    def test_gateway_only_sends_coarse_coordinates_and_fixed_weather_fields(self):
        import tempfile
        from pathlib import Path
        from urllib.parse import urlsplit, parse_qs
        year=dt.date.today().year-1
        times=[int(dt.datetime(year-1,12,31,tzinfo=dt.timezone.utc).timestamp())+3600*i for i in range(8808)]
        hourly={'time':times,**{k:[0]*len(times) for k in server.FIELDS}}
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,n):return json.dumps({'hourly':hourly}).encode()
        with tempfile.TemporaryDirectory() as tmp, patch.object(server,'CACHE',Path(tmp)), patch.object(server,'urlopen',return_value=Response()) as request:
            result=server.fetch_weather({'lat':52.512345,'lon':13.412345,'grid':.1,'year':year})
            query=parse_qs(urlsplit(request.call_args.args[0].full_url).query)
            self.assertEqual(query['latitude'],['52.5'])
            self.assertEqual(query['longitude'],['13.4'])
            self.assertEqual(query['models'],['era5'])
            self.assertNotIn('scene',query)
            self.assertEqual(result['meta']['requested_latitude'],52.5)
            server.fetch_weather({'lat':52.5,'lon':13.4,'grid':.1,'year':year})
            self.assertEqual(request.call_count,1)

if __name__ == '__main__':unittest.main()
