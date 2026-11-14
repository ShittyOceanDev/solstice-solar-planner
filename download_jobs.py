"""Bounded local download jobs; only normalized request fields are retained."""
import secrets
import threading
import time
import json
import hashlib

class JobBusy(ValueError):
    pass

class DownloadJobs:
    def __init__(self, fetch, normalize, label, failure):
        self.fetch, self.normalize, self.label, self.failure = fetch, normalize, label, failure
        self.jobs = {}
        self.lock = threading.Lock()

    def _expire(self):
        now = time.monotonic()
        self.jobs = {key: job for key, job in self.jobs.items()
                     if job['status'] == 'loading' or now - job.get('finished', job['created']) < 900}

    def start(self, request):
        request = self.normalize(request)
        with self.lock:
            now = time.monotonic()
            self._expire()
            for key, job in self.jobs.items():
                if job['request'] == request and job['status'] == 'loading':
                    return {'job': key, 'status': 'loading'}
            if any(job['status'] == 'loading' for job in self.jobs.values()):
                raise JobBusy(f'Another {self.label} is loading. Please wait before trying again.')
            if len(self.jobs) >= 3:
                del self.jobs[min(self.jobs, key=lambda key: self.jobs[key]['created'])]
            key = secrets.token_hex(16)
            self.jobs[key] = {'request': request, 'created': now, 'status': 'loading'}
        threading.Thread(target=self._run, args=(key, request), daemon=True).start()
        return {'job': key, 'status': 'loading'}

    def _run(self, key, request):
        try:
            data = self.fetch(request)
            encoded = json.dumps(data,separators=(',',':'),allow_nan=False)
            if len(encoded) > 20_000_000:
                raise ValueError('This download is too large for the hosted planner. Try an offline geometry import.')
            if len(encoded)>131072:
                parts=tuple(encoded[i:i+65536] for i in range(0,len(encoded),65536))
                result={'status':'complete','data':{'_solstice_transfer':'json-parts-v1','parts':len(parts),'bytes':len(encoded),'sha256':hashlib.sha256(encoded.encode()).hexdigest()},'_parts':parts}
            else:result = {'status': 'complete', 'data': data}
        except ValueError as error:
            result = {'status': 'error', 'error': str(error)}
        except Exception:
            result = {'status': 'error', 'error': self.failure}
        with self.lock:
            self.jobs[key].update(result, finished=time.monotonic())

    def get(self, key):
        with self.lock:
            self._expire()
            job = self.jobs.get(key)
            if not job:
                return None
            return {field: job[field] for field in ('status', 'data', 'error') if field in job}

    def part(self,key,index):
        with self.lock:
            self._expire()
            parts=self.jobs.get(key,{}).get('_parts',())
            if not 0<=index<len(parts):return None
            return {'index':index,'parts':len(parts),'text':parts[index]}
