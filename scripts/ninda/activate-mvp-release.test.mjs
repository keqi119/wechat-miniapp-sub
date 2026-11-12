import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const source=resolve(here,'../../deploy/ninda/activate-mvp-release.sh');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
const posix=p=>p.replaceAll('\\','/').replace(/^([A-Z]):/i,(_,d)=>`/${d.toLowerCase()}`);
const hash=s=>createHash('sha256').update(s).digest('hex');
const oldImage=`sha256:${'a'.repeat(64)}`,newImage=`sha256:${'b'.repeat(64)}`,machine='c'.repeat(32);
function fixture(t,{failure='',mode='preserve',badConfig=false,badManifest=false,badImage=false,archiveExists=false,staff=false,badRole=false,businessRows=false,priorGate='',oldIdentityPolicy,candidateIdentityPolicy='MANUAL_REVIEW',extraConfig=false,publicIdentityPolicy='MANUAL_REVIEW',oldSwapPurchase,candidateSwapPurchase='true',profile='standard',publicMismatch=false,providerMutation=false,composeMismatch=false}={}){
 assert.ok(existsSync(source),'MVP release entry must exist');
 const work=mkdtempSync(join(here,'.mvp-release-test-'));
 t.after(()=>rmSync(work,{recursive:true,force:true}));
 const root=join(work,'root'),bin=join(work,'bin'),log=join(work,'commands.log');
 const put=(path,text)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text,{mode:0o755});};
 const release='mvp-test',target=join(root,'releases',release),vhost=join(work,'nginx.conf');
 for(const p of ['deploy','backups','uploads','releases/old'])mkdirSync(join(root,p),{recursive:true});
 put(join(target,'admin/index.html'),'admin');put(join(target,'admin/field.html'),'field');
 put(join(target,'signing-h5/index.html'),'sign');put(join(target,'signing-h5/owner.html'),'owner');
 const manifest=['admin/index.html','admin/field.html','signing-h5/index.html','signing-h5/owner.html'].sort().map(p=>`${hash(readFileSync(join(target,p)))}  ${p}`).join('\n')+'\n';
 put(join(target,'SHA256SUMS'),manifest);
 if(badManifest)put(join(target,'admin/index.html'),'tampered');
 const env={NODE_ENV:'production',APP_ENV:'production',BUILD_VERSION:'old',API_IMAGE:'ninda-api:old',PLATFORM_LEGAL_ENTITY_NAME:'上海宁达信息科技有限公司',PLATFORM_API_ORIGIN:'https://api.evsub.ndacar.com',ADMIN_ORIGIN:'https://admin.evsub.ndacar.com',H5_SIGNING_ORIGIN:'https://sign.evsub.ndacar.com',POSTGRES_USER:'ninda_prod',POSTGRES_DB:'ninda_prod',POSTGRES_PASSWORD:'d'.repeat(64),DATABASE_URL:`postgresql://ninda_prod:${'d'.repeat(64)}@db:5432/ninda_prod?connection_limit=12`,WECHAT_MINIPROGRAM_APP_ID:'wxb5115e5a5f70f1b1',WECHAT_OFFICIAL_ACCOUNT_APP_ID:'wx556ac6833f4c4d30',WECHAT_PAY_MCH_ID:'1749304222',JWT_SECRET:'j'.repeat(40),SESSION_SECRET:'s'.repeat(40),ESIGN_IDENTITY_ENCRYPTION_KEY:Buffer.alloc(32).toString('base64'),WECHAT_PAY_API_V3_KEY:'synthetic-retained-provider-secret',BOOTSTRAP_ADMIN_USERNAME:'admin',BOOTSTRAP_ADMIN_PASSWORD:'p'.repeat(40)};
 const encode=e=>Object.entries(e).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n';
 if(priorGate==='known')Object.assign(env,{MVP_V2_ENABLED:'true',NEW_ORDER_CONTRACT_MODE:'OFFLINE',ESIGN_NEW_REQUESTS_ENABLED:'false',STAFF_COMMAND_DIGEST_KEY:'e'.repeat(64),STAFF_COMMAND_DIGEST_KEY_VERSION:'1',CONTRACT_CJK_FONT_PATH:'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'});
 if(oldIdentityPolicy!==undefined)env.CUSTOMER_IDENTITY_POLICY=oldIdentityPolicy;
 if(oldSwapPurchase!==undefined)env.SWAP_CREDIT_PURCHASE_ENABLED=oldSwapPurchase;
 if(profile==='scoped-virtual')Object.assign(env,{MVP_V2_ENABLED:'true',NEW_ORDER_CONTRACT_MODE:'OFFLINE',CUSTOMER_IDENTITY_POLICY:'MANUAL_REVIEW',ESIGN_NEW_REQUESTS_ENABLED:'false',FADADA_SIGNING_ENABLED:'false',MINIAPP_SIGNING_ENABLED:'false',MINIAPP_FACE_BRIDGE_ENABLED:'true',CUSTOMER_IDENTITY_ENABLED:'true',FADADA_ENABLED:'true',FADADA_ACCOUNT_REGISTER_ENABLED:'true',FADADA_REALNAME_VERIFY_ENABLED:'true',OWNER_ONBOARDING_ENABLED:'true',OWNER_LEGAL_H5_ENABLED:'true',PORTAL_SMS_ENABLED:'true',OWNER_AUTO_SIGNING_ENABLED:'false',OWNER_LEGAL_H5_ONLY:'false',H5_SIGNING_ENABLED:'false',SWAP_CREDIT_PURCHASE_ENABLED:'true',STAFF_COMMAND_DIGEST_KEY:'e'.repeat(64),STAFF_COMMAND_DIGEST_KEY_VERSION:'1',CONTRACT_CJK_FONT_PATH:'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',FADADA_APP_ID:'synthetic',FADADA_APP_SECRET:'synthetic',FADADA_PLATFORM_CUSTOMER_ID:'synthetic-platform',FADADA_PLATFORM_SIGNATURE_ID:'synthetic-seal',FADADA_BASE_URL:'https://textapi17.fadada.com/api2/',MINIAPP_SIGNING_PROVIDER_HOSTS:'textapi17.fadada.com,realnameverify16.fadada.com',ALIYUN_SMS_ACCESS_KEY_ID:'synthetic',ALIYUN_SMS_ACCESS_KEY_SECRET:'synthetic',ALIYUN_SMS_SIGN_NAME:'synthetic',ALIYUN_SMS_LOGIN_TEMPLATE_CODE:'synthetic'});
 const active=encode(env);put(join(root,'.env.production'),active);put(join(root,'.env.active'),active);
 const candidate={...env,BUILD_VERSION:release,API_IMAGE:`ninda-api:${release}`,MVP_V2_ENABLED:'true',NEW_ORDER_CONTRACT_MODE:'OFFLINE',ESIGN_NEW_REQUESTS_ENABLED:'false',STAFF_COMMAND_DIGEST_KEY:'e'.repeat(64),STAFF_COMMAND_DIGEST_KEY_VERSION:'1',CONTRACT_CJK_FONT_PATH:'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'};
 if(candidateIdentityPolicy===null)delete candidate.CUSTOMER_IDENTITY_POLICY;else candidate.CUSTOMER_IDENTITY_POLICY=candidateIdentityPolicy;
 if(candidateSwapPurchase===null)delete candidate.SWAP_CREDIT_PURCHASE_ENABLED;else if(candidateSwapPurchase!==undefined)candidate.SWAP_CREDIT_PURCHASE_ENABLED=candidateSwapPurchase;
 if(profile==='scoped-virtual')Object.assign(candidate,{ESIGN_NEW_REQUESTS_ENABLED:'true',ELECTRONIC_SIGNING_ENABLED:'true',FADADA_SIGNING_ENABLED:'true',MINIAPP_SIGNING_ENABLED:'true',MINIAPP_FACE_BRIDGE_ENABLED:'false'});
 if(providerMutation)candidate.FADADA_PLATFORM_SIGNATURE_ID='changed';
 if(extraConfig)candidate.UNREVIEWED_NEW_GATE='true';
 if(badConfig)candidate.WECHAT_PAY_API_V3_KEY='changed';
 put(join(root,'.env.candidate-test'),encode(candidate));
 let nginx='server {\n listen 443 ssl;\n server_name api.evsub.ndacar.com;\n}\nserver {\n listen 443 ssl;\n server_name admin.evsub.ndacar.com;\n}\nserver {\n listen 443 ssl;\n server_name sign.evsub.ndacar.com;\n}\n';
 if(priorGate==='known')nginx=nginx.replaceAll('server {\n',`server {\n    if (-f ${join(root,'.mvp-maintenance')}) { return 503; }\n    add_header Retry-After 120 always;\n`);
 if(priorGate==='unknown')nginx=nginx.replace('server {\n','server {\n    if (-f /unrecognized/.mvp-maintenance) { return 200; }\n');
 put(vhost,nginx);put(join(root,'deploy/nginx-production.conf'),nginx);put(join(root,'deploy/compose.production.yml'),'name: ninda-prod\n');put(join(work,'machine-id'),machine+'\n');
 // All external commands are local fakes. The real Bash control flow, Python
 // validators, filesystem writes, backup selection and failure trap execute.
 put(join(bin,'id'),'#!/usr/bin/env bash\necho 0\n');
 put(join(bin,'flock'),'#!/usr/bin/env bash\nexit 0\n');
 put(join(bin,'sleep'),'#!/usr/bin/env bash\nexit 0\n');
 const python=process.platform==='win32'?'C:/Program Files/Python312/python.exe':'python3';
 put(join(bin,'python3'),`#!/usr/bin/env bash\nargs=(); for arg in "$@"; do if [[ "$arg" =~ ^/[a-z]/ ]]; then args+=("$(cygpath -w "$arg")"); else args+=("$arg"); fi; done\nexec '${posix(python)}' "\${args[@]}"\n`);
 put(join(bin,'docker'),`#!/usr/bin/env bash
echo "docker $*" >> "$TEST_LOG"
if [[ "$*" == "inspect ninda-prod-api-1 --format {{.Image}}" ]]; then echo "$TEST_OLD_IMAGE"; exit 0; fi
if [[ "$*" == *"{{.State.Running}}"* ]]; then test -f "$TEST_ROOT/stopped" && echo false || echo true; exit 0; fi
if [[ "$*" == *"config --format json"* ]]; then
 if [[ "$*" == *".env.candidate-test"* ]]; then printf '%s' "$TEST_COMPOSE_CANDIDATE"; else printf '%s' "$TEST_COMPOSE_BEFORE"; fi
 exit 0
fi
if [[ "$1 $2" == "image inspect" ]]; then echo "$TEST_NEW_IMAGE"; exit 0; fi
if [[ "$*" == *"stop api"* ]]; then touch "$TEST_ROOT/stopped"; exit 0; fi
if [[ "$*" == *"up -d --no-deps api"* ]]; then rm -f "$TEST_ROOT/stopped"; echo "start-image $API_IMAGE" >> "$TEST_LOG"; exit 0; fi
if [[ "$*" == *"pg_database"* ]]; then echo "$TEST_ARCHIVE_EXISTS"; exit 0; fi
if [[ "$*" == *"json_build_object"* ]]; then printf '{"staff":1,"publicLegal":0,"business":%s,"sessions":0,"unapprovedLegal":0}' "$TEST_BUSINESS_ROWS"; exit 0; fi
if [[ "$*" == *"COPY (SELECT"* && "$*" == *"AdminUser"* ]]; then test -z "$TEST_STAFF_ROW" || printf '%s\\n' "$TEST_STAFF_ROW"; exit 0; fi
if [[ "$*" == *"COPY (SELECT"* && "$*" == *"LegalDocument"* ]]; then exit 0; fi
if [[ "$*" == *"FROM STDIN"* ]]; then cat >/dev/null; test "$TEST_FAIL" != inherit; exit; fi
if [[ "$*" == *"ALTER DATABASE"* ]]; then test "$TEST_FAIL" != rename; exit; fi
if [[ "$*" == *"CREATE DATABASE"* ]]; then test "$TEST_FAIL" != create; exit; fi
if [[ "$*" == *"dist/common/migrate.js"* ]]; then test "$TEST_FAIL" != migrate; exit; fi
if [[ "$*" == *"dist/auth/bootstrap.js"* ]]; then test "$TEST_FAIL" != bootstrap; exit; fi
if [[ "$*" == *"exec -T api node"* ]]; then test "$TEST_FAIL" != runtime; exit; fi
exit 0
`);
 put(join(bin,'nginx'),'#!/usr/bin/env bash\necho "nginx $*" >> "$TEST_LOG"\nexit 0\n');
 put(join(bin,'systemctl'),'#!/usr/bin/env bash\necho "systemctl $*" >> "$TEST_LOG"\nexit 0\n');
 put(join(bin,'curl'),`#!/usr/bin/env bash
echo "curl $*" >> "$TEST_LOG"
if [[ "$*" == *"--write-out"* ]]; then test -f "$TEST_ROOT/.mvp-maintenance" && printf 503 || printf 200; exit 0; fi
test "$TEST_FAIL" != health || exit 22
if [[ "$*" == *"/api/public/signing-config"* ]]; then printf '%s' '${JSON.stringify({...JSON.parse(readFileSync(resolve(here,'../../.superpowers/sdd/2026-11-07-ninda-v31-electronic-contracts/task-11b-old-public-capabilities.json'),'utf8')).entries[1].body,newElectronicRequestsEnabled:publicMismatch,electronicEnabled:false})}'; exit 0; fi
if [[ "$*" == *"/api/public/identity-config"* ]]; then printf '%s' '${JSON.stringify(publicIdentityPolicy===null?{}:{...JSON.parse(readFileSync(resolve(here,'../../.superpowers/sdd/2026-11-07-ninda-v31-electronic-contracts/task-11b-old-public-capabilities.json'),'utf8')).entries[0].body,identityPolicy:publicIdentityPolicy})}'; exit 0; fi
printf '{"status":"ok","database":"connected","version":"mvp-test"}'
`);
 put(join(root,'deploy/backup.sh'),`#!/usr/bin/env bash
echo backup >> "$TEST_LOG"
test "$TEST_FAIL" != backup || exit 1
touch "$TEST_ROOT/backups/20261027T000000000Z.tar.enc"
echo 'Encrypted Ninda backup created: 20261027T000000000Z'
`);
 put(join(root,'deploy/verify-backup.sh'),'#!/usr/bin/env bash\necho verify-backup >> "$TEST_LOG"\ntest "$TEST_FAIL" != verify\n');
 let script=readFileSync(source,'utf8').replaceAll('/opt/ninda-platform',posix(root)).replaceAll('/etc/nginx/conf.d/ninda-platform.conf',posix(vhost)).replaceAll('/etc/machine-id',posix(join(work,'machine-id')));
 // Windows CreateProcess cannot execute the extensionless Bash fake directly.
 if(process.platform==='win32')script=script.replace("subprocess.run(['docker','compose',",`subprocess.run([${JSON.stringify(bash)},'-c','export PATH="$TEST_BIN:$PATH"; exec docker "$@"','test-compose','compose',`);
 put(join(work,'activate.sh'),script);
 const result=spawnSync(bash,['-c','export PATH="$TEST_BIN:$PATH"; exec bash "$@"','test-harness',posix(join(work,'activate.sh')),release,'.env.candidate-test',hash(active),oldImage,hash(manifest),newImage,machine,mode,profile],{encoding:'utf8',timeout:60000,env:{...process.env,TEST_COMPOSE_BEFORE:JSON.stringify({services:{api:{environment:env},db:{environment:{POSTGRES_PASSWORD:env.POSTGRES_PASSWORD}}}}),TEST_COMPOSE_CANDIDATE:JSON.stringify({services:{api:{environment:{...candidate,...(composeMismatch?{SESSION_SECRET:'interpolated-different'}:{})}},db:{environment:{POSTGRES_PASSWORD:env.POSTGRES_PASSWORD}}}}),TEST_BIN:posix(bin),TEST_LOG:posix(log),TEST_ROOT:posix(root),TEST_FAIL:failure,TEST_OLD_IMAGE:badImage?newImage:oldImage,TEST_NEW_IMAGE:newImage,TEST_ARCHIVE_EXISTS:archiveExists?'1':'0',TEST_BUSINESS_ROWS:businessRows?'1':'0',TEST_STAFF_ROW:staff?`staff-id,admin,synthetic-hash,管理员,${badRole?'UNKNOWN':'ADMIN'},t,2026-10-27 00:00:00,0,1,2026-10-27 00:00:00`:'',MSYS2_ARG_CONV_EXCL:'*'}});
 return {result,root,log:existsSync(log)?readFileSync(log,'utf8'):'',active,candidate:encode(candidate),vhost,nginx};
}
test('success freezes all hosts before stop, verifies backup before migration, and activates only checked new image',t=>{
 const f=fixture(t);assert.equal(f.result.status,0,f.result.stderr+f.result.stdout);
 for(const token of ['stop api','backup','verify-backup','dist/common/migrate.js','up -d --no-deps api'])assert.ok(f.log.includes(token),token);
 assert.ok(f.log.indexOf('stop api')<f.log.indexOf('\nbackup\n'));
 assert.ok(f.log.indexOf('\nverify-backup\n')<f.log.indexOf('dist/common/migrate.js'));
 assert.ok(!existsSync(join(f.root,'.mvp-maintenance')));
 assert.equal(readFileSync(join(f.root,'.env.active'),'utf8'),f.candidate);
 assert.ok(!f.log.includes(`start-image ${oldImage}`));
 assert.ok(!f.result.stdout.includes('synthetic-retained-provider-secret'));
});
for(const failure of ['migrate','health','runtime'])test(`post-migration ${failure} failure retains maintenance and candidate config without old image`,t=>{
 const f=fixture(t,{failure});assert.notEqual(f.result.status,0);assert.ok(existsSync(join(f.root,'.mvp-maintenance')));
 assert.equal(readFileSync(join(f.root,'.env.production'),'utf8'),f.candidate);assert.ok(!f.log.includes(`start-image ${oldImage}`));
 assert.ok(f.result.stdout.includes('"status":"failed-maintenance"'),f.result.stdout+f.result.stderr);
});
for(const failure of ['backup','verify'])test(`pre-migration ${failure} failure restores old runtime/routes`,t=>{
 const f=fixture(t,{failure});assert.notEqual(f.result.status,0);assert.ok(!existsSync(join(f.root,'.mvp-maintenance')));
 assert.equal(readFileSync(join(f.root,'.env.production'),'utf8'),f.active);assert.ok(f.log.includes(`start-image ${oldImage}`));
 assert.ok(!f.log.includes('dist/common/migrate.js'));
});
for(const option of ['badConfig','badManifest','badImage'])test(`${option} refuses before traffic or database mutation`,t=>{
 const f=fixture(t,{[option]:true});assert.notEqual(f.result.status,0);assert.ok(!f.log.includes('stop api'));assert.ok(!f.log.includes('nginx'));assert.ok(!f.log.includes('dist/common/migrate.js'));
});
test('fresh mode verifies backup then archives dedicated database, creates clean database, migrates and bootstraps',t=>{
 const f=fixture(t,{mode:'fresh'});assert.equal(f.result.status,0,f.result.stderr+f.result.stdout);
 assert.ok(f.log.indexOf('\nverify-backup\n')<f.log.indexOf('ALTER DATABASE'));
 assert.ok(f.log.indexOf('ALTER DATABASE')<f.log.indexOf('CREATE DATABASE'));
 assert.ok(f.log.indexOf('CREATE DATABASE')<f.log.indexOf('dist/common/migrate.js'));
 assert.ok(f.log.includes('dist/auth/bootstrap.js'));assert.ok(!/DROP DATABASE/.test(f.log));
});
test('existing archival database refuses fresh cutover and restores prior runtime',t=>{
 const f=fixture(t,{mode:'fresh',archiveExists:true});assert.notEqual(f.result.status,0);assert.ok(!f.log.includes('ALTER DATABASE'));assert.ok(!f.log.includes('dist/common/migrate.js'));assert.ok(f.log.includes(`start-image ${oldImage}`));
});
for(const failure of ['rename','create','bootstrap'])test(`fresh ${failure} failure never reconnects old API`,t=>{
 const f=fixture(t,{mode:'fresh',failure});assert.notEqual(f.result.status,0);assert.ok(existsSync(join(f.root,'.mvp-maintenance')));assert.ok(!f.log.includes(`start-image ${oldImage}`));
});
test('fresh mode preserves existing staff configuration and skips bootstrap without copying business data',t=>{
 const f=fixture(t,{mode:'fresh',staff:true});assert.equal(f.result.status,0,f.result.stdout+f.result.stderr);
 assert.ok(f.log.includes('COPY "AdminUser"'));assert.ok(f.log.includes('COPY "LegalDocument"'));
 assert.ok(!f.log.includes('dist/auth/bootstrap.js'));assert.ok(!f.result.stdout.includes('synthetic-hash'));
 assert.ok(f.log.includes("IN ('terms','privacy')"));assert.ok(!f.log.includes('COPY "Customer"'));
});
test('fresh unknown staff role refuses before archival',t=>{
 const f=fixture(t,{mode:'fresh',staff:true,badRole:true});assert.notEqual(f.result.status,0);assert.ok(!f.log.includes('ALTER DATABASE'));
});
test('fresh configuration import failure keeps maintenance and never starts old API',t=>{
 const f=fixture(t,{mode:'fresh',staff:true,failure:'inherit'});assert.notEqual(f.result.status,0);assert.ok(existsSync(join(f.root,'.mvp-maintenance')));assert.ok(!f.log.includes(`start-image ${oldImage}`));
});
test('fresh business rows detected after migration keep traffic closed',t=>{
 const f=fixture(t,{mode:'fresh',businessRows:true});assert.notEqual(f.result.status,0);assert.ok(existsSync(join(f.root,'.mvp-maintenance')));assert.ok(!f.log.includes('up -d --no-deps api'));
});
test('successor preserve release accepts its exact previous dormant maintenance gate without duplication',t=>{
 const f=fixture(t,{priorGate:'known'});assert.equal(f.result.status,0,f.result.stdout+f.result.stderr);
 assert.equal(readFileSync(f.vhost,'utf8').match(/if \(-f .*\.mvp-maintenance\) \{ return 503; \}/g)?.length,3);
 assert.ok(!f.log.includes('ALTER DATABASE'));assert.ok(!existsSync(join(f.root,'.mvp-maintenance')));
});
test('unknown maintenance gate is rejected before freezing or changing the database',t=>{
 const f=fixture(t,{priorGate:'unknown'});assert.notEqual(f.result.status,0);assert.ok(!f.log.includes('stop api'));assert.ok(!f.log.includes('dist/common/migrate.js'));assert.equal(readFileSync(f.vhost,'utf8'),f.nginx);
});

