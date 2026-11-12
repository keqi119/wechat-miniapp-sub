#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/opt/ninda-platform
cd "$root"
exec 8>"$root/backups/.lock"
case "${1:-}" in
  --wait) flock -w 600 8 ;;
  '') flock -n 8 || exit 0 ;;
  *) printf 'Usage: backup.sh [--wait]\n' >&2; exit 2 ;;
esac
compose=(docker compose --env-file "$root/.env.production" -f "$root/deploy/compose.production.yml")
stamp=$(date -u +%Y%m%dT%H%M%S%NZ)
work=$(mktemp -d "$root/backups/.work.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
"${compose[@]}" exec -T db pg_dump -U ninda_prod -d ninda_prod -Fc > "$work/database.dump"
"${compose[@]}" exec -T db pg_restore --list < "$work/database.dump" > "$work/database.contents"
tar -C "$root" -czf "$work/uploads.tar.gz" uploads
printf '%s\n' "$stamp" > "$work/created-at.txt"
tar -C "$work" -cf - database.dump database.contents uploads.tar.gz created-at.txt |
  openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -pass file:"$root/secrets/backup.key" -out "$root/backups/$stamp.tar.enc.part"
mv "$root/backups/$stamp.tar.enc.part" "$root/backups/$stamp.tar.enc"
(cd "$root/backups" && sha256sum "$stamp.tar.enc" > "$stamp.sha256" && sha256sum --check "$stamp.sha256" >/dev/null)
find "$root/backups" -maxdepth 1 -type f \( -name '*.tar.enc' -o -name '*.sha256' \) -mtime +30 -delete
printf 'Encrypted Ninda backup created: %s\n' "$stamp"
