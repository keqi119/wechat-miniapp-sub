#!/usr/bin/env python3
"""Encrypted RDS/files backup and isolated, networkless restore verification."""
import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path('/opt/ninda-platform')
BACKUPS = ROOT / 'backups'
CLIENT = ['docker', 'run', '--rm', '-i', '--network', 'host', '--env-file',
          str(ROOT / 'secrets/rds-client.env'), 'postgres:17-alpine']


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def run(args, *, data=None, output=subprocess.PIPE, timeout=600):
    return subprocess.run(args, input=data, stdout=output, stderr=subprocess.PIPE,
                          timeout=timeout, check=True).stdout


def archive_path(value):
    path = pathlib.Path(value)
    if path.is_symlink() or path.resolve().parent != BACKUPS or not path.name.endswith('.tar.enc'):
        raise ValueError('Invalid backup path')
    return path


def encryption(decrypt=False):
    return ['openssl', 'enc', *(['-d'] if decrypt else []), '-aes-256-cbc',
            '-pbkdf2', '-iter', '200000', '-pass', 'file:' + str(ROOT / 'secrets/backup.key')]


def pipeline(first, second, *, output=None):
    """Consume both processes; keep all plaintext on the pipe or private temp files."""
    with tempfile.TemporaryFile() as errors:
        producer = subprocess.Popen(first, stdout=subprocess.PIPE, stderr=errors)
        try:
            consumer = subprocess.run(second, stdin=producer.stdout, stdout=output,
                                      stderr=errors, timeout=1800)
            producer.stdout.close()
            status = producer.wait(timeout=60)
            if consumer.returncode or status:
                raise RuntimeError('Backup pipeline failed')
        finally:
            if producer.poll() is None:
                producer.terminate()
                producer.wait(timeout=15)