for(const oldIdentityPolicy of [undefined,'PROVIDER_REQUIRED','MANUAL_REVIEW'])test(`identity policy explicitly migrates ${oldIdentityPolicy??'missing'} to manual without changing other configuration`,t=>{
 const f=fixture(t,{oldIdentityPolicy});assert.equal(f.result.status,0,f.result.stdout+f.result.stderr);
 assert.equal(readFileSync(join(f.root,'.env.active'),'utf8'),f.candidate);
 assert.ok(f.log.includes('/api/public/identity-config'),'public policy must be checked before opening traffic');
 assert.ok(!f.log.includes('ALTER DATABASE'));assert.ok(!f.log.includes('CREATE DATABASE'));
 for(const line of f.active.split('\n').filter(Boolean))if(!/^(BUILD_VERSION|API_IMAGE|CUSTOMER_IDENTITY_POLICY)=/.test(line))assert.ok(f.candidate.split('\n').includes(line),line.split('=')[0]);
});
for(const candidateIdentityPolicy of ['PROVIDER_REQUIRED','MANUAL_REVEIW','',null])test(`identity policy refuses candidate ${candidateIdentityPolicy??'missing'} before mutation`,t=>{
 const f=fixture(t,{oldIdentityPolicy:candidateIdentityPolicy??undefined,candidateIdentityPolicy});
 assert.notEqual(f.result.status,0);assert.match(f.result.stderr,/NINDA_MVP_PREFLIGHT_REJECTED/);
 assert.ok(!f.log.includes('stop api'));assert.ok(!f.log.includes('nginx'));assert.ok(!f.log.includes('dist/common/migrate.js'));
 assert.equal(readFileSync(join(f.root,'.env.production'),'utf8'),f.active);
});
for(const oldIdentityPolicy of ['UNKNOWN',''])test(`identity policy refuses damaged previous value ${oldIdentityPolicy||'empty'}`,t=>{
 const f=fixture(t,{oldIdentityPolicy});assert.notEqual(f.result.status,0);assert.match(f.result.stderr,/NINDA_MVP_PREFLIGHT_REJECTED/);assert.ok(!f.log.includes('stop api'));
});
for(const option of ['badConfig','extraConfig'])test(`identity policy migration does not permit unrelated ${option}`,t=>{
 const f=fixture(t,{oldIdentityPolicy:'PROVIDER_REQUIRED',[option]:true});assert.notEqual(f.result.status,0);assert.match(f.result.stderr,/NINDA_MVP_PREFLIGHT_REJECTED/);assert.ok(!f.log.includes('stop api'));
});
for(const oldSwapPurchase of [undefined,'false','true'])test(`approved paid swap release enables prior ${oldSwapPurchase??'missing'} with provider values preserved`,t=>{
 const f=fixture(t,{priorGate:'known',oldIdentityPolicy:'MANUAL_REVIEW',oldSwapPurchase,candidateSwapPurchase:'true'});assert.equal(f.result.status,0,f.result.stderr+f.result.stdout);
 assert.ok(f.candidate.includes('SWAP_CREDIT_PURCHASE_ENABLED="true"'));
 assert.ok(f.log.includes('process.env.SWAP_CREDIT_PURCHASE_ENABLED'));
 for(const line of f.active.split('\n').filter(Boolean))if(!/^(BUILD_VERSION|API_IMAGE|SWAP_CREDIT_PURCHASE_ENABLED)=/.test(line))assert.ok(f.candidate.split('\n').includes(line),line.split('=')[0]);
});
for(const oldSwapPurchase of ['TRUE','', 'unknown'])test(`approved paid swap release refuses damaged prior ${oldSwapPurchase||'empty'}`,t=>{
 const f=fixture(t,{oldSwapPurchase,candidateSwapPurchase:'true'});assert.notEqual(f.result.status,0);assert.ok(!f.log.includes('stop api'));assert.ok(!f.log.includes('dist/common/migrate.js'));
});
for(const candidateSwapPurchase of ['TRUE','', 'false',null])test(`approved paid swap release refuses candidate ${candidateSwapPurchase??'missing'}`,t=>{
 const f=fixture(t,{oldSwapPurchase:'false',candidateSwapPurchase});assert.notEqual(f.result.status,0);assert.ok(!f.log.includes('stop api'));assert.ok(!f.log.includes('dist/common/migrate.js'));
});
for(const publicIdentityPolicy of ['PROVIDER_REQUIRED',null])test(`identity policy runtime rejects public ${publicIdentityPolicy??'missing'} and keeps maintenance`,t=>{
 const f=fixture(t,{oldIdentityPolicy:'MANUAL_REVIEW',publicIdentityPolicy});assert.notEqual(f.result.status,0);
 assert.ok(f.log.includes('dist/common/migrate.js'));assert.ok(existsSync(join(f.root,'.mvp-maintenance')));
 assert.ok(!existsSync(join(f.root,'current.next')));assert.ok(!f.log.includes(`start-image ${oldImage}`));
 assert.ok(f.result.stdout.includes('"status":"failed-maintenance"'),f.result.stdout+f.result.stderr);
});

