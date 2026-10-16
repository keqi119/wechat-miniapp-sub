import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('apps/api/package.json'));
const env = require('dotenv').parse(readFileSync('.runtime/production/.env.production'));
const manifest = JSON.parse(readFileSync('docs/legal/approval-manifest.json', 'utf8'));
if (manifest.status !== 'APPROVED') throw new Error('Formal legal approval is required');
const content = file => {
  const bytes = readFileSync(`docs/legal/${file}`);
  const expected = manifest.approvedFiles.find(item => item.file === file);
  if (!expected || createHash('sha256').update(bytes).digest('hex') !== expected.finalSha256) throw new Error('Approved text has changed');
  return bytes.toString('utf8');
};
const docs = [
  ['terms','纯电主义小程序用户协议',content('user-agreement.md')],
  ['privacy','纯电主义小程序隐私政策',content('privacy-policy.md')],
  ['application','纯电主义订阅申请须知',content('application-notice.md')],
  ['subscription','纯电主义汽车订阅服务合同及最终方案附件',content('subscription-contract.md')+'\n\n'+content('commercial-schedule.md')],
  ['handover','车辆交接确认单',content('handover-record.md')],
];
const base = 'https://mini-api.subauto.keybox.cloud/api';
let cookie = '', csrf = '';
async function call(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { Origin: env.ADMIN_ORIGIN, ...(cookie ? {Cookie:cookie} : {}), ...(csrf ? {'X-CSRF-Token':csrf} : {}), ...(body ? {'Content-Type':'application/json'} : {}) }, ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(20000), redirect:'error' });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  const result = await response.json();
  if (!response.ok) throw new Error(`Legal publication failed: ${response.status} ${result.error?.code || 'UNKNOWN'}`);
  return result;
}
try {
  const session = await call('/admin/auth/login','POST',{username:env.BOOTSTRAP_ADMIN_USERNAME,password:env.BOOTSTRAP_ADMIN_PASSWORD});
  csrf = session.csrfToken;
  const evidence = [];
  for (const [type,title,text] of docs) {
    const existing = (await call('/admin/legal-documents?pageSize=100')).items.filter(doc => doc.type===type && doc.version===1);
    if (existing.length > 1) throw new Error('Duplicate legal version');
    let doc = existing[0];
    if (doc && doc.content !== text) throw new Error(`Version 1 conflicts: ${type}`);
    if (!doc) doc = await call('/admin/legal-documents','POST',{type,title,version:1,content:text,confirmedBy:manifest.approvedBy,confirmedAt:manifest.approvedAt});
    if (doc.status === 'DRAFT') doc = await call(`/admin/legal-documents/${doc.id}/publish`,'POST',{});
    if (doc.status !== 'PUBLISHED') throw new Error(`Legal version is not published: ${type}`);
    const publicDoc = await call(`/public/legal/${type}`);
    if (publicDoc.id !== doc.id || publicDoc.content !== text) throw new Error(`Public legal mismatch: ${type}`);
    evidence.push({type,version:1,id:doc.id,sha256:createHash('sha256').update(text).digest('hex'),publishedAt:doc.publishedAt});
  }
  writeFileSync('docs/evidence/legal-publication.json',JSON.stringify({checkedAt:new Date().toISOString(),documents:evidence},null,2)+'\n');
  console.log(JSON.stringify({publishedTypes:evidence.map(row=>row.type),verified:true}));
} catch(error) { console.error(error.message); process.exitCode=1; }
finally { if (csrf) await call('/admin/auth/logout','POST',{}).catch(()=>{}); }
