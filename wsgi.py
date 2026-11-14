"""Managed WSGI hosts import application; local use remains python3 server.py."""
import os
os.environ['SOLSTICE_MODE'] = 'public'
os.environ.setdefault('SOLSTICE_CACHE_DIR', '/tmp/solstice-cache')
from public_app import create_app
application = create_app()
