#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/opt/wechat-miniapp-sub
release=${1:?Release ID required}
image_sha=${2:?Image archive SHA required}
static_sha=${3:?Static archive SHA required}
deploy_sha=${4:?Deploy archive SHA required}
revision=${5:?Source commit required}
[[ "$release" =~ ^20261016-technical-signing-v[1-9][0-9]*$ ]]
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
for digest in "$image_sha" "$static_sha" "$deploy_sha"; do [[ "$digest" =~ ^[a-f0-9]{64}$ ]]; done
previous="$root/releases/20261016-vehicle-change-v1-admin1"
target="$root/releases/$release"
backup="$root/backups/before-$release"
cd "$root"
test "$(readlink "$root/current")" = "$previous"
test ! -e "$target"
test ! -e "$backup"
test "$(docker inspect chundian-prod-api-1 --format '{{.Config.Image}}')" = chundian-api:20261016-vehicle-change-v1
test "$(df -Pk "$root" | awk 'NR==2 {print $4}')" -gt 1048576
printf '%s  %s\n' "$image_sha" "chundian-api-$release.tar.gz" "$static_sha" "static-$release.tar.gz" "$deploy_sha" "deploy-$release.tar.gz" | sha256sum --check
old_app_vhost_sha=$(sha256sum /www/server/panel/vhost/nginx/app.subauto.keybox.cloud.conf | cut -d' ' -f1)
docker load -i "chundian-api-$release.tar.gz"
test "$(docker inspect "chundian-api:$release" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$revision"
mkdir -p "$target" "$backup"
tar -xzf "static-$release.tar.gz" -C "$target"
test -f "$target/admin/index.html"
test -f "$target/miniprogram/project.config.json"
cp "$root/.env.production" "$backup/.env.production"
tar -czf "$backup/deploy.tar.gz" -C "$root" deploy
cp /www/server/panel/vhost/nginx/chundian-mini.conf "$backup/chundian-mini.conf"
rollback() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    install -m 600 "$backup/.env.production" "$root/.env.production"
    tar -xzf "$backup/deploy.tar.gz" -C "$root"
    cp "$backup/chundian-mini.conf" /www/server/panel/vhost/nginx/chundian-mini.conf
    ln -sfn "$previous" "$root/current.technical-rollback"
    mv -Tf "$root/current.technical-rollback" "$root/current"
    docker compose --env-file "$root/.env.production" -f "$root/deploy/compose.production.yml" up -d --no-deps api
    nginx -t && nginx -s reload
    printf '%s\n' 'Technical activation failed; previous deployment restored. Additive migrations are not automatically reversed.' >&2
  fi
  exit "$status"
}
trap rollback EXIT
tar -xzf "deploy-$release.tar.gz" -C "$root"
python3 "$root/deploy/prepare-technical-config.py" "$release" prepare
bash "$root/deploy/activate-release.sh" "$release"
test "$(sha256sum /www/server/panel/vhost/nginx/app.subauto.keybox.cloud.conf | cut -d' ' -f1)" = "$old_app_vhost_sha"
python3 - "$release" <<'PY'
import json, sys, urllib.request
base = 'https://mini-api.subauto.keybox.cloud/api'
def get(path):
    with urllib.request.urlopen(base + path, timeout=20) as response:
        return json.load(response)
health, config = get('/health'), get('/public/signing-config')
assert health['version'] == sys.argv[1] and health['database'] == 'connected'
assert config['mode'] == 'MINIAPP_WEBVIEW' and config['enabled'] is True
assert config['signProviderConfigured'] is True and config['fallback']['enabled'] is False
assert set(config['providerHosts']) == {'textapi17.fadada.com', 'realnameverify16.fadada.com'}
assert config['returnUrl'] == base + '/public/esign-return'
print(json.dumps({'release': sys.argv[1], 'healthy': True, 'nativeEntryPreserved': True, 'technicalAcceptanceEnabled': False}))
PY
