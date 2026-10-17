"""Run over SSH stdin on the independent production host. No secrets are printed.
Arguments: release source_commit archive_sha256. Package: field-<release>.tar.gz.
The schema change is additive; rollback restores image/env/static, retaining the backup and new tables.
"""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys,tarfile,time,urllib.request,urllib.error
root=Path('/opt/wechat-miniapp-sub').resolve()
release,revision,expected=sys.argv[1:]
assert re.fullmatch(r'20261017-field-v[0-9]+',release)
assert re.fullmatch('[a-f0-9]{40}',revision) and re.fullmatch('[a-f0-9]{64}',expected)
def run(args): return subprocess.check_output(args,universal_newlines=True).strip()
def checked(args): subprocess.check_call(args)
previous=run(['docker','inspect','chundian-prod-api-1','--format','{{.Config.Image}}'])
assert previous=='chundian-api:20261017-direct-v2'
assert shutil.disk_usage(root).free>400*1024*1024
archive=root/('field-'+release+'.tar.gz')
assert hashlib.sha256(archive.read_bytes()).hexdigest()==expected
target=root/'releases'/release
assert target.resolve().parent==root/'releases' and not target.exists()
target.mkdir()
with tarfile.open(str(archive)) as package:
 assert all(target in (target/m.name).resolve().parents and not m.issym() and not m.islnk() for m in package.getmembers())
 package.extractall(str(target))
manifest=json.loads((target/'file-manifest.json').read_text())
assert manifest['sourceCommit']==revision
for row in manifest['files']:
 p=target/row['path'];assert target in p.resolve().parents and not p.is_symlink()
 assert hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256']
assert (target/'admin/field.html').is_file() and (target/'runtime-api/prisma/migrations/20261017120000_field_handover/migration.sql').is_file()
static=(root/'current').resolve()
assert root/'releases' in static.parents
# Retain old hashed assets for already-open admin pages and preserve the disabled old H5 bundle.
if (static/'signing-h5').exists(): shutil.copytree(str(static/'signing-h5'),str(target/'signing-h5'))
for old in (static/'admin/assets').glob('*'):
 if old.is_file() and not (target/'admin/assets'/old.name).exists(): shutil.copy2(str(old),str(target/'admin/assets'/old.name))
dockerfile=target/'Dockerfile.runtime'
dockerfile.write_text('FROM '+previous+'\nUSER root\nCOPY runtime-api/dist /app/apps/api/dist\nCOPY runtime-api/prisma /app/apps/api/prisma\nRUN node /app/apps/api/node_modules/prisma/build/index.js generate --schema /app/apps/api/prisma/schema.prisma\nLABEL org.opencontainers.image.revision="'+revision+'"\nUSER node\n')
image='chundian-api:'+release
checked(['docker','build','--network=none','--pull=false','-f',str(dockerfile),'-t',image,str(target)])
assert shutil.disk_usage(root).free>180*1024*1024
canary="const a=require('./dist/auth/access');const p=require('@prisma/client');if(a.allowed('FIELD','orders',false)||!a.allowed('FIELD','field-tasks',true)||p.Role.FIELD!=='FIELD')process.exit(1);console.log('Field permission and Prisma canary passed');"
checked(['docker','run','--rm','--network=none',image,'node','-e',canary])
snapshot="const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{if(new URL(process.env.DATABASE_URL).pathname!=='/chundian_prod')throw Error('wrong db');const r={};for(const n of ['application','order','handover','contract','bill','payment','ownerESignAccount'])r[n]=await p[n].count();console.log(JSON.stringify(r));await p.$disconnect()})().catch(()=>process.exit(1));"
before=json.loads(run(['docker','exec','chundian-prod-api-1','node','-e',snapshot]))
backup=root/'backups'/('before-'+release+'.dump')
with os.fdopen(os.open(str(backup),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as out:
 subprocess.check_call(['docker','exec','chundian-prod-db-1','pg_dump','-U','chundian_prod','-d','chundian_prod','-Fc'],stdout=out)
assert backup.stat().st_size>0
env=root/'.env.production';original=env.read_bytes();text=original.decode()
envbackup=root/'backups'/('before-'+release+'.env')
with os.fdopen(os.open(str(envbackup),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as out:out.write(original)
for k,v in [('API_IMAGE',image),('BUILD_VERSION',release)]:
 text,n=re.subn(r'(?m)^'+k+r'=[^\r\n]*',k+'='+json.dumps(v),text);assert n==1
compose=['docker','compose','--env-file',str(env),'-f',str(root/'deploy/compose.production.yml')]
migrate="const {spawnSync}=require('node:child_process');const r=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy','--schema','/app/apps/api/prisma/schema.prisma'],{stdio:'inherit'});process.exit(r.status??1);"
# Docker --env-file does not unquote Compose values. Reuse only the running
# independent database connection, passing it by inherited environment name.
container=json.loads(run(['docker','inspect','chundian-prod-api-1']))[0]
assert 'chundian-prod_default' in container['NetworkSettings']['Networks']
runtime=dict(row.split('=',1) for row in container['Config']['Env'])
migration_env=dict(os.environ,DATABASE_URL=runtime['DATABASE_URL'])
subprocess.check_call(['docker','run','--rm','--network','chundian-prod_default','-e','DATABASE_URL',image,'node','-e',migrate],env=migration_env)
try:
 temp=root/('.env.'+release);assert not temp.exists()
 with os.fdopen(os.open(str(temp),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as out:out.write(text.encode())
 os.replace(str(temp),str(env));checked(compose+['up','-d','--no-deps','api'])
 for attempt in range(40):
  try:
   with urllib.request.urlopen('http://127.0.0.1:13101/api/health',timeout=2) as r:h=json.load(r)
   if h.get('version')==release and h.get('database')=='connected':break
  except Exception:pass
  time.sleep(1)
 else:raise RuntimeError('API health failed')
 assert json.loads(run(['docker','exec','chundian-prod-api-1','node','-e',snapshot]))==before
 link=root/('current-'+release);assert not link.exists();link.symlink_to(target);os.replace(str(link),str(root/'current'))
 with urllib.request.urlopen('https://mini-admin.subauto.keybox.cloud/field.html',timeout=15) as r:assert r.status==200 and b'/assets/field-' in r.read()
 for path in ['admin/field-tasks','admin/handover-tasks']:
  try:urllib.request.urlopen('https://mini-api.subauto.keybox.cloud/api/'+path,timeout=15);raise RuntimeError('Unauthenticated route accessible')
  except urllib.error.HTTPError as e:assert e.code==401
 with urllib.request.urlopen('https://mini-api.subauto.keybox.cloud/api/public/handover-location',timeout=15) as r:cap=json.load(r)
 assert cap['enabled'] and not cap['mapEnabled']
 print(json.dumps({'release':release,'sourceCommit':revision,'healthy':True,'staffEntry':True,'unauthenticatedDenied':True,'businessCountsUnchanged':before,'mapEnabled':False,'migrations':['20261017120000_field_handover','20261017130000_field_vehicle_context'],'freeBytes':shutil.disk_usage(root).free}))
except BaseException:
 env.write_bytes(original);os.chmod(str(env),0o600)
 if (root/'current').resolve()!=static:
  rollback=root/('rollback-'+release);rollback.symlink_to(static);os.replace(str(rollback),str(root/'current'))
 subprocess.call(compose+['up','-d','--no-deps','api']);raise
