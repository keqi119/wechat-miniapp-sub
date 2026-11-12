import test from 'node:test';
import assert from 'node:assert/strict';
import {validateElectronicTransition, electronicChanges} from './electronic-candidate.mjs';
const before={OWNER_AUTO_SIGNING_ENABLED:'false',POSTGRES_DB:'ninda_prod',POSTGRES_USER:'ninda_prod',JWT_SECRET:'synthetic-preserved',FADADA_BASE_URL:'https://textapi17.fadada.com/api2/',FADADA_APP_ID:'synthetic',FADADA_APP_SECRET:'synthetic',FADADA_PLATFORM_CUSTOMER_ID:'synthetic-platform',FADADA_PLATFORM_SIGNATURE_ID:'synthetic-seal',ESIGN_IDENTITY_ENCRYPTION_KEY:Buffer.alloc(32).toString('base64'),MINIAPP_SIGNING_PROVIDER_HOSTS:'textapi17.fadada.com,realnameverify16.fadada.com',NEW_ORDER_CONTRACT_MODE:'OFFLINE',CUSTOMER_IDENTITY_POLICY:'MANUAL_REVIEW'};
const after={...before,...electronicChanges};
test('explicit electronic transition preserves every unrelated value and never accepts paper fallback',()=>{assert.equal(validateElectronicTransition(before,after),true);for(const key of Object.keys(electronicChanges)){const input={...after};delete input[key];assert.throws(()=>validateElectronicTransition(before,input),key);}assert.throws(()=>validateElectronicTransition(before,{...after,JWT_SECRET:'changed'}));assert.throws(()=>validateElectronicTransition(before,{...after,UNREVIEWED:'true'}));});
test('candidate requires existing credentials and exact native channel without choosing defaults',()=>{for(const key of ['FADADA_APP_ID','FADADA_APP_SECRET','FADADA_PLATFORM_CUSTOMER_ID','FADADA_PLATFORM_SIGNATURE_ID','ESIGN_IDENTITY_ENCRYPTION_KEY','MINIAPP_SIGNING_PROVIDER_HOSTS'])assert.throws(()=>validateElectronicTransition({...before,[key]:''},{...after,[key]:''}),key);assert.throws(()=>validateElectronicTransition(before,{...after,FADADA_BASE_URL:'https://other.invalid/'}));});

test('initial enterprise identity needs its explicit onboarding capability',()=>assert.equal(electronicChanges.OWNER_ONBOARDING_ENABLED,'true'));

import {scopedVirtualChanges,validateScopedVirtualTransition,buildScopedVirtualCandidate} from './electronic-candidate.mjs';
const scopedBefore={SWAP_CREDIT_PURCHASE_ENABLED:'true',...before,...Object.fromEntries(Object.entries(electronicChanges).map(([k,v])=>[k,v])),NEW_ORDER_CONTRACT_MODE:'OFFLINE',CUSTOMER_IDENTITY_POLICY:'MANUAL_REVIEW',ESIGN_NEW_REQUESTS_ENABLED:'false',FADADA_SIGNING_ENABLED:'false',MINIAPP_SIGNING_ENABLED:'false',MINIAPP_FACE_BRIDGE_ENABLED:'true',OWNER_LEGAL_H5_ONLY:'false',OWNER_AUTO_SIGNING_ENABLED:'false',H5_SIGNING_ENABLED:'false',PORTAL_SMS_ENABLED:'true',SESSION_SECRET:'s'.repeat(40),ALIYUN_SMS_ACCESS_KEY_ID:'synthetic',ALIYUN_SMS_ACCESS_KEY_SECRET:'synthetic',ALIYUN_SMS_SIGN_NAME:'synthetic',ALIYUN_SMS_LOGIN_TEMPLATE_CODE:'synthetic'};
delete scopedBefore.ELECTRONIC_SIGNING_ENABLED;
test('scoped virtual exact five changes preserve all other values',()=>{const after={...scopedBefore,...scopedVirtualChanges};assert.equal(validateScopedVirtualTransition(scopedBefore,after),true);});
for(const key of ['UNREVIEWED_GATE','FADADA_PLATFORM_CUSTOMER_ID','FADADA_PLATFORM_SIGNATURE_ID','SESSION_SECRET','OWNER_LEGAL_H5_ONLY','NEW_ORDER_CONTRACT_MODE','CUSTOMER_IDENTITY_POLICY'])test(`scoped rejects mutation ${key}`,()=>assert.throws(()=>validateScopedVirtualTransition(scopedBefore,{...scopedBefore,...scopedVirtualChanges,[key]:'changed'})));
for(const key of ['FADADA_ENABLED','OWNER_ONBOARDING_ENABLED','PORTAL_SMS_ENABLED'])test(`scoped requires existing dependency ${key}`,()=>assert.throws(()=>validateScopedVirtualTransition({...scopedBefore,[key]:'false'},{...scopedBefore,...scopedVirtualChanges,[key]:'false'})));

