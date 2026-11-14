import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs
import map_gateway

class MapGatewayTests(unittest.TestCase):
    def tile(self,lat=52.5208,lon=13.4095):
        row=math.floor((lat+90)/.02)
        mid=row*.02-90+.01
        step=.02/max(.1,math.cos(math.radians(mid)))
        return {'row':row,'col':math.floor((lon+180)/step)}

    def test_only_coarse_indices_are_accepted(self):
        for body in [{'lat':52.5208,'lon':13.4095},dict(self.tile(),lat=52.5208),{'row':True,'col':1},{'row':9001,'col':1},{'row':7000,'col':-1}]:
            with self.subTest(body=body),self.assertRaises(ValueError):
                map_gateway.tile_bounds(body)

    def test_area_covers_nearby_points_and_is_much_larger_than_the_site(self):
        b=map_gateway.tile_bounds(self.tile())
        self.assertTrue(b[0]<52.5208<b[2]);self.assertTrue(b[1]<13.4095<b[3])
        self.assertGreater((b[2]-b[0])*111320,2800)
        self.assertEqual(self.tile(),self.tile(52.52081,13.40951))

    def test_upstream_query_contains_area_only_and_area_is_cached(self):
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,n):return json.dumps({'elements':[]}).encode()
        with tempfile.TemporaryDirectory() as temp,patch.object(map_gateway,'CACHE',Path(temp)),patch.object(map_gateway,'LAST_CALL',0),patch.object(map_gateway,'urlopen',return_value=Response()) as call:
            result=map_gateway.fetch_surroundings(self.tile())
            req=call.call_args.args[0]
            query=parse_qs(req.data.decode())['data'][0]
            self.assertNotIn('52.5208',query);self.assertNotIn('13.4095',query)
            self.assertIn('out tags geom',query);self.assertIn('natural',query)
            self.assertNotIn('lat',result['meta']['coarse_tile'])
            cached=map_gateway.fetch_surroundings(self.tile())
            self.assertTrue(cached['meta']['cached']);self.assertEqual(call.call_count,1)

    def test_partial_map_results_are_never_silently_accepted(self):
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,n):return json.dumps({'elements':[], 'remark':'runtime error: timeout'}).encode()
        with tempfile.TemporaryDirectory() as temp,patch.object(map_gateway,'CACHE',Path(temp)),patch.object(map_gateway,'LAST_CALL',0),patch.object(map_gateway,'urlopen',return_value=Response()):
            with self.assertRaisesRegex(ValueError,'incomplete'):
                map_gateway.fetch_surroundings(self.tile())

    def test_official_api_geometry_is_resolved_without_retaining_unrelated_data(self):
        data={'elements':[
            {'type':'node','id':1,'lat':52,'lon':13,'user':'mapper'},
            {'type':'node','id':2,'lat':52,'lon':13.001},
            {'type':'node','id':3,'lat':52.001,'lon':13.001},
            {'type':'way','id':4,'nodes':[1,2,3,1],'tags':{'building':'yes','height':'12'}},
            {'type':'way','id':5,'nodes':[1,2],'tags':{'highway':'footway'}},
            {'type':'node','id':6,'lat':52.001,'lon':13.002,'tags':{'natural':'tree'},'user':'mapper'}]}
        result=map_gateway.compact_osm(data)
        self.assertEqual(len(result['elements']),2)
        self.assertEqual(result['elements'][0]['geometry'][0],{'lat':52,'lon':13})
        self.assertNotIn('mapper',json.dumps(result))

    def test_official_fallback_fetches_all_fixed_quadrants_not_the_private_point(self):
        from urllib.error import URLError
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,n):return json.dumps({'elements':[]}).encode()
        requests=[]
        def opening(request,timeout):
            requests.append(request.full_url)
            if 'overpass' in request.full_url:raise URLError('Test outage')
            return Response()
        with tempfile.TemporaryDirectory() as temp,patch.object(map_gateway,'CACHE',Path(temp)),patch.object(map_gateway,'LAST_CALL',0),patch.object(map_gateway,'urlopen',side_effect=opening):
            result=map_gateway.fetch_surroundings(self.tile())
            official=[url for url in requests if 'api.openstreetmap.org' in url]
            self.assertEqual(len(official),4)
            self.assertFalse(any('52.5208' in url or '13.4095' in url for url in official))
            self.assertEqual(result['meta']['provider'],'https://api.openstreetmap.org/api/0.6/map.json')

    def test_quadrants_are_compacted_individually_and_relation_members_are_merged(self):
        import io
        from urllib.error import URLError
        count=[0]
        def opening(request,timeout):
            if 'overpass' in request.full_url:raise URLError('Test outage')
            count[0]+=1
            i=count[0]
            elements=[{'type':'node','id':i,'lat':52+i*.001,'lon':13},
                      {'type':'node','id':100+i,'lat':52+i*.001,'lon':13.001},
                      {'type':'way','id':200+i,'nodes':[i,100+i]},
                      {'type':'way','id':900+i,'nodes':[i,100+i],'tags':{'highway':'footway'}},
                      {'type':'relation','id':999,'tags':{'building':'yes','type':'multipolygon'},
                       'members':[{'type':'way','ref':200+i,'role':'outer'}]}]
            return io.BytesIO(json.dumps({'elements':elements}).encode())
        with tempfile.TemporaryDirectory() as temp,patch.object(map_gateway,'CACHE',Path(temp)),patch.object(map_gateway,'LAST_CALL',0),patch.object(map_gateway,'urlopen',side_effect=opening):
            result=map_gateway.fetch_surroundings(self.tile())
            self.assertEqual(len(result['elements']),1)
            relation=result['elements'][0]
            self.assertEqual([m['ref'] for m in relation['members']],[201,202,203,204])
            self.assertTrue(all(len(m['geometry'])==2 for m in relation['members']))
            self.assertNotIn('highway',json.dumps(result))

    def test_gzip_downloads_are_bounded_after_decompression(self):
        import io
        import gzip
        response=io.BytesIO(gzip.compress(json.dumps({'elements':[]}).encode()))
        response.headers={'Content-Encoding':'gzip'}
        self.assertEqual(map_gateway.read_json_response(response,100),{'elements':[]})
        response=io.BytesIO(gzip.compress(b'x'*200));response.headers={'Content-Encoding':'gzip'}
        with self.assertRaisesRegex(ValueError,'too dense'):
            map_gateway.read_json_response(response,100)

    def test_empty_or_truncated_provider_responses_are_readable_and_try_the_next_provider(self):
        import io
        for raw in (b'',b'{"elements":',b'<html>unavailable</html>'):
            with self.assertRaisesRegex(map_gateway.MapProviderError,'empty or incomplete'):
                map_gateway.read_json_response(io.BytesIO(raw),100)
        with tempfile.TemporaryDirectory() as temp,patch.object(map_gateway,'CACHE',Path(temp)),patch.object(map_gateway,'LAST_CALL',0),patch.object(map_gateway,'urlopen',side_effect=[io.BytesIO(b''),io.BytesIO(b'{"elements":[]}')]) as request:
            result=map_gateway.fetch_surroundings(self.tile())
            self.assertEqual(request.call_count,2)
            self.assertEqual(result['elements'],[])

if __name__=='__main__':unittest.main()
