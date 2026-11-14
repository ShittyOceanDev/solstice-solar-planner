"""OpenStreetMap gateway: accepts coarse tile indices, never a user's exact point."""
from __future__ import annotations
import datetime as dt
import gzip
import json
import math
import os
from pathlib import Path
import threading
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import cache_storage

CACHE = cache_storage.directory('map')
ENDPOINTS = ('https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter')
LOCK = threading.Lock()
LAST_CALL = 0.0

class MapProviderError(ValueError):
    pass

def read_json_response(response,limit):
    headers=getattr(response,'headers',{})
    stream=gzip.GzipFile(fileobj=response) if headers.get('Content-Encoding','').lower()=='gzip' else response
    raw=stream.read(limit+1)
    if len(raw)>limit:
        raise ValueError('This public map area is too dense for a bounded download. Use an offline GeoJSON extract.')
    try:
        data=json.loads(raw)
    except (ValueError,UnicodeDecodeError):
        raise MapProviderError('The map provider returned an empty or incomplete response. Please retry later.') from None
    if not isinstance(data,dict) or data.get('remark') or data.get('error') or not isinstance(data.get('elements'),list):
        raise MapProviderError('The map provider returned an incomplete area. Please retry later.')
    return data

def compact_osm(data):
    """Resolve the official read API's node references, retaining only buildings/trees."""
    elements=data.get('elements',[])
    nodes={e['id']:e for e in elements if e.get('type')=='node'}
    ways={e['id']:e for e in elements if e.get('type')=='way'}
    def geometry(way):
        refs=way.get('nodes',[])
        if not refs or any(ref not in nodes for ref in refs):
            return None
        return [{'lat':nodes[ref]['lat'],'lon':nodes[ref]['lon']} for ref in refs]
    result=[]
    for e in elements:
        tags=e.get('tags',{})
        if e.get('type')=='node' and tags.get('natural')=='tree':
            result.append({k:e[k] for k in ('type','id','lat','lon','tags')})
        elif e.get('type')=='way' and tags.get('building') not in (None,'no'):
            points=geometry(e)
            if points: result.append({'type':'way','id':e['id'],'tags':tags,'geometry':points})
        elif e.get('type')=='relation' and tags.get('building') not in (None,'no') and tags.get('type')=='multipolygon':
            members=[]
            for m in e.get('members',[]):
                if m.get('type')!='way' or m['ref'] not in ways:continue
                points=geometry(ways[m['ref']])
                if points:members.append({**m,'geometry':points})
            result.append({'type':'relation','id':e['id'],'tags':tags,'members':members})
    return {'elements':result}

def tile_bounds(body):
    if set(body) != {'row','col'}:
        raise ValueError('Map requests accept only coarse area row and column indices, not exact coordinates.')
    row, col = body['row'], body['col']
    if type(row) is not int or type(col) is not int or not 250 <= row < 8750:
        raise ValueError('Choose a location between 85° south and 85° north.')
    south = row * .02 - 90
    latitude = south + .01
    step = .02 / max(.1, math.cos(math.radians(latitude)))
    if not 0 <= col < math.ceil(360 / step):
        raise ValueError('Invalid map area column.')
    west = col * step - 180
    # Padding covers the locally chosen 100–200 m neighbourhood near cell edges.
    return [round(max(-85, south-.003),7), round(max(-180, west-.003/max(.1,math.cos(math.radians(latitude)))),7),
            round(min(85, south+.023),7), round(min(180, west+step+.003/max(.1,math.cos(math.radians(latitude)))),7)]

def fetch_surroundings(body):
    global LAST_CALL
    bounds = tile_bounds(body)
    path = CACHE / f'osm-v1-{body["row"]}-{body["col"]}.json.gz'
    if path.exists() and time.time()-path.stat().st_mtime < 7*86400:
        try:
            result=cache_storage.read(path,16_000_000)
            result['meta']['cached']=True
            return result
        except (ValueError,OSError):
            pass
    if not LOCK.acquire(blocking=False):
        raise ValueError('Another map area is loading. Please wait before trying again.')
    try:
        if time.monotonic()-LAST_CALL < 30:
            raise ValueError('Please wait 30 seconds between map downloads. Cached areas remain available.')
        LAST_CALL=time.monotonic()
        bbox=','.join(str(v) for v in bounds)
        query=f'[out:json][timeout:35];(way["building"]["building"!="no"]({bbox});relation["building"]["type"="multipolygon"]({bbox});node["natural"="tree"]({bbox}););out tags geom;'
        result=None
        for endpoint in ENDPOINTS:
            try:
                request=Request(endpoint,data=urlencode({'data':query}).encode(),headers={
                    'User-Agent':'Solstice-solar-planner/1.1 (on-demand building analysis)',
                    'Content-Type':'application/x-www-form-urlencoded', 'Accept':'application/json','Accept-Encoding':'gzip'})
                with urlopen(request,timeout=20) as response:
                    result=read_json_response(response,8_000_000 if os.environ.get('SOLSTICE_MODE')=='public' else 16_000_000)
                if result.get('remark') or not isinstance(result.get('elements'),list):
                    raise ValueError('The map provider returned an incomplete area. Retry later.')
                break
            except MapProviderError:
                result=None
            except ValueError:
                raise
            except Exception:
                result=None
        if result is None:
            # A bounded, infrequent official read-API fallback. Never an editing
            # request. The same coarse area is cached for seven days.
            endpoint='https://api.openstreetmap.org/api/0.6/map.json'
            south,west,north,east=bounds
            middle_lat=(south+north)/2;middle_lon=(west+east)/2
            try:
                combined={}
                # Download ALL four fixed quadrants, regardless of the private
                # point. This stays under the read API's per-request node limit
                # without telling the provider which quadrant contains the site.
                for bottom,top in ((south,middle_lat),(middle_lat,north)):
                    for left,right in ((west,middle_lon),(middle_lon,east)):
                        query=urlencode({'bbox':f'{left},{bottom},{right},{top}'})
                        request=Request(endpoint+'?'+query,headers={'User-Agent':'Solstice-solar-planner/1.1 (on-demand building analysis)','Accept':'application/json','Accept-Encoding':'gzip'})
                        with urlopen(request,timeout=25) as response:
                            data=read_json_response(response,16_000_000 if os.environ.get('SOLSTICE_MODE')=='public' else 32_000_000)
                        if data.get('error') or not isinstance(data.get('elements'),list):raise ValueError('The map provider returned incomplete data.')
                        # Resolve and discard raw road/node data one fixed
                        # quadrant at a time. Retaining all four raw extracts
                        # simultaneously can exhaust a small hosting instance.
                        compact=compact_osm(data)
                        del data
                        for element in compact['elements']:
                            key=(element.get('type'),element.get('id'))
                            if element.get('type')=='relation' and key in combined:
                                members={m['ref']:m for m in combined[key].get('members',[])}
                                members.update({m['ref']:m for m in element.get('members',[])})
                                element['members']=list(members.values())
                            combined[key]=element
                result={'elements':list(combined.values())}
            except ValueError:
                raise
            except Exception:
                raise ConnectionError('OpenStreetMap providers are unavailable. Please retry later or import GeoJSON. Your current scene is unchanged.') from None
        result['meta']={'source':'OpenStreetMap contributors','provider':endpoint,'bounds':bounds,
                        'downloaded_at':dt.datetime.now(dt.timezone.utc).isoformat(),'cached':False,
                        'licence':'ODbL 1.0','attribution_url':'https://www.openstreetmap.org/copyright',
                        'coarse_tile':body}
        cache_storage.write(path,result)
        return result
    finally:
        LOCK.release()
