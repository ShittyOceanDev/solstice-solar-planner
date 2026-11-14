"""Smoke-check a deployment; --downloads explicitly enables public-data requests."""
import argparse
import hashlib
import json
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url',help='Website origin, without a path')
    parser.add_argument('--downloads',action='store_true',help='Also download a sample map area and weather year')
    parser.add_argument('--local-host',help='Configured public hostname; only for a loopback production test')
    parser.add_argument('--area',default='7126,5882',help='Coarse map row,column for the optional download')
    args=parser.parse_args()
    base=args.url.rstrip('/');parts=urlsplit(base)
    if parts.path or parts.query or parts.fragment or parts.username or parts.scheme not in ('http','https'):
        parser.error('Use a site origin without credentials or a path.')
    if parts.scheme!='https' and parts.hostname not in ('127.0.0.1','localhost'):
        parser.error('A public deployment must use HTTPS.')
    if args.local_host and parts.hostname not in ('127.0.0.1','localhost'):
        parser.error('--local-host is only for loopback checks.')
    origin='https://'+args.local_host if args.local_host else base
    def request(path,data=None,override=None):
        headers={'Origin':origin,'Accept':'application/json','X-Solstice-Request':'r-smoke-check'}
        if args.local_host:headers['Host']=args.local_host
        if data is not None:headers['Content-Type']='application/json'
        headers.update(override or {})
        req=Request(base+path,data=None if data is None else json.dumps(data).encode(),headers=headers)
        with urlopen(req,timeout=20) as response:
            raw=response.read(21_000_000)
            expected=response.headers.get('Content-Length')
            if expected is not None:assert int(expected)==len(raw),'Incomplete HTTP body'
            return raw,response.headers
    health=json.loads(request('/api/health')[0]);assert health['deployment']=='public' and health['sources']==['osm']
    print('PASS production health and OSM-only sources',flush=True)
    for path in ('/','/app.js','/vendor/three.module.js','/worker.js'):
        raw,headers=request(path);assert raw and 'Content-Security-Policy' in headers
    assert b'HOSTED = true' in request('/runtime.js')[0]
    assert json.loads(request('/api/diagnostics')[0])['records']==[]
    assert json.loads(request('/api/diagnostics/probe',{'probe':True})[0])['probe']
    try:request('/api/diagnostics/probe',{'probe':True},{'Origin':'https://unrelated.example'})
    except HTTPError as error:assert error.code==403
    else:raise AssertionError('Foreign-origin POST was accepted')
    print('PASS assets, runtime, diagnostics privacy and origin rejection',flush=True)
    if not args.downloads:return
    def download(path,body):
        job=json.loads(request(path,body)[0])['job'];deadline=time.monotonic()+240
        while time.monotonic()<deadline:
            state=json.loads(request(path+'/'+job)[0])
            if state['status']=='error':raise RuntimeError(state['error'])
            if state['status']=='complete':break
            time.sleep(2)
        else:raise TimeoutError('Download did not finish in four minutes')
        data=state['data']
        if data.get('_solstice_transfer')=='json-parts-v1':
            pieces=[]
            assert 0<data['parts']<1000 and data['bytes']<=20_000_000
            for index in range(data['parts']):
                part=json.loads(request(f'{path}/{job}/parts/{index}')[0])
                assert part['index']==index and part['parts']==data['parts']
                pieces.append(part['text'])
            raw=''.join(pieces).encode()
            assert len(raw)==data['bytes'] and hashlib.sha256(raw).hexdigest()==data['sha256']
            data=json.loads(raw)
        return data
    row,col=map(int,args.area.split(','))
    data=download('/api/surroundings/jobs',{'row':row,'col':col})
    assert isinstance(data['elements'],list) and data['meta']['source_id']=='osm'
    print(f"PASS map transfer: {len(data['elements'])} public building/tree elements",flush=True)
    import datetime
    year=datetime.date.today().year-1
    weather=download('/api/weather/jobs',{'lat':52.5,'lon':13.4,'grid':.1,'year':year})
    assert weather['meta']['year']==year and len(weather['hourly']['time'])>=8760
    print(f"PASS {year} weather transfer: {len(weather['hourly']['time'])} provider hours including calendar padding",flush=True)

if __name__=='__main__':main()
