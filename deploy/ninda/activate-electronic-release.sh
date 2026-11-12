#!/usr/bin/env bash
# Dedicated cutover for 8.133.232.213 only. Invoke the uploaded file, not bash -s.
# RELEASE CANDIDATE ENV_SHA OLD_IMAGE_ID MANIFEST_SHA NEW_IMAGE_ID MACHINE_ID preserve electronic-production
# Production electronic cutover. Never reset business data or fall back to paper.
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
profile=${9:-electronic-production}
[[ "$profile" = electronic-production && "$mode" = preserve ]]
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
    electronic=sys.argv[6]=='electronic-production'
    assert electronic and old.get('NEW_ORDER_CONTRACT_MODE') in ['OFFLINE','ELECTRONIC']
    gates={'NEW_ORDER_CONTRACT_MODE':'ELECTRONIC','CUSTOMER_IDENTITY_POLICY':'SIGNING_REQUIRED','ESIGN_NEW_REQUESTS_ENABLED':'true','ELECTRONIC_SIGNING_ENABLED':'true','CUSTOMER_IDENTITY_ENABLED':'true','FADADA_ENABLED':'true','FADADA_ACCOUNT_REGISTER_ENABLED':'true','FADADA_REALNAME_VERIFY_ENABLED':'true','FADADA_SIGNING_ENABLED':'true','MINIAPP_SIGNING_ENABLED':'true','MINIAPP_FACE_BRIDGE_ENABLED':'false','OWNER_ONBOARDING_ENABLED':'true','OWNER_LEGAL_H5_ENABLED':'true','OWNER_LEGAL_H5_ONLY':'true'}
    fixed.update(gates)
    assert all(new.get(k)==v for k,v in fixed.items())
    assert new.get('OWNER_AUTO_SIGNING_ENABLED')=='false' and new.get('H5_SIGNING_ENABLED')=='false'
    assert new.get('FADADA_BASE_URL')=='https://textapi17.fadada.com/api2/'
    assert new.get('MINIAPP_SIGNING_PROVIDER_HOSTS')=='textapi17.fadada.com,realnameverify16.fadada.com'
    assert len(base64.b64decode(new.get('ESIGN_IDENTITY_ENCRYPTION_KEY',''),validate=True))==32
    assert all(new.get(k,'').strip() for k in ['FADADA_APP_ID','FADADA_APP_SECRET','FADADA_PLATFORM_CUSTOMER_ID','FADADA_PLATFORM_SIGNATURE_ID'])
    change={'BUILD_VERSION','API_IMAGE',*gates}
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
    if electronic:
        # dotenv decoding equality alone cannot prove Compose interpolation safety.
        # Compare resolved consumer models before touching maintenance or active env.
        compose_file=pathlib.Path(sys.argv[1]).parent/'deploy/compose.production.yml'
        def consumed(path):
            overlay=json.dumps({'services':{'api':{'env_file':[str(pathlib.Path(path).resolve())]}}})
            result=subprocess.run(['docker','compose','--env-file',path,'-f',str(compose_file),'-f','-','config','--format','json'],input=overlay,text=True,capture_output=True,timeout=30,check=True)
            return json.loads(result.stdout)['services']
        old_services,new_services=consumed(sys.argv[1]),consumed(sys.argv[2])
        old_api,new_api=old_services['api']['environment'],new_services['api']['environment']
        assert set(old_api).issubset(new_api) and set(new_api)-set(old_api)<=change
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
    if [ "$migration_started" = true ] || [ "$maintenance" = true ]; then
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
curl --fail --silent --show-error --connect-timeout 2 --max-time 5 http://127.0.0.1:13101/api/public/identity-config | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["identityPolicy"]=="SIGNING_REQUIRED" and d["enabled"] and d["signProviderConfigured"] and not d["faceBridgeConfigured"]' >> "$run/runtime-check.log" 2>&1
curl --fail --silent --show-error --connect-timeout 2 --max-time 5 http://127.0.0.1:13101/api/public/signing-config | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["newOrderContractMode"]=="ELECTRONIC" and d["electronicEnabled"] and d["newElectronicRequestsEnabled"] and not d["enabled"] and d["ownerPortal"]["migrated"] and d["ownerPortal"]["entryUrl"]=="https://sign.evsub.ndacar.com/owner/"' >> "$run/runtime-check.log" 2>&1
new_compose exec -T api node -e '
const assert=require("node:assert/strict");
assert.equal(process.env.OWNER_AUTO_SIGNING_ENABLED,"false");assert.equal(process.env.MINIAPP_FACE_BRIDGE_ENABLED,"false");
const mode=require("./dist/offline-documents/mode");assert.equal(mode.newOrderContractMode(),"ELECTRONIC");assert.throws(()=>mode.assertPaperSigningAllowed());
require("./dist/auth/staff-command").staffDigest({releaseCheck:true});
const PDFDocument=require("pdfkit"),doc=new PDFDocument();let bytes=0;doc.on("data",chunk=>bytes+=chunk.length);doc.on("error",()=>process.exit(1));doc.on("end",()=>{if(bytes<1000)process.exit(1);});require("./dist/contract/pdf-font").useCjkFont(doc,process.env.CONTRACT_CJK_FONT_PATH);doc.text("宁达电子合同核验 人民币壹元整");doc.end();
' >> "$run/runtime-check.log" 2>&1
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
