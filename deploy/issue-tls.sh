#!/usr/bin/env bash
set -euo pipefail
root=/opt/wechat-miniapp-sub
test -x "$root/bin/lego"
if [ -f "$root/tls/certificates/mini-admin.subauto.keybox.cloud.crt" ]; then
    action=renew
else
    action=run
fi
"$root/bin/lego" --email=keqi119@gmail.com --domains=mini-admin.subauto.keybox.cloud --domains=mini-api.subauto.keybox.cloud --path="$root/tls" --http --http.webroot="$root/acme" --accept-tos "$action"
install -d -m 700 "$root/tls/live/chundian-mini"
install -m 644 "$root/tls/certificates/mini-admin.subauto.keybox.cloud.crt" "$root/tls/live/chundian-mini/fullchain.pem"
install -m 600 "$root/tls/certificates/mini-admin.subauto.keybox.cloud.key" "$root/tls/live/chundian-mini/privkey.pem"
openssl x509 -in "$root/tls/live/chundian-mini/fullchain.pem" -noout -dates -ext subjectAltName
nginx -t
nginx -s reload
