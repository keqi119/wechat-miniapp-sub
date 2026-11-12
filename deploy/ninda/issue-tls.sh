#!/usr/bin/env bash
set -euo pipefail
email=${1:?ACME contact email is required}
certbot certonly --non-interactive --agree-tos --email "$email" --webroot -w /opt/ninda-platform/acme --cert-name api.evsub.ndacar.com -d api.evsub.ndacar.com -d admin.evsub.ndacar.com -d sign.evsub.ndacar.com
openssl x509 -in /etc/letsencrypt/live/api.evsub.ndacar.com/fullchain.pem -noout -dates -ext subjectAltName
nginx -t
systemctl reload nginx
