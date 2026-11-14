import gzip
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import cache_storage as cache

class CacheTests(unittest.TestCase):
    def test_oversized_compressed_cache_is_not_read_into_memory(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'data.json.gz'
            with gzip.open(path, 'wb') as stream:
                stream.write(b'"' + b'x' * 1000000 + b'"')
            with self.assertRaises(ValueError):
                cache.read(path, 1000)

    def test_pruning_removes_old_and_over_budget_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old, big, newest = [root / (name + '.json.gz') for name in ('old', 'big', 'newest')]
            old.write_bytes(b'x' * 10); big.write_bytes(b'x' * 20); newest.write_bytes(b'x' * 10)
            now = time.time()
            os.utime(old, (now - 1000, now - 1000)); os.utime(big, (now - 2, now - 2)); os.utime(newest, (now, now))
            cache.prune(root, budget=15, max_age=100)
            self.assertEqual(list(root.iterdir()), [newest])

    def test_disposable_cache_write_failure_does_not_lose_download(self):
        with patch.object(cache.gzip, 'open', side_effect=OSError('read-only disk')):
            with tempfile.TemporaryDirectory() as tmp:
                cache.write(Path(tmp) / 'public.json.gz', {'public': True})
                self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_old_hosted_weather_cache_expires_before_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'data.json.gz';cache.write(path,{'public':True})
            old=time.time()-31*86400;os.utime(path,(old,old))
            with patch.dict(os.environ,{'SOLSTICE_MODE':'public'}),self.assertRaises(ValueError):
                cache.read(path,1000)
