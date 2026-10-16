"""Patch only this platform's deployment settings; no provider calls or secrets output."""
import json
import os
import re
import sys
from pathlib import Path


def prepare(source, release):
    if not re.fullmatch(r'20261016-native-signing-v[1-9][0-9]*', release):
        raise ValueError('Unexpected release identifier')
    values = {
        'BUILD_VERSION': release,
        'API_IMAGE': 'chundian-api:' + release,
        'FADADA_BASE_URL': 'https://textapi17.fadada.com/api2/',
        'MINIAPP_SIGNING_PROVIDER_HOSTS': 'textapi17.fadada.com,realnameverify16.fadada.com',
        'FADADA_SIGN_RETURN_URL': 'https://mini-api.subauto.keybox.cloud/api/public/esign-return',
        'FADADA_VERIFY_RETURN_URL': 'https://mini-api.subauto.keybox.cloud/api/public/esign-return',
        'MINIAPP_SIGNING_ENABLED': 'false',
        'H5_SIGNING_ENABLED': 'false',
        'FADADA_ENABLED': 'false',
        'FADADA_ACCOUNT_REGISTER_ENABLED': 'false',
        'FADADA_REALNAME_VERIFY_ENABLED': 'false',
        'FADADA_SIGNING_ENABLED': 'false',
    }
    lines, seen, previous = source.splitlines(), set(), {}
    for index, line in enumerate(lines):
        key, sep, value = line.partition('=')
        if key in values:
            if key in seen:
                raise ValueError('Duplicate deployment key')
            seen.add(key)
            previous[key] = value.strip().strip('"\'')
            lines[index] = key + '=' + json.dumps(values[key])
    if previous.get('BUILD_VERSION') != '20261016-usage-v1' or previous.get('API_IMAGE') != 'chundian-api:20261016-usage-v1':
        raise ValueError('Unexpected deployed API baseline')
    for key in ('FADADA_ENABLED', 'FADADA_ACCOUNT_REGISTER_ENABLED', 'FADADA_REALNAME_VERIFY_ENABLED', 'FADADA_SIGNING_ENABLED', 'H5_SIGNING_ENABLED', 'MINIAPP_SIGNING_ENABLED'):
        if previous.get(key, 'false') != 'false':
            raise ValueError('Review active signing settings before replacement')
    lines.extend(key + '=' + json.dumps(value) for key, value in values.items() if key not in seen)
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    path = Path('/opt/wechat-miniapp-sub/.env.production')
    content = prepare(path.read_text(), sys.argv[1])
    temporary = path.with_name('.env.production.native-next')
    temporary.write_text(content)
    temporary.chmod(0o600)
    os.replace(str(temporary), str(path))
    print(json.dumps({'nativeProviderConfigured': True, 'signingEnabled': False, 'realnameEnabled': False, 'secretsPrinted': False}))
