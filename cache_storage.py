"""Disposable public-data caches with bounded reads and hosted disk usage."""
import gzip
import json
import os
from pathlib import Path
import threading
import time

LOCK = threading.Lock()
ROOT = Path(__file__).resolve().parent

def directory(name):
    return Path(os.environ.get('SOLSTICE_CACHE_DIR', str(ROOT))) / f'.{name}-cache'

def read(path, limit):
    if os.environ.get('SOLSTICE_MODE') == 'public' and time.time() - path.stat().st_mtime > 30 * 86400:
        raise ValueError('Cached response expired.')
    with gzip.open(path, 'rb') as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError('Cached response is too large.')
    return json.loads(raw)

def write(path, data):
    """Cache failures never discard a successful provider download."""
    try:
        with LOCK:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix('.tmp')
            try:
                with gzip.open(temporary, 'wt') as stream:
                    json.dump(data, stream, separators=(',', ':'), allow_nan=False)
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
            if os.environ.get('SOLSTICE_MODE') == 'public':
                prune(path.parent)
    except OSError:
        pass

def prune(folder, budget=32 * 1024 * 1024, max_age=30 * 86400):
    files = sorted(folder.glob('*.json.gz'), key=lambda p: p.stat().st_mtime, reverse=True)
    used, now = 0, time.time()
    for path in files:
        stat = path.stat()
        if now - stat.st_mtime > max_age or used + stat.st_size > budget:
            path.unlink(missing_ok=True)
        else:
            used += stat.st_size
