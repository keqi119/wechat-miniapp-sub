#!/usr/bin/env python3
"""Incremental, append-only uploads mirror. Linux and Python standard library.

Only fixed ECS-role oss_store operations contact OSS. A verified local stat cache
avoids repeated PUT versions; a lost response is recovered by verify-before-PUT.
No source or remote object is deleted. Local snapshots are single-file, private,
space-checked and removed after use. Logs contain counts only.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys

from oss_store import MAX_BYTES, StoreError, run_operation

SOURCE = Path('/opt/ninda-platform/uploads')
STATE = Path('/opt/ninda-platform/backups/.file-sync')
PREFIX = 'system-files/uploads/'
CHUNK = 1024 * 1024
RESERVE_BYTES = 128 * 1024 * 1024
CACHE_LIMIT = 64 * 1024 * 1024
REPLACEABLE = frozenset(('OSS_HTTP_404', 'REMOTE_SIZE_MISMATCH',
                         'REMOTE_HASH_METADATA_MISMATCH', 'REMOTE_READBACK_MISMATCH'))


class SyncError(Exception):
    pass


class SyncRunError(SyncError):
    def __init__(self, summary):
        super().__init__('SYNC_FAILED')
        self.summary = {**summary, 'status': 'error', 'failed': summary['failed'] + 1}


def _summary():
    return {'status': 'ok', 'scanned': 0, 'skipped': 0, 'verified': 0,
            'uploaded': 0, 'failed': 0, 'bytes': 0}


def _flags(directory=False):
    if os.name != 'posix' or not hasattr(os, 'O_NOFOLLOW'):
        raise SyncError('UNSUPPORTED_PLATFORM')
    return (os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK
            | (os.O_DIRECTORY if directory else 0))


def _directory(path, create=False):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise SyncError('UNSAFE_DIRECTORY')
    descriptor = os.open('/', _flags(True))
    try:
        for part in path.parts[1:]:
            if create:
                try:
                    os.mkdir(part, mode=0o700, dir_fd=descriptor)
                except FileExistsError:
                    pass
            child = os.open(part, _flags(True), dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _identity(info):
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise SyncError('UNSAFE_FILE')
    if info.st_size > MAX_BYTES:
        raise SyncError('FILE_TOO_LARGE')
    return [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns]


def _key(relative):
    if (not relative or relative.startswith('/') or '\\' in relative
            or any(p in ('', '.', '..') for p in relative.split('/'))
            or any(ord(c) < 32 or ord(c) == 127 for c in relative)
            or len((PREFIX + relative).encode('utf-8')) > 1023):
        raise SyncError('UNSAFE_OBJECT_KEY')
    return PREFIX + relative


def _walk(directory, prefix='', depth=0):
    """Yield relative name and an open regular-file fd, or an error sentinel."""
    try:
        if depth > 64:
            raise SyncError('DIRECTORY_DEPTH')
        with os.scandir(directory) as entries:
            names = sorted(entry.name for entry in entries)
    except Exception:
        yield None, None
        return
    for name in names:
        relative = prefix + name
        descriptor = None
        try:
            _key(relative)
            info = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                descriptor = os.open(name, _flags(True), dir_fd=directory)
                opened = os.fstat(descriptor)
                if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                    raise SyncError('SOURCE_CHANGED')
                yield from _walk(descriptor, relative + '/', depth + 1)
            elif stat.S_ISREG(info.st_mode):
                descriptor = os.open(name, _flags(), dir_fd=directory)
                if _identity(os.fstat(descriptor)) != _identity(info):
                    raise SyncError('SOURCE_CHANGED')
                yield relative, descriptor
            else:
                raise SyncError('UNSAFE_SOURCE')
        except Exception:
            yield relative, None
        finally:
            if descriptor is not None:
                os.close(descriptor)


def _current_identity(root, relative):
    _key(relative)
    descriptor = os.dup(root)
    try:
        parts = relative.split('/')
        for part in parts[:-1]:
            child = os.open(part, _flags(True), dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        file = os.open(parts[-1], _flags(), dir_fd=descriptor)
        try:
            return _identity(os.fstat(file))
        finally:
            os.close(file)
    finally:
        os.close(descriptor)


def _new_file(directory, prefix):
    name = prefix + secrets.token_hex(16)
    descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
                         | os.O_CLOEXEC, 0o600, dir_fd=directory)
    return name, descriptor


def _cleanup_temps(directory):
    # This runs only while holding the exclusive sync lock. A terminated process
    # may leave one snapshot or an uncommitted manifest; unrelated files stay.
    with os.scandir(directory) as entries:
        names = [entry.name for entry in entries
                 if re.fullmatch(r'\.(?:snapshot|manifest)-[0-9a-f]{32}', entry.name)]
    for name in names:
        info = os.stat(name, dir_fd=directory, follow_symlinks=False)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.geteuid():
            raise SyncError('UNSAFE_TEMP_FILE')
        os.unlink(name, dir_fd=directory)


def _check_named_root(source, root):
    current = _directory(source)
    try:
        actual, expected = os.fstat(current), os.fstat(root)
        if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
            raise SyncError('SOURCE_ROOT_CHANGED')
    finally:
        os.close(current)


def _snapshot(source, directory, identity):
    space = os.fstatvfs(directory)
    if space.f_bavail * space.f_frsize < identity[2] + RESERVE_BYTES:
        raise SyncError('INSUFFICIENT_SPACE')
    name, descriptor = _new_file(directory, '.snapshot-')
    try:
        count, digest = 0, hashlib.sha256()
        with os.fdopen(descriptor, 'wb') as output:
            while True:
                block = os.read(source, CHUNK)
                if not block:
                    break
                count += len(block)
                if count > identity[2]:
                    raise SyncError('SOURCE_CHANGED')
                output.write(block)
                digest.update(block)
            output.flush()
            os.fsync(output.fileno())
        if count != identity[2] or _identity(os.fstat(source)) != identity:
            raise SyncError('SOURCE_CHANGED')
        return name, digest.hexdigest()
    except BaseException:
        os.unlink(name, dir_fd=directory)
        raise


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise SyncError('INVALID_CACHE')
        result[key] = value
    return result


def _load_cache(directory, source):
    empty = {'version': 1, 'source': str(source), 'files': {}}
    try:
        descriptor = os.open('manifest.json', _flags(), dir_fd=directory)
    except FileNotFoundError:
        return empty
    with os.fdopen(descriptor, 'rb') as file:
        info = os.fstat(file.fileno())
        _identity(info)
        if info.st_uid != os.geteuid() or info.st_size > CACHE_LIMIT:
            raise SyncError('INVALID_CACHE')
        data = file.read(CACHE_LIMIT + 1)
    cache = json.loads(data, object_pairs_hook=_unique)
    if (not isinstance(cache, dict) or set(cache) != set(empty)
            or cache['version'] != 1 or cache['source'] != str(source)
            or not isinstance(cache['files'], dict)):
        raise SyncError('INVALID_CACHE')
    for relative, record in cache['files'].items():
        _key(relative)
        if (not isinstance(record, dict) or set(record) != {'identity', 'sha256', 'bytes'}
                or not isinstance(record['identity'], list) or len(record['identity']) != 5
                or any(type(n) is not int or n < 0 for n in record['identity'])
                or type(record['bytes']) is not int or record['bytes'] != record['identity'][2]
                or record['bytes'] > MAX_BYTES
                or not isinstance(record['sha256'], str)
                or not re.fullmatch('[0-9a-f]{64}', record['sha256'])):
            raise SyncError('INVALID_CACHE')
    return cache


def _save_cache(directory, cache):
    data = json.dumps(cache, sort_keys=True, separators=(',', ':')).encode('utf-8')
    if len(data) > CACHE_LIMIT:
        raise SyncError('CACHE_TOO_LARGE')
    name, descriptor = _new_file(directory, '.manifest-')
    try:
        with os.fdopen(descriptor, 'wb') as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.replace(name, 'manifest.json', src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
    finally:
        try:
            os.unlink(name, dir_fd=directory)
        except FileNotFoundError:
            pass


def _check_result(result, operation, size, digest):
    expected = 'verified_readback' if operation == 'verify' else 'put_verified_readback'
    if (not isinstance(result, dict) or result.get('status') != expected
            or result.get('count') != 1 or result.get('bytes') != size
            or result.get('sha256') != digest):
        raise SyncError('INVALID_VERIFICATION_RESULT')


def run_sync(source=SOURCE, state=STATE, operation=run_operation):
    import fcntl
    source, state = Path(source), Path(state)
    if os.path.commonpath((source, state)) in (str(source), str(state)):
        raise SyncError('OVERLAPPING_DIRECTORIES')
    root = _directory(source)
    state_fd = lock = None
    summary = _summary()
    try:
        state_fd = _directory(state, create=True)
        if os.fstat(state_fd).st_uid != os.geteuid():
            raise SyncError('UNSAFE_STATE_OWNER')
        os.fchmod(state_fd, 0o700)
        lock = os.open('sync.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW
                       | os.O_NONBLOCK | os.O_CLOEXEC, 0o600, dir_fd=state_fd)
        _identity(os.fstat(lock))
        if os.fstat(lock).st_uid != os.geteuid():
            raise SyncError('UNSAFE_LOCK_OWNER')
        os.fchmod(lock, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            summary['status'] = 'locked'
            return summary
        cache = _load_cache(state_fd, source)
        _cleanup_temps(state_fd)
        for relative, descriptor in _walk(root):
            summary['scanned'] += 1
            snapshot = None
            try:
                if descriptor is None:
                    raise SyncError('UNSAFE_OR_UNREADABLE_SOURCE')
                identity = _identity(os.fstat(descriptor))
                if cache['files'].get(relative, {}).get('identity') == identity:
                    if _current_identity(root, relative) != identity:
                        raise SyncError('SOURCE_CHANGED')
                    summary['skipped'] += 1
                    continue
                cache['files'].pop(relative, None)
                snapshot, digest = _snapshot(descriptor, state_fd, identity)
                # The directory is anchored by an open fd; oss_store also refuses
                # a symlink final component. Renaming parents cannot redirect it.
                path = '/proc/self/fd/' + str(state_fd) + '/' + snapshot
                action = 'verify'
                try:
                    result = operation(action, path, _key(relative), readback=True)
                except StoreError as error:
                    if str(error) not in REPLACEABLE:
                        raise
                    action = 'put'
                    result = operation(action, path, _key(relative), readback=True)
                _check_result(result, action, identity[2], digest)
                if (_identity(os.fstat(descriptor)) != identity
                        or _current_identity(root, relative) != identity):
                    raise SyncError('SOURCE_CHANGED')
                cache['files'][relative] = {'identity': identity, 'sha256': digest, 'bytes': identity[2]}
                summary['uploaded' if action == 'put' else 'verified'] += 1
                summary['bytes'] += identity[2]
            except Exception:
                if relative is not None:
                    cache['files'].pop(relative, None)
                summary['failed'] += 1
            finally:
                if snapshot is not None:
                    os.unlink(snapshot, dir_fd=state_fd)
        # Deleted source entries remain in this private cache. Neither a scan nor
        # a missing source authorizes remote deletion. Every cache write is atomic.
        _check_named_root(source, root)
        _save_cache(state_fd, cache)
        if summary['failed']:
            summary['status'] = 'error'
        return summary
    except Exception:
        raise SyncRunError(summary) from None
    finally:
        if lock is not None:
            os.close(lock)
        if state_fd is not None:
            os.close(state_fd)
        os.close(root)


def main():
    try:
        if len(sys.argv) != 1:
            raise SyncError('INVALID_ARGUMENTS')
        result = run_sync()
    except SyncRunError as error:
        result = error.summary
    except KeyboardInterrupt:
        result = _summary()
        result.update(status='error', failed=1)
        print(json.dumps(result, separators=(',', ':')))
        return 130
    except Exception:
        result = _summary()
        result.update(status='error', failed=1)
    print(json.dumps(result, separators=(',', ':')))
    return 1 if result['failed'] else 0


if __name__ == '__main__':
    sys.exit(main())
