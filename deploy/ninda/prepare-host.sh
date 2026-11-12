#!/usr/bin/env bash
set -euo pipefail
root=/opt/ninda-platform
vhost=/etc/nginx/conf.d/ninda-platform.conf
test "$(id -u)" -eq 0
command -v docker >/dev/null
docker compose version >/dev/null
command -v nginx >/dev/null
install -d -m 755 "$root" "$root/deploy" "$root/acme/.well-known/acme-challenge" "$root/logs" "$root/releases" "$root/wechat-domain-verification"
install -d -m 750 -o root -g 1000 "$root/secrets"
install -d -m 750 -o 1000 -g 1000 "$root/uploads"
install -d -m 700 "$root/backups"
if [ -f "$vhost" ]; then
  cmp "$root/deploy/nginx-http.conf" "$vhost" || { echo 'Existing Ninda vhost differs; inspect it before replacing.' >&2; exit 1; }
else
  install -m 644 "$root/deploy/nginx-http.conf" "$vhost"
fi
nginx -t
systemctl reload nginx
printf '%s\n' 'Ninda HTTP challenge vhost ready.'
