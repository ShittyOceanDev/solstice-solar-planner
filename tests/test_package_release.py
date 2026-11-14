from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import tarfile
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from tools import package_release


class ReleasePackageTests(unittest.TestCase):
    def test_packages_only_listed_files_with_neutral_metadata(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for name in package_release.FILES:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(name, encoding='utf-8')

            export = root / 'web' / 'saved-project.json'
            export.write_text('{}', encoding='utf-8')

            with patch.object(package_release, 'ROOT', root), redirect_stdout(StringIO()):
                package_release.package()

            output = root / 'dist' / 'solstice-public.tar.gz'
            self.assertEqual(output.read_bytes()[3:8], b'\0' * 5)
            with tarfile.open(output) as archive:
                self.assertEqual(archive.getnames(), list(package_release.FILES))
                for member in archive.getmembers():
                    self.assertTrue(member.isfile())
                    self.assertEqual((member.uid, member.gid, member.mtime), (0, 0, 0))
                    self.assertEqual((member.uname, member.gname), ('', ''))
                    self.assertEqual(member.mode, 0o755 if member.name == 'start.sh' else 0o644)
