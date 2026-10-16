"""Advance the independent platform build without changing approved provider settings."""
import json
import os
import re
import sys
from pathlib import Path


def prepare(source, release):
    if not re.fullmatch(r'20261016-vehicle-change-v[1-9][0-9]*', release):
        raise ValueError('Unexpected release identifier')
    expected = {
        'BUILD_VERSION': '20261016-native-signing-v1',
        'API_IMAGE': 'chundian-api:20261016-native-signing-v1',
        'MINIAPP_SIGNING_ENABLED': 'true',
        'H5_SIGNING_ENABLED': 'false',
        'FADADA_ENABLED': 'true',
        'FADADA_ACCOUNT_REGISTER_ENABLED': 'true',
        'FADADA_REALNAME_VERIFY_ENABLED': 'true',
        'FADADA_SIGNING_ENABLED': 'false',
        'FADADA_BASE_URL': 'https://textapi17.fadada.com/api2/',
    }
    updates = {'BUILD_VERSION': release, 'API_IMAGE': 'chundian-api:' + release}
    seen, result = set(), []
    for line in source.splitlines(keepends=True):
        assignment = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(=|:\s+)', line)
        key = assignment.group(1) if assignment else None
        if key in expected:
            value = line[assignment.end():]
            if assignment.group(2) != '=' or key in seen or value.strip().strip('"\'') != expected[key]:
                raise ValueError('Deployment baseline or channel configuration changed')
            seen.add(key)
        result.append(key + '=' + json.dumps(updates[key]) + ('\r\n' if line.endswith('\r\n') else '\n' if line.endswith('\n') else '') if key in updates else line)
    if seen != set(expected):
        raise ValueError('Required deployment baseline key missing')
    return ''.join(result)


if __name__ == '__main__':
    path = Path('/opt/wechat-miniapp-sub/.env.production')
    content = prepare(path.read_text(), sys.argv[1])
    temporary = path.with_name('.env.production.business-next')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        handle.write(content)
    os.replace(temporary, path)
    print(json.dumps({'buildUpdated': True, 'providerSettingsPreserved': True, 'secretsPrinted': False}))
