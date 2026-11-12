#!/usr/bin/env bash
# Dedicated cutover for 8.133.232.213 only. Invoke the uploaded file, not bash -s.
# RELEASE CANDIDATE ENV_SHA OLD_IMAGE_ID MANIFEST_SHA NEW_IMAGE_ID MACHINE_ID [preserve|fresh] [standard|scoped-virtual]
# Both image arguments are immutable sha256 IDs. Obtain MACHINE_ID on the pinned SSH host.
set -Eeuo pipefail
umask 077
root=/opt/ninda-platform
vhost=/etc/nginx/conf.d/ninda-platform.conf
release=${1:?Release required}
candidate=${2:?Candidate basename required}
env_hash=${3:?Active environment SHA256 required}
old_image=${4:?Current image ID required}
manifest_hash=${5:?Release SHA256SUMS hash required}
new_image=${6:?Candidate image ID required}
machine_id=${7:?Pinned host machine ID required}
mode=${8:-preserve}
profile=${9:-standard}
[[ "$profile" =~ ^(standard|scoped-virtual)$ ]]
[[ "$profile" != scoped-virtual || "$mode" = preserve ]]
[[ "$release" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$ ]]
[[ "$candidate" =~ ^\.env\.candidate-[a-zA-Z0-9._-]{1,80}$ ]]
[[ "$env_hash" =~ ^[a-f0-9]{64}$ && "$manifest_hash" =~ ^[a-f0-9]{64}$ ]]
[[ "$old_image" =~ ^sha256:[a-f0-9]{64}$ && "$new_image" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ "$machine_id" =~ ^[a-f0-9]{32}$ && "$mode" =~ ^(preserve|fresh)$ ]]
test "$(id -u)" -eq 0
test "$(cat /etc/machine-id)" = "$machine_id"
target="$root/releases/$release"
test -d "$target" && test ! -L "$target"
test -f "$vhost" && test -f "$root/deploy/nginx-production.conf"
test -f "$root/$candidate" && test ! -L "$root/$candidate"
test ! -e "$root/.mvp-maintenance"
exec 9>"$root/.deploy.lock"
flock -n 9 || { printf '%s\n' 'A Ninda deployment is already running.' >&2; exit 1; }
test "$(sha256sum "$root/.env.production" | cut -d' ' -f1)" = "$env_hash"
cmp -s "$root/.env.production" "$root/.env.active"
test "$(docker inspect ninda-prod-api-1 --format '{{.Image}}' </dev/null)" = "$old_image"
test "$(docker image inspect "ninda-api:$release" --format '{{.Id}}' </dev/null)" = "$new_image"

# Parse without sourcing executable shell content; provider and persistence
# settings must survive the upgrade byte-for-byte as decoded values.
python3 - "$root/.env.production" "$root/$candidate" "$release" "$target" "$manifest_hash" "$profile" <<'PY'
import base64,hashlib,json,os,pathlib,re,subprocess,sys
def env(path):
    values={}
    for raw in pathlib.Path(path).read_text(encoding='utf-8-sig').splitlines():
        line=raw.strip()
        if not line or line.startswith('#'): continue
        match=re.fullmatch(r'([A-Z][A-Z0-9_]*)=(.*)',line)
        if not match or match[1] in values: raise ValueError()
        key,value=match.groups()
        if value.startswith('"'): value=json.loads(value)
        elif value.startswith("'") and value.endswith("'"): value=value[1:-1]
        if not isinstance(value,str): raise ValueError()
        values[key]=value
    return values