def export_backup(wait=False):
    with (BACKUPS / '.lock').open('a') as lock:
        if wait:
            deadline = time.monotonic() + 600
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(1)
        else:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print(json.dumps({'status': 'SKIPPED_LOCKED'}))
                return
        # Retire verified old copies before checking free space, so a full disk
        # cannot prevent safe retention from making room for today's backup.
        retention = {'retired': 0, 'pending': 0}
        if (ROOT / 'deploy/oss_store.py').is_file() and (ROOT / 'deploy/oss-backup.json').is_file():
            retention = prune_verified_local_backups()
        if shutil.disk_usage(BACKUPS).free < 3_000_000_000:
            raise RuntimeError('Insufficient backup space')
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        archive = BACKUPS / (stamp + '.tar.enc')
        partial = BACKUPS / (stamp + '.tar.enc.part')
        try:
            with tempfile.TemporaryDirectory(prefix='.work.rds.', dir=BACKUPS) as temp:
                work = pathlib.Path(temp)
                with (work / 'database.dump').open('xb') as dump:
                    run(CLIENT + ['pg_dump', '-Fc', '--no-owner', '--no-acl', '--no-tablespaces'], output=dump)
                with (work / 'database.contents').open('xb') as contents:
                    run(CLIENT + ['pg_restore', '--list'], data=(work / 'database.dump').read_bytes(), output=contents)
                manifest = {'format': 'ninda-rds-full-v2', 'createdAt': stamp,
                            'databaseDumpSha256': digest(work / 'database.dump'),
                            'database': 'ninda_prod', 'uploads': 'uploads/',
                            'configuration': ['.env.production', '.env.active', 'deploy', 'secrets'],
                            'hostConfiguration': ['nginx', 'letsencrypt', 'systemd'],
                            'apiImageIncluded': False}
                manifest['databaseInventory'] = json.loads(run(CLIENT + ['psql', '-X', '-qAt',
                    '-v', 'ON_ERROR_STOP=1', '-c', "SELECT json_build_object('tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),'migrations',(SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL))"]))
                # Full uploads stream directly into the encrypted archive; no second
                # multi-GB plaintext uploads tar is created on the ECS system disk.
                config = ['.env.production', '.env.active', 'deploy/compose.production.yml',
                          'deploy/backup.sh', 'deploy/verify-backup.sh', 'deploy/rds-backup.py']
                for optional in ['deploy/oss_store.py', 'deploy/oss-backup.json', 'deploy/oss-sync.py',
                                 'deploy/ninda-file-sync.service', 'deploy/ninda-file-sync.timer',
                                 'deploy/nginx-production.conf', 'deploy/nginx-admin-static-performance.conf']:
                    if (ROOT / optional).is_file():
                        config.append(optional)
                release = (ROOT / 'current').resolve(strict=True)
                if release.parent != ROOT / 'releases':
                    raise RuntimeError('Invalid active release path')
                manifest['staticRelease'] = release.relative_to(ROOT).as_posix()
                config.append(manifest['staticRelease'])
                host_config = [p for p in ['nginx', 'letsencrypt',
                    'systemd/system/ninda-backup.service', 'systemd/system/ninda-backup.timer',
                    'systemd/system/ninda-file-sync.service', 'systemd/system/ninda-file-sync.timer',
                    'systemd/system/ninda-tls.service', 'systemd/system/ninda-tls.timer']
                    if (pathlib.Path('/etc') / p).exists()]
                (work / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
                pipeline(['tar', '-czf', '-', '-C', str(work), 'database.dump', 'database.contents',
                          'manifest.json', '-C', str(ROOT), 'uploads', *config, 'secrets',
                          '-C', '/etc', *host_config],
                         encryption() + ['-salt', '-out', str(partial)])
                partial.chmod(0o600)
                os.replace(partial, archive)
                (BACKUPS / (stamp + '.sha256')).write_text(digest(archive) + '  ' + archive.name + '\n')
        finally:
            if partial.exists():
                partial.unlink()
        restored = verify_backup(archive)
        uploader = ROOT / 'deploy/oss_store.py'
        if uploader.is_file() and (ROOT / 'deploy/oss-backup.json').is_file():
            # Uploader exits nonzero unless its server-side checksum/readback passes.
            run(['python3', str(uploader), 'put', str(archive), 'backups/' + archive.name, '--readback'], timeout=1800)
            checksum = BACKUPS / (stamp + '.sha256')
            run(['python3', str(uploader), 'put', str(checksum), 'backups/' + checksum.name], timeout=120)
            receipt = {'archive': archive.name, 'sha256': digest(archive), 'verifiedAt': time.time(), 'fullReadback': True}
            (BACKUPS / (stamp + '.oss-verified.json')).write_text(json.dumps(receipt))
            prune_verified_local_backups()
        print(json.dumps({'status': 'BACKUP_VERIFIED', 'archive': str(archive),
                          'sha256': digest(archive), 'bytes': archive.stat().st_size,
                          'restoredInventory': restored, 'retention': retention,
                          'ossUploaded': (BACKUPS / (stamp + '.oss-verified.json')).exists()}))


def prune_verified_local_backups():
    """Keep seven local days; never remove an archive without a verified OSS copy."""
    cutoff = time.time() - 7 * 24 * 3600
    result = {'retired': 0, 'pending': 0}
    for path in BACKUPS.glob('*.tar.enc'):
        archive_path(path)
        receipt_path = path.with_name(path.name[:-8] + '.oss-verified.json')
        if path.stat().st_mtime >= cutoff or not receipt_path.is_file():
            continue
        receipt = json.loads(receipt_path.read_text())
        if receipt.get('archive') != path.name or receipt.get('sha256') != digest(path):
            raise RuntimeError('Archived backup receipt mismatch')
        # A historic receipt alone is not enough: the remote object may have
        # expired under lifecycle rules while this machine was offline.
        try:
            run(['python3', str(ROOT / 'deploy/oss_store.py'), 'verify', str(path),
                 'backups/' + path.name, '--readback'], timeout=1800)
        except (subprocess.SubprocessError, OSError):
            # Remote outages or lifecycle expiry must retain this file, but may
            # not prevent creating today's local backup if disk space permits.
            result['pending'] += 1
            continue
        path.unlink()
        checksum = path.with_name(path.name[:-8] + '.sha256')
        if checksum.is_file() and not checksum.is_symlink():
            checksum.unlink()
        receipt['localRetiredAt'] = time.time()
        receipt_path.write_text(json.dumps(receipt))
        result['retired'] += 1
    return result


def verify_backup(value):
    archive = archive_path(value)
    checksum = archive.with_name(archive.name[:-8] + '.sha256')
    if not checksum.is_file() or checksum.read_text().split()[0] != digest(archive):
        raise RuntimeError('Backup checksum mismatch')
    container = 'ninda-rds-restore-check-' + str(os.getpid())
    started = False
    with tempfile.TemporaryDirectory(prefix='.verify.rds.', dir=BACKUPS) as temp:
        work = pathlib.Path(temp)
        # Consume and validate the full compressed archive while extracting only
        # the small database dump and manifest needed for the isolated restore.
        pipeline(encryption(True) + ['-in', str(archive)],
                 ['tar', '-xzf', '-', '-C', str(work), 'database.dump', 'manifest.json'])
        manifest = json.loads((work / 'manifest.json').read_text())
        if manifest['format'] != 'ninda-rds-full-v2' or manifest['databaseDumpSha256'] != digest(work / 'database.dump'):
            raise RuntimeError('Invalid backup manifest')
        try:
            started = True  # Also clean up when Docker creates it before a CLI timeout.
            run(['docker', 'run', '-d', '--name', container, '--network', 'none', '--memory', '512m',
                 '--tmpfs', '/var/lib/postgresql/data:size=384m', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
                 '-e', 'POSTGRES_USER=ninda_verify', '-e', 'POSTGRES_DB=ninda_verify', 'postgres:17-alpine'])
            for attempt in range(60):
                probe = subprocess.run(['docker', 'exec', container, 'pg_isready', '-U', 'ninda_verify'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if probe.returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError('Restore database not ready')
            run(['docker', 'exec', '-i', container, 'pg_restore', '--exit-on-error', '--single-transaction',
                 '--no-owner', '--no-acl', '-U', 'ninda_verify', '-d', 'ninda_verify'],
                data=(work / 'database.dump').read_bytes())
            result = run(['docker', 'exec', container, 'psql', '-X', '-qAt', '-U', 'ninda_verify',
                          '-d', 'ninda_verify', '-v', 'ON_ERROR_STOP=1', '-c',
                          "SELECT json_build_object('tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),'migrations',(SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL))"])
            restored = json.loads(result)
            if restored['tables'] < 188 or (manifest.get('databaseInventory') and restored != manifest['databaseInventory']):
                raise RuntimeError('Incomplete restore')
        finally:
            if started:
                subprocess.run(['docker', 'rm', '-f', container], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=30)
                remaining = subprocess.run(['docker', 'inspect', container], stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL, timeout=15)
                if remaining.returncode == 0:
                    raise RuntimeError('Restore container cleanup failed')
        return restored


if __name__ == '__main__':
    os.umask(0o077)
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        if len(sys.argv) >= 2 and sys.argv[1] == 'backup' and sys.argv[2:] in ([], ['--wait']):
            export_backup(sys.argv[2:] == ['--wait'])
        elif len(sys.argv) == 3 and sys.argv[1] == 'verify':
            restored = verify_backup(sys.argv[2])
            print(json.dumps({'status': 'RESTORE_VERIFIED', 'networkIsolated': True, 'restoredInventory': restored}))
        else:
            raise ValueError('Unsupported command')
    except (Exception, KeyboardInterrupt) as error:
        print(json.dumps({'status': 'FAILED', 'kind': type(error).__name__}), file=sys.stderr)
        sys.exit(1)
