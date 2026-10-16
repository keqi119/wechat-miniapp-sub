"""Apply a scoped technical-signing deployment transition."""
import json
import os
import re
import sys
from pathlib import Path

FLAG = 'TECHNICAL_ACCEPTANCE_SIGNING_ENABLED'


def transition(source, release, phase):
    if not re.fullmatch(r'20261016-technical-signing-v[1-9][0-9]*', release) or phase not in ('prepare', 'enable', 'disable'):
        raise ValueError('Unexpected deployment transition')
    baseline = '20261016-vehicle-change-v1' if phase == 'prepare' else release
    expected = {
        'BUILD_VERSION': baseline, 'API_IMAGE': 'chundian-api:' + baseline,
        'MINIAPP_SIGNING_ENABLED': 'true', 'H5_SIGNING_ENABLED': 'false',
        'FADADA_ENABLED': 'true', 'FADADA_ACCOUNT_REGISTER_ENABLED': 'true',
        'FADADA_REALNAME_VERIFY_ENABLED': 'true', 'FADADA_SIGNING_ENABLED': 'false',
        'WECHAT_PAY_ENABLED': 'false', 'FADADA_BASE_URL': 'https://textapi17.fadada.com/api2/',
    }
    controlled = set(expected) | {FLAG, 'SWAP_CREDIT_PURCHASE_ENABLED'}
    rows, values = [], {}
    for line in source.splitlines(keepends=True):
        match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(=|:\s+)', line)
        key = match.group(1) if match else None
        if key in controlled:
            if key in values or match.group(2) != '=':
                raise ValueError('Ambiguous deployment configuration')
            values[key] = line[match.end():].strip().strip('"\'')
        rows.append((key, line))
    if any(values.get(key) != value for key, value in expected.items()):
        raise ValueError('Deployment baseline or channel configuration changed')
    if values.get('SWAP_CREDIT_PURCHASE_ENABLED', 'false') != 'false':
        raise ValueError('Commercial channel configuration changed')
    if phase == 'prepare' and values.get(FLAG, 'false') != 'false':
        raise ValueError('Technical acceptance must be disabled before deployment')
    if phase != 'prepare' and values.get(FLAG) not in ('true', 'false'):
        raise ValueError('Explicit deployed technical acceptance flag required')
    updates = {FLAG: 'true' if phase == 'enable' else 'false'}
    if phase == 'prepare':
        updates.update({'BUILD_VERSION': json.dumps(release), 'API_IMAGE': json.dumps('chundian-api:' + release)})
    result = []
    for key, line in rows:
        ending = '\r\n' if line.endswith('\r\n') else '\n' if line.endswith('\n') else ''
        result.append(key + '=' + updates[key] + ending if key in updates else line)
    if FLAG not in values:
        ending = '\r\n' if '\r\n' in source else '\n'
        if result and not result[-1].endswith('\n'):
            result.append(ending)
        result.append(FLAG + '=' + updates[FLAG] + ending)
    return ''.join(result)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: prepare-technical-config.py RELEASE prepare|enable|disable')
    target = Path('/opt/wechat-miniapp-sub/.env.production')
    with target.open(newline='') as handle:
        result = transition(handle.read(), sys.argv[1], sys.argv[2])
    temporary = target.with_name('.env.production.technical-next')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', newline='') as handle:
        handle.write(result)
    os.replace(temporary, target)
    print(json.dumps({'phase': sys.argv[2], 'technicalAcceptanceEnabled': sys.argv[2] == 'enable', 'commercialSigningPreservedDisabled': True, 'secretsPrinted': False}))
