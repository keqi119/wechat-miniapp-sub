#!/usr/bin/env bash
set -euo pipefail
root=/opt/wechat-miniapp-sub
vhost=/www/server/panel/vhost/nginx/chundian-mini.conf
test "$(id -u)" -eq 0
test "$root" = /opt/wechat-miniapp-sub
install -d -m 755 "$root" "$root/deploy" "$root/acme/.well-known/acme-challenge" "$root/logs" "$root/releases"
install -d -m 750 -o root -g 1000 "$root/secrets"
install -d -m 750 -o 1000 -g 1000 "$root/uploads"
install -d -m 700 "$root/tls" "$root/tls-work" "$root/tls-logs" "$root/backups"
if [ -f "$vhost" ]; then
    cmp "$root/deploy/nginx-http.conf" "$vhost" || { echo 'Existing new-service vhost differs; inspect before replacing.' >&2; exit 1; }
else
    install -m 644 "$root/deploy/nginx-http.conf" "$vhost"
fi
nginx -t
nginx -s reload
printf '%s\n' 'Dedicated HTTP challenge vhost ready.'
