import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { verifyMiniappPackage } from './verify-miniapp-package.mjs';
const apiRequire = createRequire(resolve('apps/api/package.json'));
const ciRequire = createRequire(resolve('.runtime/miniapp-tools/package.json'));
const env = apiRequire('dotenv').parse(readFileSync('.env.miniapp.local'));
const mode = process.argv[2] || 'preview';
const version = process.argv[3];
if (!['preview', 'upload'].includes(mode) || (mode === 'upload' && !/^\d+\.\d+\.\d+(?:[-.][a-zA-Z0-9.-]+)?$/.test(version || ''))) throw new Error('Usage: node scripts/miniapp-ci.mjs preview | upload <version>');
const verified = verifyMiniappPackage({project:process.argv[4],expectedManifestSha:process.argv[5],expectedConfigSha:process.argv[6]});
const {projectPath,config} = verified;
if (config.appid !== 'wxa7089edf4a34a7f5' || config.setting?.urlCheck !== true) throw new Error('AppID or URL checking differs from approved production configuration');
if (!env.WECHAT_UPLOAD_PRIVATE_KEY_PATH) throw new Error('Missing private upload key path');
const ci = ciRequire('miniprogram-ci');
const project = new ci.Project({ appid: config.appid, type: 'miniProgram', projectPath, privateKeyPath: resolve(env.WECHAT_UPLOAD_PRIVATE_KEY_PATH), ignores: ['node_modules/**/*'] });
mkdirSync('.runtime/miniapp-ci', {recursive:true});
try {
  const common = { project, desc: '纯电主义独立平台：生产API联调验收版本', setting:{useProjectConfig:true}, robot:1, threads:2, onProgressUpdate:()=>{} };
  const result = mode === 'upload'
    ? await ci.upload({...common,version})
    : await ci.preview({...common,qrcodeFormat:'image',qrcodeOutputDest:resolve('.runtime/miniapp-ci/preview.png')});
  const evidence = {mode,version:version || null,checkedAt:new Date().toISOString(),appid:config.appid,projectPath,sourceManifestSha256:verified.manifestSha256,projectConfigSha256:verified.configSha256,success:true,subPackageInfo:result.subPackageInfo || []};
  writeFileSync(`docs/evidence/miniapp-ci-${mode}.json`,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
} catch(error) {
  const message = String(error.message || '').replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g,'[REDACTED]').slice(0,500);
  const evidence = {mode,checkedAt:new Date().toISOString(),success:false,code:error.code || error.errCode || null,message};
  writeFileSync(`.runtime/miniapp-ci/${mode}-error.json`,JSON.stringify(evidence,null,2)+'\n');
  console.error(JSON.stringify(evidence)); process.exitCode=1;
}
// The official compiler keeps worker processes alive after the completed CI call.
process.exit(process.exitCode || 0);
