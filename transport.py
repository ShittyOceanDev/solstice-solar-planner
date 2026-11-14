"""In-memory connection evidence. Never records locations, request bodies or data."""
from collections import deque
import re
import secrets
import threading
import time
import copy

PROTOCOL = 'solstice-json-4'
INSTANCE = secrets.token_hex(6)
RECORDS = deque(maxlen=160)
LOCK = threading.Lock()

def request_id(value):
    return value if isinstance(value,str) and re.fullmatch(r'r-[a-z0-9-]{6,70}',value) else 'r-'+secrets.token_hex(8)

def stage(path):
    if '/parts/' in path:return 'map-part' if 'surroundings' in path else 'weather-part'
    if path.startswith('/api/surroundings/jobs/') :return 'map-poll'
    if path.startswith('/api/weather/jobs/') :return 'weather-poll'
    return {'/api/surroundings/jobs':'map-start','/api/weather/jobs':'weather-start','/api/health':'health'}.get(path,'local-api')

def sent(rid,path,status,expected,written):
    if path.startswith('/api/diagnostics'):return
    with LOCK:
        RECORDS.append(dict(request_id=rid,stage=stage(path),status=status,expected_bytes=expected,written_bytes=written,time=round(time.time(),3)))

def observed(value):
    if not isinstance(value,dict):raise ValueError('Invalid connection report.')
    allowed={'request_id','transport','status','received_bytes','protocol','expected_bytes'}
    if set(value)-allowed:raise ValueError('Connection reports cannot contain request data.')
    out={'request_id':request_id(value.get('request_id')),'transport':value.get('transport') if value.get('transport') in ('fetch','xhr') else 'unknown'}
    for field in ('status','received_bytes','expected_bytes'):
        v=value.get(field);out[field]=v if type(v) is int and 0<=v<=100_000_000 else None
    out['protocol']=value.get('protocol')==PROTOCOL
    with LOCK:
        for record in reversed(RECORDS):
            if record['request_id']==out['request_id']:
                record.setdefault('browser',[]).append(out);return
        RECORDS.append({'request_id':out['request_id'],'stage':'not-seen-by-this-server','browser':[out]})

def snapshot():
    with LOCK:return {'protocol':PROTOCOL,'instance':INSTANCE,'records':copy.deepcopy(list(RECORDS))}
