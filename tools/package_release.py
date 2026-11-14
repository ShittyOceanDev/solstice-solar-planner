"""Package the public application with neutral archive metadata."""
import gzip
import os
from pathlib import Path
import tarfile
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    '.dockerignore', '.env.example', '.gitignore', '.python-version',
    'DEPLOYMENT.md', 'Dockerfile', 'Procfile', 'README.md',
    'cache_storage.py', 'download_jobs.py', 'gunicorn.conf.py', 'map_gateway.py',
    'map_jobs.py', 'public_app.py', 'pyproject.toml', 'requirements.txt',
    'server.py', 'share.py', 'source_registry.py', 'start.sh', 'transport.py', 'uv.lock', 'wsgi.py',
    'tools/check_hosted.py', 'tools/package_release.py',
    'web/api.js', 'web/app.js', 'web/city-model.js', 'web/connection.js',
    'web/diagnostics-ui.js', 'web/geometry.js', 'web/index.html', 'web/map-ui.js',
    'web/maps.js', 'web/model.js', 'web/offline.js', 'web/onboarding.css', 'web/onboarding.js',
    'web/panels.js', 'web/providers.js', 'web/runtime.js', 'web/scene.js', 'web/sources.js',
    'web/styles.css', 'web/worker.js', 'web/vendor/LICENSE',
    'web/vendor/OrbitControls.js', 'web/vendor/three.core.js', 'web/vendor/three.module.js',
)


def package():
    for name in FILES:
        path = ROOT / name
        if not path.is_file() or path.resolve() != path:
            raise ValueError('Release files must be regular files in this checkout.')

    output = ROOT / 'dist' / 'solstice-public.tar.gz'
    output.parent.mkdir(exist_ok=True)
    with TemporaryDirectory(dir=output.parent) as staging:
        temporary = Path(staging) / output.name
        with temporary.open('wb') as stream, gzip.GzipFile(filename='', fileobj=stream, mode='wb', mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w') as archive:
                for name in FILES:
                    with (ROOT / name).open('rb') as content:
                        info = tarfile.TarInfo(name)
                        info.size = os.fstat(content.fileno()).st_size
                        info.mode = 0o755 if name == 'start.sh' else 0o644
                        archive.addfile(info, content)
        temporary.replace(output)
    print(f'{output.relative_to(ROOT)} ({len(FILES)} application files, {output.stat().st_size:,} bytes)')


if __name__ == '__main__':
    package()
