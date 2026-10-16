#!/usr/bin/env bash
set -euo pipefail
root=/opt/wechat-miniapp-sub
compose=(docker compose --env-file "$root/.env.production" -f "$root/deploy/compose.production.yml")
"${compose[@]}" exec -T db psql -U chundian_prod -d chundian_prod -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM "SmsChallenge" WHERE "expiresAt" < now() - interval '30 days';
DELETE FROM "CustomerSession" WHERE "expiresAt" < now() - interval '30 days';
DELETE FROM "AdminSession" WHERE "expiresAt" < now() - interval '30 days';
DO $$ BEGIN
  IF to_regclass('"H5SigningSession"') IS NOT NULL THEN
    DELETE FROM "H5SigningSession" WHERE "expiresAt" < now() - interval '30 days';
  END IF;
END $$;
COMMIT;
SQL
