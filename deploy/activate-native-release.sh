#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/opt/wechat-miniapp-sub
release=${1:?Release ID required}
image_sha=${2:?Image archive SHA required}
static_sha=${3:?Static archive SHA required}
deploy_sha=${4:?Deploy archive SHA required}
[[ "$release" =~ ^20261016-native-signing-v[1-9][0-9]*$ ]]
for digest in "$image_sha" "$static_sha" "$deploy_sha"; do [[ "$digest" =~ ^[a-f0-9]{64}$ ]]; done
previous="$root/releases/20261016-admin-login-hotfix"
target="$root/releases/$release"
backup="$root/backups/before-$release"
cd "$root"
test "$(readlink "$root/current")" = "$previous"
test ! -e "$target"
test ! -e "$backup"
test "$(docker inspect chundian-prod-api-1 --format '{{.Config.Image}}')" = chundian-api:20261016-usage-v1
test "$(df -Pk "$root" | awk 'NR==2 {print $4}')" -gt 1048576
printf '%s  %s\n' "$image_sha" "chundian-api-$release.tar.gz" "$static_sha" "static-$release.tar.gz" "$deploy_sha" "deploy-$release.tar.gz" | sha256sum --check
old_app_vhost_sha=$(sha256sum /www/server/panel/vhost/nginx/app.subauto.keybox.cloud.conf | cut -d' ' -f1)
docker load -i "chundian-api-$release.tar.gz"
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
    ln -sfn "$previous" "$root/current.native-rollback"
    mv -Tf "$root/current.native-rollback" "$root/current"
    docker compose --env-file "$root/.env.production" -f "$root/deploy/compose.production.yml" up -d --no-deps api
    nginx -t && nginx -s reload
    printf '%s\n' 'Native release failed; prior API configuration, static target and own routing restored. Applied database migrations remain forward-compatible.' >&2
  fi
  exit "$status"
}
trap rollback EXIT
tar -xzf "deploy-$release.tar.gz" -C "$root"
python3 "$root/deploy/prepare-native-config.py" "$release"
bash "$root/deploy/activate-release.sh" "$release"
curl --fail --silent --show-error --max-time 15 https://mini-api.subauto.keybox.cloud/api/health | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["version"]==sys.argv[1]; print(json.dumps(x))' "$release"
curl --fail --silent --show-error --max-time 15 https://mini-api.subauto.keybox.cloud/api/public/signing-config | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["mode"]=="MINIAPP_WEBVIEW" and x["enabled"] is False and x["signProviderConfigured"] is True and x["faceBridgeConfigured"] is False and x["fallback"]["enabled"] is False; assert set(x["providerHosts"])=={"textapi17.fadada.com","realnameverify16.fadada.com"}; print("Native configuration verified; customer entry remains disabled")'
curl --fail --silent --show-error --max-time 15 https://mini-api.subauto.keybox.cloud/api/public/esign-return | python3 -c 'import sys; body=sys.stdin.read(); assert "<!doctype html>" in body and "<script" not in body.lower(); print("Native return page reachable")'
test "$(curl --fail --silent --show-error --max-time 15 https://mini-api.subauto.keybox.cloud/G1wS8MuuaR.txt | sha256sum | cut -d' ' -f1)" = acfbe275a2e863d5aa45255aec3fa3a5be1c4d91ef8ebd8858fa23f8271d3983
test "$(sha256sum /www/server/panel/vhost/nginx/app.subauto.keybox.cloud.conf | cut -d' ' -f1)" = "$old_app_vhost_sha"
printf 'Activated %s with real-name and signing channels disabled; existing service-account routes unchanged.\n' "$release"
