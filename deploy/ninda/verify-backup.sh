#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/opt/ninda-platform
archive=${1:?Pass an absolute Ninda backup archive path}
case "$archive" in "$root"/backups/*.tar.enc) ;; *) echo 'Backup path outside dedicated directory' >&2; exit 1;; esac
test "$(dirname "$(realpath "$archive")")" = "$root/backups"
test -f "$archive"
compose=(docker compose --env-file "$root/.env.production" -f "$root/deploy/compose.production.yml")
work=$(mktemp -d "$root/backups/.verify.XXXXXX")
database="ninda_restore_check_$(date -u +%Y%m%d%H%M%S)_$$"
created=false
cleanup() {
  if [ "$created" = true ]; then "${compose[@]}" exec -T db dropdb -U ninda_prod --if-exists "$database"; fi
  rm -rf -- "$work"
}
trap cleanup EXIT
(cd "$root/backups" && sha256sum --check "$(basename "${archive%.tar.enc}.sha256")")
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:"$root/secrets/backup.key" -in "$archive" |
  tar -C "$work" -xf - database.dump uploads.tar.gz
tar -tzf "$work/uploads.tar.gz" >/dev/null
"${compose[@]}" exec -T db createdb -U ninda_prod "$database"
created=true
"${compose[@]}" exec -T db pg_restore --exit-on-error --no-owner -U ninda_prod -d "$database" < "$work/database.dump"
"${compose[@]}" exec -T db psql -U ninda_prod -d "$database" -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS restored_tables FROM information_schema.tables WHERE table_schema = '\''public'\'';'
printf '%s\n' 'Ninda backup restored into an isolated verification database.'
