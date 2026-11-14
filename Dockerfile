FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080 SOLSTICE_MODE=public SOLSTICE_CACHE_DIR=/tmp/solstice-cache
WORKDIR /app
COPY LICENSE requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py public_app.py wsgi.py gunicorn.conf.py map_gateway.py map_jobs.py download_jobs.py source_registry.py transport.py cache_storage.py ./
COPY web/ ./web/
RUN useradd --system --uid 10001 solstice
USER 10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8080')+'/api/health', timeout=3).read()"
CMD ["gunicorn", "--config", "gunicorn.conf.py", "wsgi:application"]