test('scoped preserve accepts exact transitions with backup and runtime guards',t=>{const f=fixture(t,{profile:'scoped-virtual'});assert.equal(f.result.status,0,f.result.stderr+f.result.stdout);assert.ok(f.log.includes('/api/public/signing-config'));assert.ok(f.log.includes('assertNewProviderOperation'));assert.ok(f.log.includes('verify-backup'));assert.ok(!f.log.includes('ALTER DATABASE'));});
for(const option of [{mode:'fresh'},{providerMutation:true},{extraConfig:true},{badConfig:true}])test(`scoped rejects preflight ${JSON.stringify(option)}`,t=>{const f=fixture(t,{profile:'scoped-virtual',...option});assert.notEqual(f.result.status,0);assert.ok(!f.log.includes('stop api'));});
test('scoped public capability mismatch retains maintenance',t=>{const f=fixture(t,{profile:'scoped-virtual',publicMismatch:true});assert.notEqual(f.result.status,0);assert.ok(existsSync(join(f.root,'.mvp-maintenance')));assert.ok(f.log.includes('dist/common/migrate.js'));});
for(const failure of ['backup','verify','migrate','runtime'])test(`scoped preserves failure controls ${failure}`,t=>{const f=fixture(t,{profile:'scoped-virtual',failure});assert.notEqual(f.result.status,0);assert.ok(f.log.includes('stop api'));assert.equal(existsSync(join(f.root,'.mvp-maintenance')),['migrate','runtime'].includes(failure));});

test('scoped actual Compose mismatch refuses before maintenance or backup',t=>{const f=fixture(t,{profile:'scoped-virtual',composeMismatch:true});assert.notEqual(f.result.status,0);assert.match(f.result.stderr,/NINDA_MVP_PREFLIGHT_REJECTED/);assert.ok(f.log.includes('config --format json'));assert.ok(!f.log.includes('stop api'));assert.ok(!f.log.includes('nginx'));assert.ok(!f.log.includes('backup'));});
