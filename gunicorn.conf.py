"""One small instance. Jobs and limits are in memory: do not add worker processes."""
import os
bind = f"{os.environ.get('SOLSTICE_BIND', '0.0.0.0')}:{int(os.environ.get('PORT', '8080'))}"
workers = 1
worker_class = 'gthread'
threads = 8
worker_connections = 64
timeout = 45
graceful_timeout = 30
keepalive = 5
limit_request_line = 2048
limit_request_fields = 32
limit_request_field_size = 2048
accesslog = None
errorlog = '-'
loglevel = 'warning'
capture_output = False
# Origin validation uses the configured external origin. No need to trust any
# forwarded headers, nor let a client influence the WSGI path through them.
forwarded_allow_ips = ''
forwarder_headers = ''
