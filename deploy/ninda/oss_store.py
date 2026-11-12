#!/usr/bin/env python3
"""Standalone OSS backup transfer; Python standard library only.

Credentials come exclusively from the fixed ECS RAM role through IMDSv2.
No proxy, redirect, public endpoint, long-lived key or IMDSv1 fallback is used.
Sources:
https://help.aliyun.com/en/oss/developer-reference/recommend-to-use-signature-version-4
https://help.aliyun.com/en/ecs/user-guide/view-instance-metadata/

put PATH OBJECT [--readback] or put --file PATH --key OBJECT [--readback]
verify PATH OBJECT [--readback] or verify --file PATH --key OBJECT [--readback]
Failures never delete objects or files; an interrupted PUT may have committed.
"""
import argparse
import base64
import datetime as dt
from dataclasses import dataclass
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
import re
import ssl
import stat
import sys
import urllib.parse

BUCKET = 'ninda-dr-1783788246413914-cn-shanghai'
REGION = 'cn-shanghai'
HOST = BUCKET + '.oss-cn-shanghai-internal.aliyuncs.com'
IMDS_HOST = '100.100.100.200'
ROLE = 'NindaBackupRole20261113'
ALLOWED_PREFIXES = ('system-files/', 'backups/', 'manifests/')
MAX_BYTES = 5 * 1024 ** 3
CHUNK_BYTES = 1024 ** 2
HTTP_TIMEOUT = 120
IMDS_TIMEOUT = 5
CONFIG_PATH = Path(__file__).resolve().with_name('oss-backup.json')


class StoreError(Exception):
    """Only static error codes are allowed to reach the CLI."""


@dataclass(frozen=True, repr=False)
class Credentials:
    access_key_id: str
    access_key_secret: str
    security_token: str


def validate_config():
    """An optional manifest may confirm the fixed destination, never override it."""
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise StoreError('INVALID_CONFIG')
            result[key] = value
        return result
    try:
        try:
            file = CONFIG_PATH.open('rb')
        except FileNotFoundError:
            return
        with file:
            data = file.read(4097)
        if len(data) > 4096:
            raise StoreError('INVALID_CONFIG')
        document = json.loads(data.decode('utf-8-sig'), object_pairs_hook=unique_object)
        if document != {'bucket': BUCKET, 'region': REGION, 'role': ROLE}:
            raise StoreError('INVALID_CONFIG')
    except Exception:
        raise StoreError('INVALID_CONFIG') from None


def _imds_request(method, path, headers, limit):
    # http.client ignores HTTP(S)_PROXY and never follows redirects.
    connection = http.client.HTTPConnection(IMDS_HOST, timeout=IMDS_TIMEOUT)
    try:
        connection.request(method, path, headers=headers)
        response = connection.getresponse()
        if response.status != 200:
            raise StoreError('IMDS_UNAVAILABLE')
        body = response.read(limit + 1)
        if len(body) > limit:
            raise StoreError('IMDS_INVALID_RESPONSE')
        return body
    finally:
        connection.close()


def _safe_header(value):
    return isinstance(value, str) and bool(value) and all(32 <= ord(c) <= 126 for c in value)


def fetch_credentials():
    token = _imds_request('PUT', '/latest/api/token',
                          {'X-aliyun-ecs-metadata-token-ttl-seconds': '600'}, 4096).decode('ascii')
    if not _safe_header(token):
        raise StoreError('IMDS_INVALID_TOKEN')
    body = _imds_request('GET', '/latest/meta-data/ram/security-credentials/' + ROLE,
                        {'X-aliyun-ecs-metadata-token': token}, 16384)
    document = json.loads(body)
    values = [document.get(k) for k in ('AccessKeyId', 'AccessKeySecret', 'SecurityToken')]
    if document.get('Code') != 'Success' or not all(_safe_header(value) for value in values):
        raise StoreError('IMDS_INVALID_CREDENTIALS')
    expiration = dt.datetime.fromisoformat(document['Expiration'].replace('Z', '+00:00'))
    if expiration.tzinfo is None or expiration <= dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5):
        raise StoreError('IMDS_CREDENTIALS_EXPIRING')
    return Credentials(*values)


def _validate_key(key):
    if (not isinstance(key, str) or not key or len(key.encode('utf-8')) > 1023
            or key.startswith(('/', '\\')) or '\\' in key
            or not key.startswith(ALLOWED_PREFIXES) or key.endswith('/')
            or any(ord(c) < 32 or ord(c) == 127 for c in key)
            or any(part in ('.', '..') for part in key.split('/'))):
        raise StoreError('INVALID_OBJECT_KEY')


