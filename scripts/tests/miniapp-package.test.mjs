import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyMiniappPackage} from '../verify-miniapp-package.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(){const workspace=mkdtempSync(join(tmpdir(),'miniapp-frozen-'));const project=join(workspace,'.runtime/releases/verified/miniprogram');mkdirSync(join(project,'src'),{recursive:true});writeFileSync(join(project,'src/app.js'),'App({});');writeFileSync(join(project,'project.config.json'),JSON.stringify({appid:'wxa7089edf4a34a7f5',compileType:'miniprogram',miniprogramRoot:'src/',setting:{urlCheck:true}}));writeFileSync(join(project,'FILE-MANIFEST.json'),JSON.stringify({files:[{path:'src/app.js',sha256:sha('App({});')}]}));return{workspace,project,expectedManifestSha:sha(readFileSync(join(project,'FILE-MANIFEST.json'))),expectedConfigSha:sha(readFileSync(join(project,'project.config.json')))};}
function check(name,body){test(name,()=>{const f=fixture();try{body(f);}finally{rmSync(f.workspace,{recursive:true,force:true});}});}
check('frozen release validates without a default build directory',f=>assert.equal(verifyMiniappPackage(f).projectPath,f.project));
check('extra source file cannot silently enter an upload',f=>{writeFileSync(join(f.project,'src/extra.js'),'unexpected');assert.throws(()=>verifyMiniappPackage(f),/file set/i);});
check('source bytes must match frozen manifest',f=>{writeFileSync(join(f.project,'src/app.js'),'changed');assert.throws(()=>verifyMiniappPackage(f),/source hash/i);});
check('manifest and project config require external frozen hashes',f=>{assert.throws(()=>verifyMiniappPackage({...f,expectedManifestSha:undefined}),/external/i);writeFileSync(join(f.project,'project.config.json'),'{}');assert.throws(()=>verifyMiniappPackage(f),/config hash/i);});
check('duplicate manifest entries and altered compilation root are rejected',f=>{const path=join(f.project,'FILE-MANIFEST.json'),m=JSON.parse(readFileSync(path));m.files.push(m.files[0]);writeFileSync(path,JSON.stringify(m));assert.throws(()=>verifyMiniappPackage({...f,expectedManifestSha:sha(readFileSync(path))}),/duplicate/i);m.files.pop();writeFileSync(path,JSON.stringify(m));const config=join(f.project,'project.config.json'),c=JSON.parse(readFileSync(config));c.miniprogramRoot='../';writeFileSync(config,JSON.stringify(c));assert.throws(()=>verifyMiniappPackage({...f,expectedManifestSha:sha(readFileSync(path)),expectedConfigSha:sha(readFileSync(config))}),/configuration/i);});