try:
    old,new=env(sys.argv[1]),env(sys.argv[2]); release=sys.argv[3]
    fixed={'NODE_ENV':'production','APP_ENV':'production','MVP_V2_ENABLED':'true','NEW_ORDER_CONTRACT_MODE':'OFFLINE','ESIGN_NEW_REQUESTS_ENABLED':'false','PLATFORM_LEGAL_ENTITY_NAME':'上海宁达信息科技有限公司','BUILD_VERSION':release,'API_IMAGE':'ninda-api:'+release,'POSTGRES_USER':'ninda_prod','POSTGRES_DB':'ninda_prod','PLATFORM_API_ORIGIN':'https://api.evsub.ndacar.com','ADMIN_ORIGIN':'https://admin.evsub.ndacar.com','H5_SIGNING_ORIGIN':'https://sign.evsub.ndacar.com','WECHAT_MINIPROGRAM_APP_ID':'wxb5115e5a5f70f1b1','WECHAT_OFFICIAL_ACCOUNT_APP_ID':'wx556ac6833f4c4d30','WECHAT_PAY_MCH_ID':'1749304222','CONTRACT_CJK_FONT_PATH':'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'}
    scoped=sys.argv[6]=='scoped-virtual'
    if scoped: fixed['ESIGN_NEW_REQUESTS_ENABLED']='true'
    assert all(new.get(k)==v for k,v in fixed.items())
    if scoped:
        # Only these five observed gate transitions plus release identity may change.
        prior={'ESIGN_NEW_REQUESTS_ENABLED':'false','FADADA_SIGNING_ENABLED':'false','MINIAPP_SIGNING_ENABLED':'false','MINIAPP_FACE_BRIDGE_ENABLED':'true'}
        assert all(old.get(k)==v for k,v in prior.items())
        assert 'ELECTRONIC_SIGNING_ENABLED' not in old
        gates={'ESIGN_NEW_REQUESTS_ENABLED':'true','ELECTRONIC_SIGNING_ENABLED':'true','FADADA_SIGNING_ENABLED':'true','MINIAPP_SIGNING_ENABLED':'true','MINIAPP_FACE_BRIDGE_ENABLED':'false'}
        required={'NEW_ORDER_CONTRACT_MODE':'OFFLINE','CUSTOMER_IDENTITY_POLICY':'MANUAL_REVIEW','CUSTOMER_IDENTITY_ENABLED':'true','FADADA_ENABLED':'true','FADADA_ACCOUNT_REGISTER_ENABLED':'true','FADADA_REALNAME_VERIFY_ENABLED':'true','OWNER_ONBOARDING_ENABLED':'true','OWNER_LEGAL_H5_ENABLED':'true','PORTAL_SMS_ENABLED':'true','OWNER_AUTO_SIGNING_ENABLED':'false','H5_SIGNING_ENABLED':'false','OWNER_LEGAL_H5_ONLY':'false','SWAP_CREDIT_PURCHASE_ENABLED':'true','FADADA_BASE_URL':'https://textapi17.fadada.com/api2/','MINIAPP_SIGNING_PROVIDER_HOSTS':'textapi17.fadada.com,realnameverify16.fadada.com'}
        assert all(new.get(k)==v for k,v in {**required,**gates}.items())
        assert len(base64.b64decode(new.get('ESIGN_IDENTITY_ENCRYPTION_KEY',''),validate=True))==32
        assert all(new.get(k,'').strip() for k in ['FADADA_APP_ID','FADADA_APP_SECRET','FADADA_PLATFORM_CUSTOMER_ID','FADADA_PLATFORM_SIGNATURE_ID','ALIYUN_SMS_ACCESS_KEY_ID','ALIYUN_SMS_ACCESS_KEY_SECRET','ALIYUN_SMS_SIGN_NAME','ALIYUN_SMS_LOGIN_TEMPLATE_CODE'])
        change={'BUILD_VERSION','API_IMAGE',*gates}
    else:
        change={'BUILD_VERSION','API_IMAGE','MVP_V2_ENABLED','NEW_ORDER_CONTRACT_MODE','ESIGN_NEW_REQUESTS_ENABLED','CONTRACT_CJK_FONT_PATH'}
        # This rebuild explicitly adopts manual document review. Never accept an
        # unknown prior policy or relax the preservation rule for other settings.
        assert old.get('CUSTOMER_IDENTITY_POLICY') in (None,'PROVIDER_REQUIRED','MANUAL_REVIEW')
        assert new.get('CUSTOMER_IDENTITY_POLICY')=='MANUAL_REVIEW'
        change.add('CUSTOMER_IDENTITY_POLICY')
        # Approved launch scope includes product-priced paid swap credits. This is
        # one explicit flag transition, not a relaxation for payment/provider keys.
        assert old.get('SWAP_CREDIT_PURCHASE_ENABLED') in (None,'false','true')
        assert new.get('SWAP_CREDIT_PURCHASE_ENABLED')=='true'
        change.add('SWAP_CREDIT_PURCHASE_ENABLED')
        for key in ['STAFF_COMMAND_DIGEST_KEY','STAFF_COMMAND_DIGEST_KEY_VERSION','STAFF_COMMAND_DIGEST_KEYS_JSON']:
            if not old.get(key): change.add(key)
        for key in ['FADADA_SIGNING_ENABLED','MINIAPP_SIGNING_ENABLED','H5_SIGNING_ENABLED','TECHNICAL_ACCEPTANCE_SIGNING_ENABLED','OWNER_AUTO_SIGNING_ENABLED','OWNER_MANUAL_CONTRACTS_ENABLED','OWNER_AUTHORIZATION_ENABLED','OWNER_CONTRACTS_ENABLED']:
            if new.get(key)=='false': change.add(key)
    assert all(new.get(k)==v for k,v in old.items() if k not in change)
    assert all(k in old or k in change for k in new)
    assert len(new.get('STAFF_COMMAND_DIGEST_KEY','').encode())>=32
    assert re.fullmatch(r'[A-Za-z0-9._-]{1,40}',new.get('STAFF_COMMAND_DIGEST_KEY_VERSION',''))
    if new.get('STAFF_COMMAND_DIGEST_KEYS_JSON'):
        keys=json.loads(new['STAFF_COMMAND_DIGEST_KEYS_JSON'])
        assert isinstance(keys,dict) and all(isinstance(v,str) and len(v.encode())>=32 for v in keys.values())
    assert re.fullmatch(r'postgresql://ninda_prod:[a-f0-9]{64}@db:5432/ninda_prod\?connection_limit=12',new.get('DATABASE_URL',''))
    assert all(len(new.get(k,''))>=32 for k in ['JWT_SECRET','SESSION_SECRET','ESIGN_IDENTITY_ENCRYPTION_KEY','BOOTSTRAP_ADMIN_PASSWORD'])
    assert new.get('BOOTSTRAP_ADMIN_USERNAME')
    if scoped:
        # dotenv decoding equality alone cannot prove Compose interpolation safety.
        # Compare resolved consumer models before touching maintenance or active env.
        compose_file=pathlib.Path(sys.argv[1]).parent/'deploy/compose.production.yml'
        def consumed(path):
            overlay=json.dumps({'services':{'api':{'env_file':[str(pathlib.Path(path).resolve())]}}})
            result=subprocess.run(['docker','compose','--env-file',path,'-f',str(compose_file),'-f','-','config','--format','json'],input=overlay,text=True,capture_output=True,timeout=30,check=True)
            return json.loads(result.stdout)['services']
        old_services,new_services=consumed(sys.argv[1]),consumed(sys.argv[2])
        old_api,new_api=old_services['api']['environment'],new_services['api']['environment']
        assert old_api.keys()==new_api.keys()-{'ELECTRONIC_SIGNING_ENABLED'}
        assert all(new_api[k]==v for k,v in old_api.items() if k not in change)
        assert all(new_api[k]==new[k] for k in change)
        assert old_services['db']['environment']==new_services['db']['environment']
    root=pathlib.Path(sys.argv[4]); manifest=root/'SHA256SUMS'
    assert hashlib.sha256(manifest.read_bytes()).hexdigest()==sys.argv[5]
    expected={}
    for line in manifest.read_text(encoding='utf-8').splitlines():
        match=re.fullmatch(r'([a-f0-9]{64})  ((?:admin|signing-h5)/[A-Za-z0-9_./@+ -]+)',line)
        assert match
        digest,name=match.groups()
        assert '..' not in pathlib.PurePosixPath(name).parts and name not in expected
        expected[name]=digest
    actual={}
    for path in root.rglob('*'):
        assert not path.is_symlink()
        if path.is_file() and path!=manifest: actual[path.relative_to(root).as_posix()]=hashlib.sha256(path.read_bytes()).hexdigest()
    assert expected==actual
    assert all(p in actual for p in ['admin/index.html','admin/field.html','signing-h5/index.html','signing-h5/owner.html'])