def sign_headers(method, key, headers, credentials, timestamp=None):
    _validate_key(key)
    if method not in ('PUT', 'HEAD', 'GET'):
        raise StoreError('UNSUPPORTED_METHOD')
    timestamp = timestamp or dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    signed = {name.lower(): str(value).strip() for name, value in headers.items()}
    signed.update({'x-oss-date': timestamp, 'x-oss-content-sha256': 'UNSIGNED-PAYLOAD',
                   'x-oss-security-token': credentials.security_token})
    if not all(_safe_header(value) for value in signed.values()):
        raise StoreError('INVALID_REQUEST_HEADER')
    additional = sorted(name for name in signed if not name.startswith('x-oss-')
                        and name not in ('content-type', 'content-md5'))
    canonical_headers = ''.join(name + ':' + signed[name] + '\n' for name in sorted(signed))
    canonical_uri = urllib.parse.quote('/' + BUCKET + '/' + key, safe='/~')
    canonical_request = '\n'.join((method, canonical_uri, '', canonical_headers,
                                   ';'.join(additional), 'UNSIGNED-PAYLOAD'))
    scope = timestamp[:8] + '/' + REGION + '/oss/aliyun_v4_request'
    string_to_sign = '\n'.join(('OSS4-HMAC-SHA256', timestamp, scope,
                                 hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()))
    signing_key = ('aliyun_v4' + credentials.access_key_secret).encode('utf-8')
    for component in (timestamp[:8], REGION, 'oss', 'aliyun_v4_request'):
        signing_key = hmac.new(signing_key, component.encode('utf-8'), hashlib.sha256).digest()
    signature = hmac.new(signing_key, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()
    signed['authorization'] = ('OSS4-HMAC-SHA256 Credential=' + credentials.access_key_id + '/' + scope
                               + ', Signature=' + signature + ', AdditionalHeaders=' + ';'.join(additional))
    return signed


def _file_identity(file):
    info = os.fstat(file.fileno())
    if not stat.S_ISREG(info.st_mode):
        raise StoreError('FILE_NOT_REGULAR')
    if info.st_size > MAX_BYTES:
        raise StoreError('FILE_TOO_LARGE')
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _unchanged(file, identity):
    if _file_identity(file) != identity:
        raise StoreError('FILE_CHANGED')


def _hash_file(file):
    identity = _file_identity(file)
    md5 = hashlib.md5()
    sha256 = hashlib.sha256()
    count = 0
    while True:
        block = file.read(CHUNK_BYTES)
        if not block:
            break
        count += len(block)
        if count > identity[2]:
            raise StoreError('FILE_CHANGED')
        md5.update(block)
        sha256.update(block)
    _unchanged(file, identity)
    if count != identity[2]:
        raise StoreError('FILE_CHANGED')
    file.seek(0)
    return identity, base64.b64encode(md5.digest()).decode('ascii'), sha256.hexdigest()


def _begin_request(method, key, headers):
    # Fresh, short-lived credentials for each operation; no secrets are persisted.
    headers = sign_headers(method, key, headers, fetch_credentials())
    connection = http.client.HTTPSConnection(HOST, timeout=HTTP_TIMEOUT, context=ssl.create_default_context())
    try:
        connection.putrequest(method, '/' + urllib.parse.quote(key, safe='/~'),
                              skip_host=True, skip_accept_encoding=True)
        for name, value in headers.items():
            connection.putheader(name, value)
        connection.endheaders()
        return connection
    except BaseException:
        connection.close()
        raise


def _successful(response):
    if response.status != 200:
        # Never read/log an OSS error body: it can contain object keys and signatures.
        raise StoreError('OSS_HTTP_' + str(int(response.status)))


def _etag(response):
    value = response.getheader('etag')
    if not _safe_header(value):
        raise StoreError('OSS_MISSING_ETAG')
    return value


def _put(file, key, identity, md5, sha256):
    _unchanged(file, identity)
    headers = {'host': HOST, 'content-length': str(identity[2]), 'content-type': 'application/octet-stream',
               'content-md5': md5, 'x-oss-meta-sha256': sha256}
    connection = _begin_request('PUT', key, headers)
    try:
        _unchanged(file, identity)
        remaining = identity[2]
        streamed_hash = hashlib.sha256()
        while remaining:
            block = file.read(min(CHUNK_BYTES, remaining))
            if not block:
                raise StoreError('FILE_CHANGED')
            connection.send(block)
            streamed_hash.update(block)
            remaining -= len(block)
        if file.read(1) or streamed_hash.hexdigest() != sha256:
            raise StoreError('FILE_CHANGED')
        _unchanged(file, identity)
        response = connection.getresponse()
        _successful(response)
        return _etag(response)
    finally:
        connection.close()


def _check_object_headers(response, size, sha256):
    if response.getheader('content-length') != str(size):
        raise StoreError('REMOTE_SIZE_MISMATCH')
    remote_hash = response.getheader('x-oss-meta-sha256', '')
    if not isinstance(remote_hash, str) or not hmac.compare_digest(remote_hash, sha256):
        raise StoreError('REMOTE_HASH_METADATA_MISMATCH')


def _head(key, size, sha256, expected_etag=None):
    headers = {'host': HOST, 'content-length': '0'}
    if expected_etag:
        headers['if-match'] = expected_etag
    connection = _begin_request('HEAD', key, headers)
    try:
        response = connection.getresponse()
        _successful(response)
        _check_object_headers(response, size, sha256)
        etag = _etag(response)
        if expected_etag and etag != expected_etag:
            raise StoreError('REMOTE_OBJECT_CHANGED')
        return etag
    finally:
        connection.close()


def _readback(key, size, sha256, etag):
    connection = _begin_request('GET', key, {'host': HOST, 'content-length': '0', 'if-match': etag})
    try:
        response = connection.getresponse()
        _successful(response)
        _check_object_headers(response, size, sha256)
        if _etag(response) != etag:
            raise StoreError('REMOTE_OBJECT_CHANGED')
        digest = hashlib.sha256()
        count = 0
        while True:
            block = response.read(CHUNK_BYTES)
            if not block:
                break
            count += len(block)
            if count > size:
                raise StoreError('REMOTE_SIZE_MISMATCH')
            digest.update(block)
        if count != size or not hmac.compare_digest(digest.hexdigest(), sha256):
            raise StoreError('REMOTE_READBACK_MISMATCH')
    finally:
        connection.close()


def run_operation(operation, path, key, readback=False):
    validate_config()
    _validate_key(key)
    if operation not in ('put', 'verify'):
        raise StoreError('UNSUPPORTED_OPERATION')
    flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, 'rb') as file:
        identity, md5, sha256 = _hash_file(file)
        expected_etag = _put(file, key, identity, md5, sha256) if operation == 'put' else None
        _unchanged(file, identity)
        etag = _head(key, identity[2], sha256, expected_etag)
        if readback:
            _readback(key, identity[2], sha256, etag)
        _unchanged(file, identity)
        status = ('put_verified_' if operation == 'put' else 'verified_') + ('readback' if readback else 'head')
        return {'status': status, 'count': 1, 'bytes': identity[2], 'sha256': sha256}


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        raise StoreError('INVALID_ARGUMENTS')


