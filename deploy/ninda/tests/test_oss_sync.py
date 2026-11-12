"""Offline Linux tests: no credentials, IMDS or OSS requests."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / 'oss-sync.py'
sys.path.insert(0, str(HERE.parent))
from oss_store import StoreError


class Remote:
    def __init__(self):
        self.objects = {}
        self.calls = []
        self.errors = {}
        self.after = None

    def __call__(self, operation, path, key, readback=False):
        data = Path(path).read_bytes()
        self.calls.append((operation, key, readback))
        if key in self.errors:
            raise self.errors[key]
        if operation == 'verify':
            if key not in self.objects:
                raise StoreError('OSS_HTTP_404')
            if self.objects[key] != data:
                raise StoreError('REMOTE_HASH_METADATA_MISMATCH')
        elif operation == 'put':
            self.objects[key] = data
        else:
            raise AssertionError('Unexpected operation')
        if self.after:
            self.after()
        return {'status': ('verified_' if operation == 'verify' else 'put_verified_') + 'readback',
                'count': 1, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


class SyncTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not SCRIPT.is_file():
            raise AssertionError('Incremental mirror implementation is missing')
        spec = importlib.util.spec_from_file_location('ninda_oss_sync', SCRIPT)
        cls.sync = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.sync)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=HERE)
        self.base = Path(self.tmp.name)
        self.source = self.base / 'uploads'
        self.source.mkdir()
        self.state = self.base / 'state'
        self.remote = Remote()

    def tearDown(self):
        self.tmp.cleanup()

    def file(self, name='a.bin', data=b'original'):
        path = self.source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def run_sync(self):
        return self.sync.run_sync(self.source, self.state, operation=self.remote)

    def cache(self):
        return json.loads((self.state / 'manifest.json').read_text())

    def test_missing_remote_is_verified_then_uploaded_and_unchanged_run_uses_cache(self):
        self.file('nested/a.bin')
        result = self.run_sync()
        self.assertEqual((result['uploaded'], result['failed']), (1, 0))
        self.assertEqual(self.remote.objects, {'system-files/uploads/nested/a.bin': b'original'})
        self.assertEqual(self.remote.calls, [('verify', 'system-files/uploads/nested/a.bin', True),
                                            ('put', 'system-files/uploads/nested/a.bin', True)])
        self.remote.calls.clear()
        self.assertEqual(self.run_sync()['skipped'], 1)
        self.assertEqual(self.remote.calls, [])

    def test_existing_identical_remote_is_read_back_without_put(self):
        self.file()
        self.remote.objects['system-files/uploads/a.bin'] = b'original'
        self.assertEqual(self.run_sync()['verified'], 1)
        self.assertEqual(self.remote.calls, [('verify', 'system-files/uploads/a.bin', True)])

    def test_same_size_and_restored_mtime_does_not_hide_content_change(self):
        path = self.file(data=b'first')
        self.run_sync()
        before = path.stat()
        path.write_bytes(b'other')
        os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
        self.remote.calls.clear()
        self.assertEqual(self.run_sync()['uploaded'], 1)
        self.assertEqual(self.remote.objects['system-files/uploads/a.bin'], b'other')

    def test_unchanged_content_with_changed_stat_does_not_create_another_version(self):
        path = self.file()
        self.run_sync()
        os.utime(path, ns=(path.stat().st_atime_ns, path.stat().st_mtime_ns + 1000000))
        self.remote.calls.clear()
        self.assertEqual(self.run_sync()['verified'], 1)
        self.assertEqual([c[0] for c in self.remote.calls], ['verify'])

    def test_auth_network_and_race_errors_never_put_and_other_files_continue(self):
        for error in (StoreError('OSS_HTTP_403'), TimeoutError('private-path secret'),
                      StoreError('REMOTE_OBJECT_CHANGED'), StoreError('OSS_HTTP_412')):
            with self.subTest(error=type(error).__name__):
                self.file('bad.bin')
                self.file('good.bin')
                self.remote.errors['system-files/uploads/bad.bin'] = error
                result = self.run_sync()
                self.assertEqual(result['failed'], 1)
                self.assertEqual(result['status'], 'error')
                self.assertIn('system-files/uploads/good.bin', self.remote.objects)
                self.assertNotIn('system-files/uploads/bad.bin', self.remote.objects)
                self.assertNotIn('bad.bin', self.cache()['files'])
        self.assertFalse(any(op == 'put' and key.endswith('bad.bin') for op, key, _ in self.remote.calls))

    def test_mutation_during_remote_operation_does_not_cache_or_upload_new_unverified_bytes(self):
        path = self.file()
        self.remote.after = lambda: path.write_bytes(b'changed after snapshot')
        result = self.run_sync()
        self.assertEqual(result['failed'], 1)
        self.assertNotIn('a.bin', self.cache()['files'])
        self.assertEqual(self.remote.objects['system-files/uploads/a.bin'], b'original')
        self.remote.after = None
        self.assertEqual(self.run_sync()['uploaded'], 1)

    def test_failed_put_is_retried_by_verify_without_duplicate_put(self):
        self.file()
        original = self.remote
        def interrupted(operation, path, key, readback=False):
            result = original(operation, path, key, readback)
            if operation == 'put':
                raise TimeoutError('response lost after commit')
            return result
        result = self.sync.run_sync(self.source, self.state, operation=interrupted)
        self.assertEqual(result['failed'], 1)
        self.remote.calls.clear()
        self.assertEqual(self.run_sync()['verified'], 1)
        self.assertEqual([c[0] for c in self.remote.calls], ['verify'])

    def test_symlink_file_directory_and_root_are_rejected(self):
        outside = self.base / 'private'
        outside.mkdir()
        (outside / 'secret').write_bytes(b'private')
        (self.source / 'file-link').symlink_to(outside / 'secret')
        (self.source / 'dir-link').symlink_to(outside, target_is_directory=True)
        result = self.run_sync()
        self.assertEqual(result['failed'], 2)
        self.assertEqual(self.remote.calls, [])
        root_link = self.base / 'uploads-link'
        root_link.symlink_to(self.source, target_is_directory=True)
        with self.assertRaises(Exception):
            self.sync.run_sync(root_link, self.state, operation=self.remote)

    def test_post_transfer_identity_check_rejects_replaced_parent_symlink(self):
        self.file('nested/a.bin')
        outside = self.base / 'outside'
        outside.mkdir()
        (outside / 'a.bin').write_bytes(b'private')
        root = self.sync._directory(self.source)
        try:
            self.sync._current_identity(root, 'nested/a.bin')
            (self.source / 'nested').rename(self.source / 'moved')
            (self.source / 'nested').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(Exception):
                self.sync._current_identity(root, 'nested/a.bin')
        finally:
            os.close(root)

    def test_source_deletion_never_deletes_remote(self):
        path = self.file()
        self.run_sync()
        path.unlink()
        self.remote.calls.clear()
        result = self.run_sync()
        self.assertEqual(result['failed'], 0)
        self.assertEqual(self.remote.objects['system-files/uploads/a.bin'], b'original')
        self.assertEqual(self.remote.calls, [])

    def test_lock_contention_skips_without_operations(self):
        import fcntl
        self.file()
        self.state.mkdir(mode=0o700)
        with (self.state / 'sync.lock').open('wb') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.run_sync()['status'], 'locked')
        self.assertEqual(self.remote.calls, [])

    def test_low_disk_space_fails_without_upload(self):
        self.file()
        info = type('Disk', (), {'f_bavail': 0, 'f_frsize': 4096})()
        with mock.patch.object(self.sync.os, 'fstatvfs', return_value=info):
            self.assertEqual(self.run_sync()['failed'], 1)
        self.assertEqual(self.remote.calls, [])

    def test_state_symlinks_and_corrupt_cache_fail_closed(self):
        self.file()
        self.state.mkdir(mode=0o700)
        outside = self.base / 'private-cache'
        outside.write_text('private')
        cache = self.state / 'manifest.json'
        cache.symlink_to(outside)
        with self.assertRaises(Exception):
            self.run_sync()
        self.assertEqual(outside.read_text(), 'private')
        cache.unlink()
        cache.write_text('{broken')
        with self.assertRaises(Exception):
            self.run_sync()
        self.assertEqual(self.remote.calls, [])

    def test_cache_replace_failure_keeps_previous_atomic_json(self):
        path = self.file()
        self.run_sync()
        old_cache = (self.state / 'manifest.json').read_bytes()
        path.write_bytes(b'updated')
        with mock.patch.object(self.sync.os, 'replace', side_effect=OSError('private path')):
            with self.assertRaises(Exception):
                self.run_sync()
        self.assertEqual((self.state / 'manifest.json').read_bytes(), old_cache)
        self.assertEqual(sorted(p.name for p in self.state.iterdir()), ['manifest.json', 'sync.lock'])

    def test_main_returns_nonzero_and_never_logs_exception_detail(self):
        output = io.StringIO()
        with mock.patch.object(self.sync.sys, 'argv', ['oss-sync.py']), mock.patch.object(
                self.sync, 'run_sync', side_effect=RuntimeError('secret /customer/name')):
            with contextlib.redirect_stdout(output):
                self.assertEqual(self.sync.main(), 1)
        parsed = json.loads(output.getvalue())
        self.assertEqual(parsed['status'], 'error')
        self.assertNotIn('secret', output.getvalue())
        self.assertNotIn('customer', output.getvalue())

    def test_main_preserves_partial_failure_counts_and_nonzero_exit(self):
        result = {'status': 'error', 'scanned': 2, 'uploaded': 1, 'verified': 0,
                  'skipped': 0, 'failed': 1, 'bytes': 8}
        output = io.StringIO()
        with mock.patch.object(self.sync.sys, 'argv', ['oss-sync.py']), mock.patch.object(
                self.sync, 'run_sync', return_value=result), contextlib.redirect_stdout(output):
            self.assertEqual(self.sync.main(), 1)
        self.assertEqual(json.loads(output.getvalue()), result)

    def test_crash_leftover_snapshots_are_removed_under_lock_before_next_copy(self):
        self.file()
        self.state.mkdir(mode=0o700)
        (self.state / ('.snapshot-' + 'a' * 32)).write_bytes(b'old private copy')
        (self.state / ('.manifest-' + 'b' * 32)).write_bytes(b'old partial manifest')
        (self.state / 'unrelated').write_bytes(b'keep')
        result = self.run_sync()
        self.assertEqual(result['failed'], 0)
        self.assertEqual(sorted(p.name for p in self.state.iterdir()),
                         ['manifest.json', 'sync.lock', 'unrelated'])

    def test_replaced_source_root_does_not_commit_cache(self):
        self.file()
        outside = self.base / 'outside'
        outside.mkdir()
        (outside / 'a.bin').write_bytes(b'private')
        original_open = self.sync._directory
        replaced = False
        def swap():
            nonlocal replaced
            replaced = True
        def reopen(path, create=False):
            # DrvFS forbids renaming an open directory. Emulate pathname
            # resolution to another real inode after the initial remote call.
            return original_open(outside if replaced and path == self.source else path, create)
        self.remote.after = swap
        with mock.patch.object(self.sync, '_directory', side_effect=reopen):
            with self.assertRaises(Exception):
                self.run_sync()
        self.assertTrue(replaced)
        self.assertFalse((self.state / 'manifest.json').exists())
        self.assertNotIn(b'private', self.remote.objects.values())

    def test_oversized_file_and_hardlink_are_rejected_without_transfer(self):
        self.file(data=b'123456789')
        os.link(self.source / 'a.bin', self.source / 'hardlink.bin')
        self.file('oversized.bin', b'123456789')
        with mock.patch.object(self.sync, 'MAX_BYTES', 8):
            self.assertEqual(self.run_sync()['failed'], 3)
        self.assertEqual(self.remote.calls, [])

    def test_cache_failure_exit_preserves_completed_transfer_counts(self):
        self.file()
        run = self.sync.run_sync
        output = io.StringIO()
        with mock.patch.object(self.sync.sys, 'argv', ['oss-sync.py']), mock.patch.object(
                self.sync, 'run_sync', side_effect=lambda: run(self.source, self.state, self.remote)), \
                mock.patch.object(self.sync.os, 'replace', side_effect=OSError('private cache path')), \
                contextlib.redirect_stdout(output):
            self.assertEqual(self.sync.main(), 1)
        result = json.loads(output.getvalue())
        self.assertEqual((result['uploaded'], result['failed']), (1, 1))
        self.assertNotIn('private', output.getvalue())


if __name__ == '__main__':
    unittest.main()
