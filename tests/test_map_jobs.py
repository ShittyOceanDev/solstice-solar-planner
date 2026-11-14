import threading
import time
import unittest
from unittest.mock import patch
from map_jobs import MapJobs

class MapJobTests(unittest.TestCase):
    def complete(self,jobs,key):
        limit=time.monotonic()+2
        while time.monotonic()<limit:
            result=jobs.get(key)
            if result['status']!='loading':return result
            time.sleep(.001)
        self.fail('Map job did not finish')

    def test_slow_download_returns_immediately_and_same_area_reconnects(self):
        release=threading.Event();calls=[]
        def fetch(area):
            calls.append(area);release.wait(2);return {'elements':[], 'meta':{'cached':False}}
        jobs=MapJobs(fetch);area={'row':7126,'col':5882}
        try:
            started=jobs.start(area)
            self.assertEqual(jobs.get(started['job'])['status'],'loading')
            self.assertEqual(jobs.start(area)['job'],started['job'])
            with self.assertRaisesRegex(ValueError,'Another map area'):
                jobs.start({'row':7126,'col':5883})
        finally:release.set()
        self.assertEqual(self.complete(jobs,started['job'])['status'],'complete')
        self.assertEqual(calls,[area])

    def test_job_errors_are_json_data_and_do_not_expose_internal_exception(self):
        def fail(area):raise RuntimeError('private internal exception')
        jobs=MapJobs(fail);key=jobs.start({'row':7126,'col':5882})['job']
        result=self.complete(jobs,key)
        self.assertEqual(result['status'],'error');self.assertNotIn('private',result['error'])
        self.assertIsNone(jobs.get('missing'))

    def test_precise_fields_are_rejected_before_a_job_is_created(self):
        jobs=MapJobs(lambda area:None)
        with self.assertRaises(ValueError):jobs.start({'row':7126,'col':5882,'lat':52.52255})
        self.assertEqual(len(jobs.jobs),0)

    def test_large_results_are_transferred_in_bounded_verifiable_parts(self):
        import json,hashlib
        data={'elements':[{'name':'x'*200000}],'meta':{}}
        jobs=MapJobs(lambda area:data);key=jobs.start({'row':7126,'col':5882})['job'];result=self.complete(jobs,key)
        transfer=result['data'];self.assertEqual(transfer['_solstice_transfer'],'json-parts-v1')
        parts=[jobs.part(key,index) for index in range(transfer['parts'])]
        self.assertTrue(all(len(part['text'])<=65536 for part in parts))
        raw=''.join(part['text'] for part in parts)
        self.assertEqual(json.loads(raw),data);self.assertEqual(hashlib.sha256(raw.encode()).hexdigest(),transfer['sha256'])
        self.assertIsNone(jobs.part(key,transfer['parts']))

    def test_results_expire_on_reads_even_when_no_new_job_is_started(self):
        jobs=MapJobs(lambda area:{'elements':[]})
        key=jobs.start({'row':7126,'col':5882})['job'];self.complete(jobs,key)
        finished=jobs.jobs[key]['finished']
        with patch('download_jobs.time.monotonic',return_value=finished+901):
            self.assertIsNone(jobs.get(key));self.assertIsNone(jobs.part(key,0))
