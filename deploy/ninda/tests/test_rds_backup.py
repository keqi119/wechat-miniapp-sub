"""Offline checks of backup retention safety; no Docker or cloud connections."""
import importlib.util
import json
import os
import subprocess
from pathlib import Path
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

try:
    import fcntl
except ImportError:
    sys.modules.setdefault('fcntl', types.SimpleNamespace())
spec = importlib.util.spec_from_file_location('rds_backup', Path(__file__).resolve().parents[1] / 'rds-backup.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.backups = self.root / 'backups'
        self.backups.mkdir()
        self.patch_root = patch.object(m, 'ROOT', self.root)
        self.patch_backups = patch.object(m, 'BACKUPS', self.backups)
        self.patch_root.start(); self.patch_backups.start()
        self.archive = self.backups / '20261001T000000Z.tar.enc'
        self.archive.write_bytes(b'encrypted fixture')
        os.utime(self.archive, (time.time() - 9*86400,) * 2)
        self.receipt = self.backups / '20261001T000000Z.oss-verified.json'
        self.receipt.write_text(json.dumps({'archive': self.archive.name, 'sha256': m.digest(self.archive), 'verifiedAt': time.time()}))
        self.checksum = self.backups / '20261001T000000Z.sha256'
        self.checksum.write_text(m.digest(self.archive))

    def tearDown(self):
        self.patch_backups.stop(); self.patch_root.stop(); self.temp.cleanup()

    def test_missing_receipt_keeps_archive(self):
        self.receipt.unlink()
        with patch.object(m, 'run') as remote:
            m.prune_verified_local_backups()
        self.assertTrue(self.archive.exists()); remote.assert_not_called()

    def test_recent_backup_is_kept(self):
        os.utime(self.archive, None)
        with patch.object(m, 'run') as remote:
            m.prune_verified_local_backups()
        self.assertTrue(self.archive.exists()); remote.assert_not_called()

    def test_bad_receipt_keeps_archive(self):
        self.receipt.write_text(json.dumps({'archive': self.archive.name, 'sha256': 'wrong'}))
        with self.assertRaises(RuntimeError): m.prune_verified_local_backups()
        self.assertTrue(self.archive.exists())

    def test_remote_verification_failure_keeps_archive(self):
        with patch.object(m, 'run', side_effect=subprocess.CalledProcessError(1, ['fake-uploader'])) as remote:
            result = m.prune_verified_local_backups()
        remote.assert_called_once()
        self.assertEqual(result, {'retired': 0, 'pending': 1})
        self.assertTrue(self.archive.exists()); self.assertTrue(self.checksum.exists())

    def test_only_live_verified_old_archive_is_retired(self):
        with patch.object(m, 'run', return_value=b'{}') as remote:
            m.prune_verified_local_backups()
        remote.assert_called_once()
        self.assertIn('verify', remote.call_args.args[0])
        self.assertIn('--readback', remote.call_args.args[0])
        self.assertFalse(self.archive.exists()); self.assertFalse(self.checksum.exists())
        self.assertIn('localRetiredAt', json.loads(self.receipt.read_text()))


if __name__ == '__main__': unittest.main()
