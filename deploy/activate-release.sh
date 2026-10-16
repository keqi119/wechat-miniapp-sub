#!/usr/bin/env bash
set -euo pipefail
root=/opt/wechat-miniapp-sub
release=${1:?Release ID required}
[[ "$release" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$ ]] || exit 1
target="$root/releases/$release"
test -f "$target/admin/index.html"
# Static artifacts are public files. Packaging on Windows or a private umask
# must not leave their release directory unreadable by the Nginx worker.
chmod 755 "$target"
for site in admin signing-h5; do
  if [ -d "$target/$site" ]; then
    find "$target/$site" -type d -exec chmod 755 {} +
    find "$target/$site" -type f -exec chmod 644 {} +
  fi
done
test -f "$root/.env.production"
test -f "$root/tls/live/chundian-mini/fullchain.pem"
compose=(docker compose --env-file "$root/.env.production" -f "$root/deploy/compose.production.yml")
vhost=/www/server/panel/vhost/nginx/chundian-mini.conf
previous=$(readlink "$root/current" || true)
old_image=$(docker inspect chundian-prod-api-1 --format '{{.Image}}' 2>/dev/null || true)
vhost_backup=$(mktemp "$root/deploy/.vhost.XXXXXX")
cp "$vhost" "$vhost_backup"
rollback() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    cp "$vhost_backup" "$vhost"
    if [ -n "$previous" ]; then ln -sfn "$previous" "$root/current.rollback"; mv -Tf "$root/current.rollback" "$root/current"; fi
    if [ -n "$old_image" ]; then API_IMAGE="$old_image" "${compose[@]}" up -d --no-deps api; else "${compose[@]}" stop api || true; fi
    nginx -t && nginx -s reload
    printf '%s\n' 'Activation failed; previous web routing and API image restored. Database migrations are not automatically reversed.' >&2
  fi
  rm -f "$vhost_backup"
  exit "$status"
}
trap rollback EXIT
"${compose[@]}" up -d db
for attempt in $(seq 1 30); do
  if "${compose[@]}" exec -T db pg_isready -U chundian_prod -d chundian_prod >/dev/null; then break; fi
  sleep 2
done
bash "$root/deploy/backup.sh" --wait
"${compose[@]}" run --rm --no-deps api node dist/common/migrate.js
"${compose[@]}" up -d --no-deps api
healthy=false
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:13101/api/health >/dev/null; then healthy=true; break; fi
  sleep 2
done
test "$healthy" = true
ln -sfn "$target" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
install -m 644 "$root/deploy/nginx-production.conf" "$vhost"
nginx -t
nginx -s reload
for endpoint in mini-api.subauto.keybox.cloud/api/health mini-admin.subauto.keybox.cloud/; do
  ready=false
  for attempt in $(seq 1 6); do
    if curl --fail --silent --show-error --max-time 10 --resolve "${endpoint%%/*}:443:127.0.0.1" "https://$endpoint" >/dev/null; then ready=true; break; fi
    sleep 1
  done
  test "$ready" = true
done
printf 'Activated release: %s\n' "$release"
