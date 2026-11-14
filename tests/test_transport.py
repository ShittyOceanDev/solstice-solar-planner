import unittest
from unittest.mock import patch
from collections import deque
import transport

class TransportTests(unittest.TestCase):
    def test_empty_browser_body_is_correlated_with_server_writes_without_recording_request_data(self):
        with patch.object(transport,'RECORDS',deque(maxlen=160)):
            rid='r-browser-check-123'
            transport.sent(rid,'/api/surroundings/jobs/secret-job',200,4096,4096)
            transport.observed({'request_id':rid,'transport':'fetch','status':200,'received_bytes':0,'expected_bytes':4096,'protocol':transport.PROTOCOL})
            record=transport.snapshot()['records'][0]
            self.assertEqual(record['stage'],'map-poll');self.assertEqual(record['written_bytes'],4096);self.assertEqual(record['browser'][0]['received_bytes'],0)
            self.assertNotIn('secret-job',str(record))
            with self.assertRaises(ValueError):transport.observed({'request_id':rid,'lat':52.512345})

    def test_a_reply_not_seen_by_this_server_is_distinguishable_from_a_provider_failure(self):
        with patch.object(transport,'RECORDS',deque(maxlen=160)):
            transport.observed({'request_id':'r-proxy-check-123','transport':'xhr','status':200,'received_bytes':0,'expected_bytes':None,'protocol':''})
            value=transport.snapshot()['records'][0]
            self.assertEqual(value['stage'],'not-seen-by-this-server');self.assertFalse(value['browser'][0]['protocol'])

    def test_snapshot_is_detached_and_diagnostic_checks_do_not_log_themselves(self):
        with patch.object(transport,'RECORDS',deque(maxlen=160)):
            transport.sent('r-identity-check','/api/health',200,100,100)
            snapshot=transport.snapshot();snapshot['records'][0]['stage']='changed'
            self.assertEqual(transport.snapshot()['records'][0]['stage'],'health')
            transport.sent('r-identity-check','/api/diagnostics/probe',200,10,10)
            self.assertEqual(len(transport.snapshot()['records']),1)