def main(argv=None):
    try:
        parser = SafeParser(description='Transfer and verify one backup using the fixed ECS role and private OSS endpoint.')
        parser.add_argument('operation', choices=('put', 'verify'))
        parser.add_argument('positional_file', nargs='?')
        parser.add_argument('positional_key', nargs='?')
        parser.add_argument('--file')
        parser.add_argument('--key')
        parser.add_argument('--readback', action='store_true')
        args = parser.parse_args(argv)
        positional = args.positional_file is not None or args.positional_key is not None
        flagged = args.file is not None or args.key is not None
        if positional and flagged:
            raise StoreError('INVALID_ARGUMENTS')
        path, key = ((args.positional_file, args.positional_key) if positional else (args.file, args.key))
        if path is None or key is None:
            raise StoreError('INVALID_ARGUMENTS')
        result = run_operation(args.operation, path, key, args.readback)
        exit_code = 0
    except StoreError as error:
        code = str(error)
        if not re.fullmatch(r'[A-Z][A-Z0-9_]{0,63}', code):
            code = 'OPERATION_FAILED'
        result = {'status': 'error_' + code.lower(), 'count': 0, 'bytes': 0, 'sha256': None}
        exit_code = 1
    except KeyboardInterrupt:
        result = {'status': 'error_interrupted', 'count': 0, 'bytes': 0, 'sha256': None}
        exit_code = 130
    except Exception:
        result = {'status': 'error_operation_failed', 'count': 0, 'bytes': 0, 'sha256': None}
        exit_code = 1
    print(json.dumps(result, separators=(',', ':')))
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