except Exception:
    print('NINDA_MVP_PREFLIGHT_REJECTED',file=sys.stderr);sys.exit(1)
PY

run="$root/deploy/mvp-runs/$release-$(date -u +%Y%m%dT%H%M%S)-$$"
mkdir -p "$run"
chmod 700 "$run"
cp "$root/.env.production" "$run/env.before"
cp "$root/$candidate" "$run/env.candidate"
cp "$vhost" "$run/nginx.before"
cp "$root/deploy/nginx-production.conf" "$run/nginx.final-source"
previous=$(readlink "$root/current" || true)
printf '%s\n' "$previous" > "$run/current.before"
compose=(docker compose --env-file "$root/.env.production" -f "$root/deploy/compose.production.yml")
new_compose() { API_IMAGE="$new_image" "${compose[@]}" "$@" </dev/null; }
phase=preflight
migration_started=false
maintenance=false
stopped=false
backup_archive=''
archive_db=''
staff_count=0
legal_count=0
receipt() {
  python3 - "$run/receipt.json" "$1" "$release" "$phase" "$mode" "$backup_archive" "$archive_db" "$new_image" "$profile" <<'PY'
import json,pathlib,sys
data=dict(zip(['status','release','phase','mode','backup','archiveDatabase','image','profile'],sys.argv[2:]))
pathlib.Path(sys.argv[1]).write_text(json.dumps(data,separators=(',',':'))+'\n',encoding='utf-8')
print(json.dumps({'status':data['status'],'release':data['release'],'receipt':sys.argv[1]},separators=(',',':')))
PY
}
finish() {
  status=$?
  trap - EXIT INT TERM
  set +e
  if [ "$status" -ne 0 ]; then
    if [ "$migration_started" = true ]; then
      # No code/config/database downgrade after the first schema/cutover attempt.
      touch "$root/.mvp-maintenance"
      new_compose stop api >> "$run/commands.log" 2>&1
      receipt failed-maintenance
    elif [ "$maintenance" = true ]; then
      cp "$run/env.before" "$root/.env.production"
      if [ "$stopped" = true ]; then API_IMAGE="$old_image" "${compose[@]}" up -d --no-deps api </dev/null >> "$run/commands.log" 2>&1; recovered=$?; else recovered=0; fi
      # Keep 503 if the original runtime could not restart. Do not expose a dead API.
      if [ "$recovered" -eq 0 ]; then
        cp "$run/nginx.before" "$vhost"
        if nginx -t >> "$run/commands.log" 2>&1 && systemctl reload nginx >> "$run/commands.log" 2>&1; then rm -f "$root/.mvp-maintenance"; fi
      fi
      receipt failed-before-migration
    else receipt failed-preflight; fi
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Add the same file gate to every server block, including H5 API aliases. A
# provider callback receives a real 503 and must retry; no fake acknowledgement.
python3 - "$run/nginx.before" "$run/nginx.final-source" "$run" "$root/.mvp-maintenance" <<'PY'
import pathlib,re,sys
try:
    for source,name in [(sys.argv[1],'nginx.frozen-before'),(sys.argv[2],'nginx.frozen-final')]:
        text=pathlib.Path(source).read_text()
        names=set(' '.join(re.findall(r'\bserver_name\s+([^;]+);',text)).split())
        assert names=={'api.evsub.ndacar.com','admin.evsub.ndacar.com','sign.evsub.ndacar.com'}
        # A completed previous MVP release keeps the dormant gate in its vhost.
        # Remove precisely our own generated lines before inserting one copy.
        existing='    if (-f '+sys.argv[4]+') { return 503; }\n    add_header Retry-After 120 always;\n'
        text=text.replace(existing,'')
        assert '.mvp-maintenance' not in text
        gate='server {\n    if (-f '+sys.argv[4]+') { return 503; }\n    add_header Retry-After 120 always;'
        output,count=re.subn(r'\bserver\s*\{',lambda _:gate,text)
        assert count>=3
        pathlib.Path(sys.argv[3],name).write_text(output)
except Exception:
    print('NINDA_MVP_NGINX_REJECTED',file=sys.stderr);sys.exit(1)
PY
phase=freeze
maintenance=true
touch "$root/.mvp-maintenance"
install -m 644 "$run/nginx.frozen-before" "$vhost"
nginx -t >> "$run/commands.log" 2>&1
systemctl reload nginx >> "$run/commands.log" 2>&1
for host in api.evsub.ndacar.com admin.evsub.ndacar.com sign.evsub.ndacar.com; do
  frozen=false
  for attempt in $(seq 1 15); do
    code=$(curl --silent --output /dev/null --write-out '%{http_code}' --connect-timeout 3 --max-time 5 --resolve "$host:443:127.0.0.1" "https://$host/api/callbacks/wechat-pay" || true)
    if [ "$code" = 503 ]; then frozen=true; break; fi
    sleep 1
  done
  test "$frozen" = true
done
phase=stop-old-api
stopped=true
"${compose[@]}" stop api </dev/null >> "$run/commands.log" 2>&1
test "$(docker inspect ninda-prod-api-1 --format '{{.State.Running}}' </dev/null)" = false
install -m 600 "$run/env.candidate" "$root/.env.production"
new_compose config --quiet >> "$run/commands.log" 2>&1
phase=backup
bash "$root/deploy/backup.sh" --wait </dev/null > "$run/backup.log" 2>&1
stamp=$(sed -n 's/^Encrypted Ninda backup created: \([0-9TZ]*\)$/\1/p' "$run/backup.log")
[[ "$stamp" =~ ^[0-9]+T[0-9]+Z$ ]]
backup_archive="$root/backups/$stamp.tar.enc"
test -f "$backup_archive"
bash "$root/deploy/verify-backup.sh" "$backup_archive" </dev/null > "$run/restore-verification.log" 2>&1
# Exclude the daily backup timer during database rename/schema changes.
exec 8>"$root/backups/.lock"
flock -w 600 8
phase=backup-verified
receipt prepared

if [ "$mode" = fresh ]; then
  # Preserve the old database as an archive, never DROP it. The deterministic
  # name is bounded to PostgreSQL's identifier limit and contains no SQL input.
  archive_db="ninda_archive_$(printf '%s' "$release" | tr '[:upper:].-' '[:lower:]__' | cut -c1-36)_${manifest_hash:0:8}"
  [[ "$archive_db" =~ ^ninda_archive_[a-z0-9_]{1,36}_[a-f0-9]{8}$ ]]
  found=$(new_compose exec -T db psql -U ninda_prod -d postgres -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_database WHERE datname='$archive_db'")
  test "$found" = 0
  phase=export-approved-configuration
  # These are configuration, not historical business records. JSON extraction
  # handles the pre-MVP schema without assuming authVersion/revision exist.
  staff_export=$(cat <<'SQL'
COPY (SELECT a."id",a."username",a."passwordHash",a."name",a."role",a."active",a."createdAt",COALESCE((to_jsonb(a)->>'revision')::integer,0),COALESCE((to_jsonb(a)->>'authVersion')::integer,0)+1,COALESCE((to_jsonb(a)->>'updatedAt')::timestamp,a."createdAt") FROM "AdminUser" a ORDER BY a."id") TO STDOUT WITH CSV
SQL
)
  legal_export=$(cat <<'SQL'
COPY (SELECT "id","type","version","title","content","status","confirmedBy","confirmedAt","publishedAt","createdAt" FROM "LegalDocument" WHERE "type" IN ('terms','privacy') AND "status"='PUBLISHED' AND "confirmedBy" IS NOT NULL AND "confirmedBy"<>'' AND "confirmedAt" IS NOT NULL AND "publishedAt" IS NOT NULL ORDER BY "type","version") TO STDOUT WITH CSV
SQL
)
  new_compose exec -T db psql -U ninda_prod -d ninda_prod -q -v ON_ERROR_STOP=1 -c "$staff_export" > "$run/staff-configuration.csv" 2>> "$run/commands.log"
  new_compose exec -T db psql -U ninda_prod -d ninda_prod -q -v ON_ERROR_STOP=1 -c "$legal_export" > "$run/legal-configuration.csv" 2>> "$run/commands.log"
  staff_count=$(python3 - "$run/staff-configuration.csv" "$run/legal-configuration.csv" <<'PY'
import csv,sys
try:
    with open(sys.argv[1],encoding='utf-8',newline='') as source: staff=list(csv.reader(source))
    with open(sys.argv[2],encoding='utf-8',newline='') as source: legal=list(csv.reader(source))
    for row in staff:
        assert len(row)==10 and all(row[n] for n in [0,1,2,4,5,6,9])
        assert row[4] in ['ADMIN','OPERATIONS','FINANCE','SUPPORT','FIELD'] and row[5] in ['t','f']
        assert int(row[7])>=0 and int(row[8])>=1
    assert not staff or any(row[4]=='ADMIN' and row[5]=='t' for row in staff)
    assert len({row[0] for row in staff})==len(staff) and len({row[1] for row in staff})==len(staff)
    for row in legal:
        assert len(row)==10 and all(row) and row[1] in ['terms','privacy'] and row[5]=='PUBLISHED' and int(row[2])>0
    assert len({(row[1],row[2]) for row in legal})==len(legal)
    print(str(len(staff))+' '+str(len(legal)))
except Exception:
    print('NINDA_MVP_CONFIGURATION_EXPORT_REJECTED',file=sys.stderr);sys.exit(1)
PY
)
  legal_count=${staff_count#* }
  staff_count=${staff_count%% *}
  phase=archive-database
  migration_started=true
  receipt cutover-started
  new_compose exec -T db psql -U ninda_prod -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='ninda_prod' AND pid<>pg_backend_pid()" >> "$run/commands.log" 2>&1
  new_compose exec -T db psql -U ninda_prod -d postgres -v ON_ERROR_STOP=1 -c "ALTER DATABASE ninda_prod RENAME TO $archive_db" >> "$run/commands.log" 2>&1
  phase=create-database
  new_compose exec -T db psql -U ninda_prod -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE ninda_prod OWNER ninda_prod' >> "$run/commands.log" 2>&1
fi
phase=migrate
migration_started=true
receipt migration-started
new_compose run --rm --no-deps api node dist/common/migrate.js >> "$run/migration.log" 2>&1
if [ "$mode" = fresh ]; then
  phase=restore-approved-configuration
  # Deliberately bypass new_compose's /dev/null only for COPY's explicit file
  # input. Do not inherit SSH stdin and do not print account hashes or content.
  API_IMAGE="$new_image" "${compose[@]}" exec -T db psql -U ninda_prod -d ninda_prod -q -v ON_ERROR_STOP=1 -c 'COPY "AdminUser" ("id","username","passwordHash","name","role","active","createdAt","revision","authVersion","updatedAt") FROM STDIN WITH CSV' < "$run/staff-configuration.csv" >> "$run/configuration-restore.log" 2>&1
  API_IMAGE="$new_image" "${compose[@]}" exec -T db psql -U ninda_prod -d ninda_prod -q -v ON_ERROR_STOP=1 -c 'COPY "LegalDocument" ("id","type","version","title","content","status","confirmedBy","confirmedAt","publishedAt","createdAt") FROM STDIN WITH CSV' < "$run/legal-configuration.csv" >> "$run/configuration-restore.log" 2>&1
  if [ "$staff_count" -eq 0 ]; then
    phase=bootstrap
    new_compose run --rm --no-deps api node dist/auth/bootstrap.js >> "$run/bootstrap.log" 2>&1
  fi
  phase=verify-empty-business
  fresh_query=$(cat <<'SQL'
SELECT json_build_object('staff',(SELECT count(*) FROM "AdminUser"),'publicLegal',(SELECT count(*) FROM "LegalDocument" WHERE "type" IN ('terms','privacy') AND "status"='PUBLISHED' AND "confirmedBy" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "publishedAt" IS NOT NULL),'unapprovedLegal',(SELECT count(*) FROM "LegalDocument" WHERE "type" NOT IN ('terms','privacy') OR "status"<>'PUBLISHED' OR "confirmedBy" IS NULL OR "confirmedAt" IS NULL OR "publishedAt" IS NULL),'sessions',(SELECT count(*) FROM "AdminSession")+(SELECT count(*) FROM "CustomerSession")+(SELECT count(*) FROM "OwnerH5Session"),'business',(SELECT count(*) FROM "Customer")+(SELECT count(*) FROM "Vehicle")+(SELECT count(*) FROM "VehicleOwner")+(SELECT count(*) FROM "Application")+(SELECT count(*) FROM "Order")+(SELECT count(*) FROM "Contract")+(SELECT count(*) FROM "Payment")+(SELECT count(*) FROM "Refund")+(SELECT count(*) FROM "StoredFile")+(SELECT count(*) FROM "InsurancePolicy")+(SELECT count(*) FROM "PartnerSettlement")+(SELECT count(*) FROM "Product"))
SQL
)
  new_compose exec -T db psql -U ninda_prod -d ninda_prod -At -v ON_ERROR_STOP=1 -c "$fresh_query" > "$run/fresh-counts.json" 2>> "$run/commands.log"
  python3 - "$run/fresh-counts.json" "$staff_count" "$legal_count" <<'PY'
import json,pathlib,sys
try:
    counts=json.loads(pathlib.Path(sys.argv[1]).read_text())
    assert counts==dict(staff=max(1,int(sys.argv[2])),publicLegal=int(sys.argv[3]),business=0,sessions=0,unapprovedLegal=0)
except Exception:
    print('NINDA_MVP_FRESH_DATABASE_CHECK_FAILED',file=sys.stderr);sys.exit(1)
PY
fi
phase=start-compatible-api
new_compose up -d --no-deps api >> "$run/commands.log" 2>&1
healthy=false
for attempt in $(seq 1 45); do
  if curl --fail --silent --connect-timeout 2 --max-time 5 http://127.0.0.1:13101/api/health | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["status"]=="ok" and d["database"]=="connected" and d["version"]==sys.argv[1]' "$release" 2>/dev/null; then healthy=true; break; fi
  sleep 2
done
test "$healthy" = true
phase=runtime-gates
curl --fail --silent --show-error --connect-timeout 2 --max-time 5 http://127.0.0.1:13101/api/public/identity-config | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["identityPolicy"]=="MANUAL_REVIEW"' >> "$run/runtime-check.log" 2>&1
if [ "$profile" = scoped-virtual ]; then
  curl --fail --silent --show-error --connect-timeout 2 --max-time 5 http://127.0.0.1:13101/api/public/identity-config | python3 -c 'import json,sys; d=json.load(sys.stdin); expected=json.loads(sys.argv[1]); assert all(k in d and d[k]==v for k,v in expected.items())' '{"identityPolicy":"MANUAL_REVIEW","mode":"MINIAPP_WEBVIEW","enabled":false,"signProviderConfigured":false,"providerHosts":[],"returnUrl":"https://api.evsub.ndacar.com/api/public/esign-return","faceBridgeConfigured":false,"faceBridgeAllowlist":[],"faceBridgeProtocol":null,"faceBridgeKinds":[]}' >> "$run/runtime-check.log" 2>&1
  curl --fail --silent --show-error --connect-timeout 2 --max-time 5 http://127.0.0.1:13101/api/public/signing-config | python3 -c 'import json,sys; d=json.load(sys.stdin); expected=json.loads(sys.argv[1]); assert all(k in d and d[k]==v for k,v in expected.items())' '{"mode":"MINIAPP_WEBVIEW","newOrderContractMode":"OFFLINE","newEsignRequestsEnabled":false,"enabled":false,"signProviderConfigured":true,"providerHosts":["textapi17.fadada.com","realnameverify16.fadada.com"],"returnUrl":"https://api.evsub.ndacar.com/api/public/esign-return","faceBridgeConfigured":false,"faceBridgeAllowlist":[],"faceBridgeProtocol":null,"faceBridgeKinds":[],"fallback":{"mode":"SERVICE_ACCOUNT_H5","entryUrl":"https://sign.evsub.ndacar.com/miniapp-sign/","enabled":false,"signProviderConfigured":false},"ownerPortal":{"mode":"OWNER_LEGAL_H5","migrated":false,"entryUrl":"https://sign.evsub.ndacar.com/owner/"},"newElectronicRequestsEnabled":false,"electronicEnabled":false}' >> "$run/runtime-check.log" 2>&1
fi
new_compose exec -T api node -e '
const assert=require("node:assert/strict"),fs=require("node:fs");
assert.equal(process.env.MVP_V2_ENABLED,"true");assert.equal(process.env.NEW_ORDER_CONTRACT_MODE,"OFFLINE");assert.equal(process.env.ESIGN_NEW_REQUESTS_ENABLED,process.argv[1]==="scoped-virtual"?"true":"false");
assert.equal(process.env.CUSTOMER_IDENTITY_POLICY,"MANUAL_REVIEW");
assert.equal(process.env.SWAP_CREDIT_PURCHASE_ENABLED,"true");
assert.equal(process.env.PLATFORM_LEGAL_ENTITY_NAME,"上海宁达信息科技有限公司");
const mode=require("./dist/offline-documents/mode");assert.equal(mode.newOrderContractMode(),"OFFLINE");assert.throws(()=>mode.assertNewEsignAllowed({contractMode:"OFFLINE"}));
if(process.argv[1]==="scoped-virtual"){
 const gates={ELECTRONIC_SIGNING_ENABLED:"true",FADADA_SIGNING_ENABLED:"true",MINIAPP_SIGNING_ENABLED:"true",MINIAPP_FACE_BRIDGE_ENABLED:"false",CUSTOMER_IDENTITY_ENABLED:"true",FADADA_ENABLED:"true",FADADA_ACCOUNT_REGISTER_ENABLED:"true",FADADA_REALNAME_VERIFY_ENABLED:"true",OWNER_ONBOARDING_ENABLED:"true",OWNER_LEGAL_H5_ENABLED:"true",PORTAL_SMS_ENABLED:"true",OWNER_AUTO_SIGNING_ENABLED:"false",H5_SIGNING_ENABLED:"false",OWNER_LEGAL_H5_ONLY:"false",FADADA_BASE_URL:"https://textapi17.fadada.com/api2/",MINIAPP_SIGNING_PROVIDER_HOSTS:"textapi17.fadada.com,realnameverify16.fadada.com"};
 for(const [key,value] of Object.entries(gates))assert.equal(process.env[key],value);
 assert.equal(Buffer.from(process.env.ESIGN_IDENTITY_ENCRYPTION_KEY,"base64").length,32);
 for(const key of ["FADADA_APP_ID","FADADA_APP_SECRET","FADADA_PLATFORM_CUSTOMER_ID","FADADA_PLATFORM_SIGNATURE_ID","ALIYUN_SMS_ACCESS_KEY_ID","ALIYUN_SMS_ACCESS_KEY_SECRET","ALIYUN_SMS_SIGN_NAME","ALIYUN_SMS_LOGIN_TEMPLATE_CODE"])assert.ok(process.env[key]?.trim());
 assert.throws(()=>mode.assertNewEsignAllowed());assert.throws(()=>mode.assertEnterpriseOnboardingAllowed());
 assert.throws(()=>require("./dist/customers/identity-policy").requireProviderIdentity());
 (async()=>{await assert.rejects(()=>mode.assertNewProviderOperation());})().catch(()=>process.exit(1));
}
require("./dist/auth/staff-command").staffDigest({releaseCheck:true});
const PDFDocument=require("pdfkit"),doc=new PDFDocument();let bytes=0;
doc.on("data",chunk=>bytes+=chunk.length);doc.on("error",()=>process.exit(1));doc.on("end",()=>{if(bytes<1000)process.exit(1);});
require("./dist/contract/pdf-font").useCjkFont(doc,process.env.CONTRACT_CJK_FONT_PATH);doc.text("宁达线下合同打印核验 人民币壹元整");doc.end();
' "$profile" >> "$run/runtime-check.log" 2>&1
phase=static-switch
find "$target" -type d -exec chmod 555 {} +
find "$target" -type f -exec chmod 444 {} +
ln -sfn "$target" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
install -m 644 "$run/nginx.frozen-final" "$vhost"
nginx -t >> "$run/commands.log" 2>&1
systemctl reload nginx >> "$run/commands.log" 2>&1
phase=open-traffic
# No fallible migrations, bootstrap or config changes remain after this point.
cp "$root/.env.production" "$root/.env.active"
chmod 600 "$root/.env.active"
rm "$root/.mvp-maintenance"
for endpoint in api.evsub.ndacar.com/api/health admin.evsub.ndacar.com/ admin.evsub.ndacar.com/field.html sign.evsub.ndacar.com/owner/ sign.evsub.ndacar.com/owner/api/config; do
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 --retry 5 --retry-connrefused --retry-delay 1 --resolve "${endpoint%%/*}:443:127.0.0.1" "https://$endpoint" >/dev/null 2>> "$run/commands.log"
done
phase=active
receipt activated
