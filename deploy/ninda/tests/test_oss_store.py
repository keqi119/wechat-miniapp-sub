"""Offline tests: fake credentials and fake HTTP transport only."""
import base64
import contextlib
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent

spec = importlib.util.spec_from_file_location('oss_store', HERE.parent / 'oss_store.py')
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
if spec.loader and (HERE.parent / 'oss_store.py').exists():
    spec.loader.exec_module(m)


class Response:
    def __init__(self, status=200, headers=None, body=b''):
        self.status = status
        self.headers = headers or {}
        self.body = io.BytesIO(body)
    def getheader(self, name, default=None):
        return self.headers.get(name.lower(), default)
    def read(self, size=-1):
        return self.body.read(size)


class Connection:
    def __init__(self, response, on_send=None):
        self.response = response
        self.sent = bytearray()
        self.headers = {}
        self.calls = []
        self.closed = False
        self.on_send = on_send
    def request(self, method, path, body=None, headers=None):
        self.calls.append((method, path, headers or {}))
    def putrequest(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
    def putheader(self, key, value):
        self.headers[key.lower()] = value
    def endheaders(self):
        pass
    def send(self, value):
        self.sent.extend(value)
        if self.on_send:
            self.on_send()
    def getresponse(self):
        return self.response
    def close(self):
        self.closed = True


class OssStoreTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(hasattr(m, 'sign_headers'), 'standalone OSS implementation is absent')
        self.creds = m.Credentials('FAKE_ID', 'FAKE_SECRET', 'FAKE_SESSION_TOKEN')
        self.temp = tempfile.TemporaryDirectory(dir=HERE)
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'private-local-name.bin'
        self.payload = b'backup\x00data\xff' * 100000
        self.path.write_bytes(self.payload)
        self.sha = hashlib.sha256(self.payload).hexdigest()
        self.md5 = base64.b64encode(hashlib.md5(self.payload).digest()).decode()
        self.remote = {'content-length': str(len(self.payload)), 'x-oss-meta-sha256': self.sha, 'etag': '"fake-etag"'}

    def test_signature_matches_official_sdk_for_unicode_and_reserved_characters(self):
        import oss2.auth
        from oss2.credentials import StaticCredentialsProvider
        from oss2.http import Request
        class FixedDate(dt.datetime):
            @classmethod
            def utcnow(cls):
                return cls(2026, 11, 13, 4, 5, 6)
        for method in ['PUT', 'HEAD', 'GET']:
            for key in ['backups/a.bin', 'backups/测试 空格+%?#.bin']:
                headers = {'host': m.HOST, 'content-length': '3'}
                if method == 'PUT':
                    headers.update({'content-md5': 'kAFQmDzST7DWlj99KOF/cg==', 'content-type': 'application/octet-stream', 'x-oss-meta-sha256': 'a' * 64})
                actual = m.sign_headers(method, key, headers, self.creds, timestamp='20261113T040506Z')
                req = Request(method, 'https://' + m.HOST + '/' + key, headers=headers, region='cn-shanghai', product='oss')
                auth = oss2.auth.ProviderAuthV4(StaticCredentialsProvider('FAKE_ID', 'FAKE_SECRET', 'FAKE_SESSION_TOKEN'))
                with patch.object(oss2.auth, 'datetime', FixedDate):
                    auth._sign_request(req, m.BUCKET, key, in_additional_headers=['content-length', 'host'])
                self.assertEqual(actual['authorization'], req.headers['authorization'])

    def test_imdsv2_only_fixed_role_and_no_proxy(self):
        token = Connection(Response(body=b'FAKE_IMDS_TOKEN'))
        document = {'Code': 'Success', 'AccessKeyId': 'FAKE_ID', 'AccessKeySecret': 'FAKE_SECRET', 'SecurityToken': 'FAKE_SESSION_TOKEN', 'Expiration': '2099-01-01T00:00:00Z'}
        role = Connection(Response(body=json.dumps(document).encode()))
        with patch.object(m.http.client, 'HTTPConnection', side_effect=[token, role]) as factory:
            result = m.fetch_credentials()
        self.assertEqual(result.access_key_id, 'FAKE_ID')
        self.assertEqual([call.args[0] for call in factory.call_args_list], ['100.100.100.200', '100.100.100.200'])
        self.assertEqual(token.calls[0][:2], ('PUT', '/latest/api/token'))
        self.assertIn('X-aliyun-ecs-metadata-token-ttl-seconds', token.calls[0][2])
        self.assertEqual(role.calls[0][:2], ('GET', '/latest/meta-data/ram/security-credentials/NindaBackupRole20261113'))
        self.assertEqual(role.calls[0][2]['X-aliyun-ecs-metadata-token'], 'FAKE_IMDS_TOKEN')
        self.assertTrue(token.closed and role.closed)

    def test_imds_failure_never_falls_back_to_v1(self):
        denied = Connection(Response(status=403, body=b'SECRET ERROR BODY'))
        with patch.object(m.http.client, 'HTTPConnection', return_value=denied) as factory:
            with self.assertRaises(m.StoreError):
                m.fetch_credentials()
        self.assertEqual(factory.call_count, 1)
        self.assertTrue(denied.closed)

    def test_imds_expired_credentials_never_reach_oss(self):
        token = Connection(Response(body=b'FAKE_IMDS_TOKEN'))
        document = {'Code': 'Success', 'AccessKeyId': 'FAKE_ID', 'AccessKeySecret': 'FAKE_SECRET', 'SecurityToken': 'FAKE_SESSION_TOKEN', 'Expiration': '2000-01-01T00:00:00Z'}
        role = Connection(Response(body=json.dumps(document).encode()))
        with patch.object(m.http.client, 'HTTPConnection', side_effect=[token, role]), patch.object(m.http.client, 'HTTPSConnection') as oss:
            with self.assertRaises(m.StoreError):
                m.run_operation('verify', self.path, 'backups/key')
        oss.assert_not_called()

    def test_put_streams_and_checks_head_without_reopening_local_path(self):
        put = Connection(Response(headers={'etag': '"fake-etag"'}))
        head = Connection(Response(headers=self.remote))
        with patch.object(m, 'fetch_credentials', return_value=self.creds), patch.object(m.http.client, 'HTTPSConnection', side_effect=[put, head]) as factory, patch.object(m.os, 'open', wraps=os.open) as opened:
            result = m.run_operation('put', self.path, 'backups/private-object-key')
        self.assertEqual(result, {'status': 'put_verified_head', 'count': 1, 'bytes': len(self.payload), 'sha256': self.sha})
        self.assertEqual(bytes(put.sent), self.payload)
        self.assertEqual(put.headers['content-md5'], self.md5)
        self.assertEqual(put.headers['x-oss-meta-sha256'], self.sha)
        self.assertEqual(int(put.headers['content-length']), len(self.payload))
        self.assertEqual([call.args[0] for call in factory.call_args_list], [m.HOST, m.HOST])
        self.assertEqual(opened.call_count, 1)
        self.assertTrue(put.closed and head.closed)

    def test_empty_file_uploads_zero_bytes_and_verifies(self):
        self.path.write_bytes(b'')
        empty_sha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        put = Connection(Response(headers={'etag': '"empty"'}))
        head = Connection(Response(headers={'content-length': '0', 'x-oss-meta-sha256': empty_sha, 'etag': '"empty"'}))
        with patch.object(m, 'fetch_credentials', return_value=self.creds), patch.object(m.http.client, 'HTTPSConnection', side_effect=[put, head]):
            result = m.run_operation('put', self.path, 'backups/empty')
        self.assertEqual(result['bytes'], 0)
        self.assertEqual(result['sha256'], empty_sha)
        self.assertEqual(put.headers['content-md5'], '1B2M2Y8AsgTpgAmY7PhCfg==')
        self.assertEqual(put.sent, b'')

    def test_invalid_object_key_cannot_inject_headers_or_escape_signing_path(self):
        for key in ['', '/absolute', 'backups/../outside', 'backups/key\r\nx-header: secret']:
            with patch.object(m, 'fetch_credentials') as credentials:
                with self.assertRaises(m.StoreError):
                    m.run_operation('verify', self.path, key)
            credentials.assert_not_called()

    def test_only_assigned_nonempty_prefixes_are_accepted(self):
        for key in ['other/file', 'system-files/', 'backups/', 'manifests/', 'backups//', 'backups/nested/']:
            with patch.object(m, 'fetch_credentials') as credentials:
                with self.assertRaises(m.StoreError):
                    m.run_operation('verify', self.path, key)
            credentials.assert_not_called()
        for key in ['system-files/current.tar.gz', 'backups/daily/file', 'manifests/daily.json']:
            signed = m.sign_headers('HEAD', key, {'host': m.HOST, 'content-length': '0'}, self.creds)
            self.assertIn('authorization', signed)

    def test_changed_file_fails_even_when_original_mtime_restored(self):
        original = self.path.stat()
        fired = []
        def mutate():
            if fired:
                return
            fired.append(True)
            with self.path.open('r+b') as other:
                other.seek(len(self.payload) - 1)
                other.write(b'X')
            os.utime(self.path, ns=(original.st_atime_ns, original.st_mtime_ns))
        put = Connection(Response(), on_send=mutate)
        with patch.object(m, 'fetch_credentials', return_value=self.creds), patch.object(m.http.client, 'HTTPSConnection', return_value=put):
            with self.assertRaises(m.StoreError):
                m.run_operation('put', self.path, 'backups/changed')
        self.assertTrue(put.closed)

    def test_verify_rejects_wrong_head_length_and_hash(self):
        for headers in [dict(self.remote, **{'content-length': '1'}), dict(self.remote, **{'x-oss-meta-sha256': '0' * 64})]:
            with patch.object(m, 'fetch_credentials', return_value=self.creds), patch.object(m.http.client, 'HTTPSConnection', return_value=Connection(Response(headers=headers))):
                with self.assertRaises(m.StoreError):
                    m.run_operation('verify', self.path, 'backups/key')

    def test_readback_compares_actual_download_hash(self):
        for content, succeeds in [(self.payload, True), (b'X' + self.payload[1:], False)]:
            head = Connection(Response(headers=self.remote))
            get = Connection(Response(headers=self.remote, body=content))
            with patch.object(m, 'fetch_credentials', return_value=self.creds), patch.object(m.http.client, 'HTTPSConnection', side_effect=[head, get]):
                if succeeds:
                    result = m.run_operation('verify', self.path, 'backups/key', readback=True)
                    self.assertEqual(result['status'], 'verified_readback')
                else:
                    with self.assertRaises(m.StoreError):
                        m.run_operation('verify', self.path, 'backups/key', readback=True)
            self.assertEqual(get.headers['if-match'], '"fake-etag"')
            self.assertTrue(head.closed and get.closed)

    def test_cli_errors_are_safe_and_do_not_echo_arguments_or_server_body(self):
        for argv in [['put', '--file', '/PRIVATE_PATH', '--key', 'backups/PRIVATE_KEY', '--unexpected'], ['put', '--file', '/PRIVATE_PATH', '--key', 'backups/PRIVATE_KEY']]:
            output = io.StringIO()
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                status = m.main(argv)
            self.assertNotEqual(status, 0)
            data = json.loads(output.getvalue())
            self.assertEqual(set(data), {'status', 'count', 'bytes', 'sha256'})
            self.assertNotIn('PRIVATE', output.getvalue())
        denied = Connection(Response(status=403, body=b'PRIVATE_OBJECT SECRET_TOKEN'))
        output = io.StringIO()
        with patch.object(m, 'fetch_credentials', return_value=self.creds), patch.object(m.http.client, 'HTTPSConnection', return_value=denied), contextlib.redirect_stdout(output):
            status = m.main(['verify', '--file', str(self.path), '--key', 'backups/PRIVATE_KEY'])
        self.assertNotEqual(status, 0)
        self.assertEqual(json.loads(output.getvalue())['status'], 'error_oss_http_403')
        self.assertNotIn('PRIVATE', output.getvalue())
        self.assertNotIn('SECRET', output.getvalue())

    def test_oversize_file_rejected_before_credentials_or_network(self):
        with patch.object(m, 'MAX_BYTES', len(self.payload) - 1), patch.object(m, 'fetch_credentials') as credentials:
            with self.assertRaises(m.StoreError):
                m.run_operation('put', self.path, 'backups/key')
        credentials.assert_not_called()

    def test_cli_accepts_positional_or_flags_but_rejects_mixing(self):
        expected = {'status': 'put_verified_head', 'count': 1, 'bytes': 1, 'sha256': 'a' * 64}
        for operation in ('put', 'verify'):
            for tail in [[str(self.path), 'backups/private'], ['--file', str(self.path), '--key', 'backups/private']]:
                output = io.StringIO()
                with patch.object(m, 'run_operation', return_value=expected) as run, contextlib.redirect_stdout(output):
                    result = m.main([operation] + tail)
                self.assertEqual(result, 0)
                run.assert_called_once_with(operation, str(self.path), 'backups/private', False)
        for tail in [[str(self.path), 'backups/private', '--file', str(self.path), '--key', 'backups/private'],
                     [str(self.path), '--key', 'backups/private'], ['--file', str(self.path)], [str(self.path)]]:
            output = io.StringIO()
            with patch.object(m, 'run_operation') as run, contextlib.redirect_stdout(output):
                result = m.main(['put'] + tail)
            self.assertEqual(result, 1)
            self.assertEqual(json.loads(output.getvalue())['status'], 'error_invalid_arguments')
            run.assert_not_called()

    def test_optional_config_is_fixed_and_rejects_all_overrides(self):
        self.assertTrue(hasattr(m, 'validate_config'), 'strict optional config validation is absent')
        config = Path(self.temp.name) / 'oss-backup.json'
        fixed = {'bucket': m.BUCKET, 'region': m.REGION, 'role': m.ROLE}
        with patch.object(m, 'CONFIG_PATH', config):
            m.validate_config()
            config.write_text(json.dumps(fixed), encoding='utf8')
            m.validate_config()
            invalid = [dict(fixed, bucket='another-bucket'), dict(fixed, region='cn-hangzhou'),
                       dict(fixed, role='AnotherRole'), dict(fixed, endpoint='https://example.invalid'),
                       dict(fixed, AccessKeySecret='PRIVATE_SECRET'), {'bucket': m.BUCKET}, [], None]
            for document in invalid:
                config.write_text(json.dumps(document), encoding='utf8')
                output = io.StringIO()
                with patch.object(m, 'fetch_credentials') as credentials, contextlib.redirect_stdout(output):
                    result = m.main(['verify', '--file', str(self.path), '--key', 'backups/private'])
                self.assertEqual(result, 1)
                self.assertEqual(json.loads(output.getvalue())['status'], 'error_invalid_config')
                self.assertNotIn('PRIVATE', output.getvalue())
                credentials.assert_not_called()
            for text in ['{invalid JSON', '{"bucket":"x","bucket":"y"}', ' ' * 8192]:
                config.write_text(text, encoding='utf8')
                with self.assertRaises(m.StoreError):
                    m.validate_config()


if __name__ == '__main__':
    unittest.main()
