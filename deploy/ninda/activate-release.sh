#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/opt/ninda-platform
release=${1:?Release ID required}
candidate=${2:-}
expected_env_hash=${3:-}
[[ "$release" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$ ]] || exit 1
if [ -n "$candidate" ]; then
  [[ "$candidate" =~ ^\.env\.candidate-[a-zA-Z0-9._-]{1,80}$ ]] || exit 1
  [[ "$expected_env_hash" =~ ^[a-f0-9]{64}$ ]] || exit 1
  test -f "$root/$candidate"
fi
target="$root/releases/$release"
test "$(id -u)" -eq 0
test -f "$target/admin/index.html"
test -f "$target/signing-h5/index.html"
test -f "$root/.env.production"
test -f /etc/letsencrypt/live/api.evsub.ndacar.com/fullchain.pem
exec 9>"$root/.deploy.lock"
flock -n 9 || { echo 'A Ninda deployment is already running.' >&2; exit 1; }
chmod 600 "$root/.env.production"
chmod 755 "$target"
for site in admin signing-h5; do
  find "$target/$site" -type d -exec chmod 755 {} +
  find "$target/$site" -type f -exec chmod 644 {} +
done
compose=(docker compose --env-file "$root/.env.production" -f "$root/deploy/compose.production.yml")
vhost=/etc/nginx/conf.d/ninda-platform.conf
previous=$(readlink "$root/current" || true)
old_image=$(docker inspect ninda-prod-api-1 --format '{{.Image}}' 2>/dev/null || true)
vhost_backup=$(mktemp "$root/deploy/.vhost.XXXXXX")
cp "$vhost" "$vhost_backup"
activation_started=false
rollback() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$activation_started" = true ]; then
    cp "$vhost_backup" "$vhost"
    if [ -n "$previous" ]; then ln -sfn "$previous" "$root/current.rollback"; mv -Tf "$root/current.rollback" "$root/current"; fi
    if [ -f "$root/.env.active" ]; then cp "$root/.env.active" "$root/.env.production"; fi
    if [ -n "$old_image" ]; then API_IMAGE="$old_image" "${compose[@]}" up -d --no-deps api; else "${compose[@]}" stop api || true; fi
    nginx -t && systemctl reload nginx
    printf '%s\n' 'Activation failed; previous routing and API image restored. Database migrations are not reversed.' >&2
  fi
  rm -f "$vhost_backup"
  exit "$status"
}
trap rollback EXIT
if [ -n "$candidate" ]; then
  # Stage first, then install configuration only while holding the same lock as
  # the release. Concurrent changes fail before replacing the active settings.
  test "$(sha256sum "$root/.env.production" | cut -d' ' -f1)" = "$expected_env_hash"
  cmp "$root/.env.production" "$root/.env.active"
  cp -n "$root/.env.production" "$root/.env.before-$release"
  activation_started=true
  install -m 600 "$root/$candidate" "$root/.env.production"
  "${compose[@]}" config --quiet
fi
activation_started=true
"${compose[@]}" up -d db
ready=false
for attempt in $(seq 1 30); do
  if "${compose[@]}" exec -T db pg_isready -U ninda_prod -d ninda_prod >/dev/null; then ready=true; break; fi
  sleep 2
done
test "$ready" = true
bash "$root/deploy/backup.sh" --wait
"${compose[@]}" run --rm --no-deps api node dist/common/migrate.js
"${compose[@]}" up -d --no-deps api
healthy=false
for attempt in $(seq 1 45); do
  if curl --fail --silent http://127.0.0.1:13101/api/health | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["status"]=="ok" and d["database"]=="connected" and d["version"]==sys.argv[1]' "$release" 2>/dev/null; then healthy=true; break; fi
  sleep 2
done
test "$healthy" = true
ln -sfn "$target" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
install -m 644 "$root/deploy/nginx-production.conf" "$vhost"
nginx -t
systemctl reload nginx
for endpoint in api.evsub.ndacar.com/api/health admin.evsub.ndacar.com/ sign.evsub.ndacar.com/miniapp-sign/; do
  # systemctl reload acknowledges SIGHUP before Nginx has opened new listeners.
  # Keep the rollback gate, but allow the bounded listener-start transition.
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 --retry 8 --retry-connrefused --retry-delay 1 --retry-max-time 30 --resolve "${endpoint%%/*}:443:127.0.0.1" "https://$endpoint" >/dev/null
done
if [ -f "$target/signing-h5/owner.html" ]; then
  for endpoint in /owner/ /owner/return/ /owner/api/config; do
    curl --fail --silent --show-error --connect-timeout 5 --max-time 15 --resolve "sign.evsub.ndacar.com:443:127.0.0.1" "https://sign.evsub.ndacar.com$endpoint" >/dev/null
  done
fi
cp "$root/.env.production" "$root/.env.active"
chmod 600 "$root/.env.active"
printf 'Activated Ninda release: %s\n' "$release"
