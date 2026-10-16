#!/usr/bin/env python3
"""Add the independent H5 prefix to the existing service-account host."""
import argparse
import hashlib
import json
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/opt/wechat-miniapp-sub')
VHOST = Path('/www/server/panel/vhost/nginx/app.subauto.keybox.cloud.conf')
HTTP_CONFIG = VHOST.parent / '00-chundian-signing-http.conf'
INCLUDE = '    include /opt/wechat-miniapp-sub/deploy/nginx-signing-h5.conf;'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def get(path):
    request = urllib.request.Request('https://app.subauto.keybox.cloud' + path)
    try:
        response = urllib.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.read(1024 * 1024), {key.lower(): value for key, value in response.headers.items()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-vhost-sha256', required=True)
    parser.add_argument('--release', required=True)
    args = parser.parse_args()
    target = (ROOT / 'current').resolve()
    if target != ROOT / 'releases' / args.release or not (target / 'signing-h5/index.html').is_file():
        raise RuntimeError('Expected release is not active or H5 artifact is absent')
    before = VHOST.read_bytes()
    if digest(before) != args.expected_vhost_sha256:
        raise RuntimeError('Existing service-account vhost changed; review before applying')
    text = before.decode('utf-8')
    if INCLUDE in text:
        raise RuntimeError('Signing prefix is already present; verify it rather than reinserting')
    if 'server_name app.subauto.keybox.cloud;' not in text or not text.rstrip().endswith('}'):
        raise RuntimeError('Unexpected service-account server layout')
    source_http = (ROOT / 'deploy/nginx-signing-h5-http.conf').read_bytes()
    prior_http = HTTP_CONFIG.read_bytes() if HTTP_CONFIG.exists() else None
    if prior_http is not None and prior_http != source_http:
        raise RuntimeError('Global signing config is owned by an unexpected version')
    old_status, old_body, _ = get('/portal/login')
    if old_status != 200:
        raise RuntimeError('Existing portal baseline is not healthy')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = ROOT / 'backups' / ('app-vhost-before-signing-' + stamp + '.conf')
    shutil.copy2(VHOST, backup)
    changed = text.rstrip()[:-1] + '\n' + INCLUDE + '\n}\n'
    try:
        HTTP_CONFIG.write_bytes(source_http)
        VHOST.write_text(changed, encoding='utf-8')
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['nginx', '-s', 'reload'], check=True)
        time.sleep(1)
        results = {}
        for path in ['/miniapp-sign/', '/miniapp-sign/return/', '/miniapp-sign/api/config', '/miniapp-sign/api/records', '/miniapp-sign/not-a-route', '/portal/login']:
            status, body, headers = get(path)
            expected = 401 if path.endswith('/records') else 404 if path.endswith('not-a-route') else 200
            if status != expected:
                raise RuntimeError('Unexpected route status for ' + path)
            if path in ['/miniapp-sign/', '/miniapp-sign/return/'] and b'/miniapp-sign/assets/' not in body:
                raise RuntimeError('New path did not serve the H5 artifact')
            if path in ['/miniapp-sign/', '/miniapp-sign/return/'] and not headers.get('content-type', '').startswith('text/html'):
                raise RuntimeError('H5 entry must be served as HTML')
            if path.endswith('/config') and json.loads(body).get('mode') != 'SERVICE_ACCOUNT_H5':
                raise RuntimeError('New API prefix is not the independent signing service')
            results[path] = {'status': status, 'bodySha256': digest(body)}
        evidence = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'release': args.release, 'previousVhostSha256': digest(before), 'activeVhostSha256': digest(VHOST.read_bytes()), 'backup': str(backup), 'oldPortalBaselineSha256': digest(old_body), 'routes': results, 'oldDatabaseModified': False, 'realSigningPerformed': False}
        (ROOT / 'releases' / args.release / 'signing-route-evidence.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(evidence))
    except BaseException:
        VHOST.write_bytes(before)
        if prior_http is None:
            HTTP_CONFIG.unlink(missing_ok=True)
        else:
            HTTP_CONFIG.write_bytes(prior_http)
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['nginx', '-s', 'reload'], check=True)
        raise


if __name__ == '__main__':
    main()