test('scoped builder changes only release identity and enumerated gates',()=>{const after=buildScopedVirtualCandidate(scopedBefore,'synthetic-release');assert.equal(after.BUILD_VERSION,'synthetic-release');assert.equal(after.API_IMAGE,'ninda-api:synthetic-release');assert.equal(validateScopedVirtualTransition(scopedBefore,after,'synthetic-release'),true);assert.throws(()=>validateScopedVirtualTransition(scopedBefore,{...after,API_IMAGE:'other'},'synthetic-release'));});

test('scoped preserves unrelated decoded Unicode and secret bytes',()=>{const before={...scopedBefore,UNRELATED_SECRET:' 合成\n"quoted"\\路径$literal '};const after=buildScopedVirtualCandidate(before,'synthetic-release');assert.equal(after.UNRELATED_SECRET,before.UNRELATED_SECRET);assert.throws(()=>validateScopedVirtualTransition(before,{...after,UNRELATED_SECRET:before.UNRELATED_SECRET.trim()},'synthetic-release'));});

import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import * as candidateHelpers from './electronic-candidate.mjs';
function composeDecoded(file){
 const result=spawnSync('docker',['compose','--env-file',file,'-f','-','config','--format','json'],{input:JSON.stringify({services:{api:{image:'synthetic:local',env_file:[file]}}}),encoding:'utf8',env:{...process.env,TASK11C_DEFINED_INTERPOLATION_TOKEN:'host-value'}});
 assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout).services.api.environment;
}
test('scoped raw candidate survives actual Compose dollar quote slash Unicode newline decoding',t=>{
 const dir=mkdtempSync(resolve('.superpowers/sdd/2026-11-07-ninda-v31-electronic-contracts/compose-fix1-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const before={...scopedBefore,BUILD_VERSION:'old',API_IMAGE:'ninda-api:old'};
 const retained=["DOLLAR='synthetic-$TASK11C_DEFINED_INTERPOLATION_TOKEN-tail'",'DOUBLE_DOLLAR="synthetic-$$literal"',"QUOTES='He said \"合成\"'",String.raw`SLASHES='C:\synthetic\路径'`,String.raw`NEWLINES="first\n第二行"`,"UNICODE=' 合成尾部 '","# unchanged comment"];
 const raw=Object.entries(before).map(([k,v])=>k+'='+JSON.stringify(v)).join('\r\n')+'\r\n'+retained.join('\r\n')+'\r\n';
 const oldPath=join(dir,'before.env'),newPath=join(dir,'candidate.env');writeFileSync(oldPath,raw);
 const generated=candidateHelpers.buildScopedVirtualCandidateEnv?candidateHelpers.buildScopedVirtualCandidateEnv(raw,'synthetic-release'):Object.entries(buildScopedVirtualCandidate({...before,DOLLAR:'synthetic-$TASK11C_DEFINED_INTERPOLATION_TOKEN-tail',DOUBLE_DOLLAR:'synthetic-$$literal',QUOTES:'He said \"合成\"',SLASHES:String.raw`C:\synthetic\路径`,NEWLINES:'first\n第二行',UNICODE:' 合成尾部 '},'synthetic-release')).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n';
 writeFileSync(newPath,generated);const oldEnv=composeDecoded(oldPath),newEnv=composeDecoded(newPath);
 for(const key of ['DOLLAR','DOUBLE_DOLLAR','QUOTES','SLASHES','NEWLINES','UNICODE'])assert.equal(newEnv[key],oldEnv[key],key);
 assert.equal(newEnv.DOLLAR.replaceAll('$$','$'),'synthetic-$TASK11C_DEFINED_INTERPOLATION_TOKEN-tail');assert.equal(newEnv.NEWLINES,'first\n第二行');
 for(const line of retained)assert.ok(generated.includes(line),'raw retained line');
 for(const [key,value] of Object.entries(scopedVirtualChanges))assert.equal(newEnv[key],value);
});

test('raw candidate supports existing BOM and rejects duplicate or malformed entries',()=>{const raw='\uFEFF'+Object.entries({...scopedBefore,BUILD_VERSION:'old',API_IMAGE:'ninda-api:old'}).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n';const out=candidateHelpers.buildScopedVirtualCandidateEnv(raw,'synthetic-release');assert.ok(out.startsWith('\uFEFF'));assert.equal(out.match(/^BUILD_VERSION=/gm).length,1);assert.throws(()=>candidateHelpers.buildScopedVirtualCandidateEnv(raw+'BAD LINE\n','synthetic-release'));assert.throws(()=>candidateHelpers.buildScopedVirtualCandidateEnv(raw+'POSTGRES_DB=ninda_prod\n','synthetic-release'));});

test('protected scoped real Compose comparison accepts safe raw bytes and rejects changed interpolation dependencies',t=>{
 const dir=mkdtempSync(resolve('.superpowers/sdd/2026-11-07-ninda-v31-electronic-contracts/compose-guard-fix1-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));mkdirSync(join(dir,'deploy'));
 writeFileSync(join(dir,'deploy/compose.production.yml'),readFileSync(resolve('deploy/ninda/compose.production.yml')));
 const source=readFileSync(resolve('deploy/ninda/activate-mvp-release.sh'),'utf8');const start=source.indexOf('    if scoped:\n        # dotenv decoding');const end=source.indexOf("    root=pathlib.Path(sys.argv[4])",start);assert.ok(start>0&&end>start);
 const block=source.slice(start,end).split('\n').map(line=>line.slice(4)).join('\n');
 const base={...scopedBefore,POSTGRES_PASSWORD:'a'.repeat(64),BUILD_VERSION:'old',API_IMAGE:'ninda-api:old'};const oldPath=join(dir,'.env.production'),candidatePath=join(dir,'.env.candidate-test');
 const python=process.platform==='win32'?'C:/Program Files/Python312/python.exe':'python3';
 for(const dynamic of [false,true]){
  const raw=Object.entries(base).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+"\nLITERAL='synthetic-$TASK11C_UNDEFINED_TOKEN-合成'\n"+(dynamic?'REFERENCE="${BUILD_VERSION}"\n':'');
  writeFileSync(oldPath,raw);writeFileSync(candidatePath,candidateHelpers.buildScopedVirtualCandidateEnv(raw,'synthetic-release'));
  const newValues=buildScopedVirtualCandidate({...base,LITERAL:'synthetic-$TASK11C_UNDEFINED_TOKEN-合成',...(dynamic?{REFERENCE:'${BUILD_VERSION}'}:{})},'synthetic-release');
  const script='import json,pathlib,subprocess,sys\nscoped=True\nnew=json.loads('+JSON.stringify(JSON.stringify(newValues))+')\nchange=set('+JSON.stringify([...Object.keys(scopedVirtualChanges),'BUILD_VERSION','API_IMAGE'])+')\n'+block;
  const result=spawnSync(python,['-c',script,oldPath,candidatePath],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}});
  if(dynamic)assert.notEqual(result.status,0,'consumer interpolation dependency must fail');else assert.equal(result.status,0,result.stderr);
 }
});
