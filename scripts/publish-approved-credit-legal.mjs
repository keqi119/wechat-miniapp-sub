import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require=createRequire(resolve('apps/api/package.json'));
const env=require('dotenv').parse(readFileSync('.runtime/production/.env.production'));
const manifest=JSON.parse(readFileSync('docs/legal/credit-approval-manifest.json','utf8'));
if(manifest.status!=='APPROVED')throw new Error('Credit notice approval required');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const titles={'credit-verification':'人工核验芝麻分及押金规则说明',privacy:'纯电主义小程序隐私政策',application:'纯电主义订阅申请须知'};
const documents=manifest.documents.map(doc=>{
 const source=readFileSync(doc.approvedSource),bytes=readFileSync(doc.finalFile);
 if(sha(source)!==doc.approvedSourceSha256||sha(bytes)!==doc.finalSha256)throw new Error('Approved legal content changed');
 return {...doc,content:bytes.toString('utf8'),title:titles[doc.type]};
});
let cookie='',csrf='';const base='https://mini-api.subauto.keybox.cloud/api';
async function call(path,method='GET',body){
 const response=await fetch(base+path,{method,headers:{Origin:env.ADMIN_ORIGIN,...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
 const result=await response.json();if(!response.ok)throw new Error(`Legal publication ${response.status} ${result.error?.code||'UNKNOWN'}`);return result;
}
try{
 if((await call('/health')).version!=='20261016-credit-v1')throw new Error('Deploy validated credit release before publishing');
 csrf=(await call('/admin/auth/login','POST',{username:env.BOOTSTRAP_ADMIN_USERNAME,password:env.BOOTSTRAP_ADMIN_PASSWORD})).csrfToken;
 const evidence=[];
 for(const input of documents){
  const existing=(await call('/admin/legal-documents?pageSize=100')).items.filter(doc=>doc.type===input.type&&doc.version===input.version);
  if(existing.length>1)throw new Error('Duplicate legal version');let doc=existing[0];
  if(doc&&doc.content!==input.content)throw new Error('Existing version differs from approved text');
  if(!doc)doc=await call('/admin/legal-documents','POST',{type:input.type,version:input.version,title:input.title,content:input.content,confirmedBy:manifest.approvedBy,confirmedAt:manifest.recordedAt});
  if(doc.status==='DRAFT')doc=await call(`/admin/legal-documents/${doc.id}/publish`,'POST',{});
  if(doc.status!=='PUBLISHED')throw new Error('Legal version is not published');
  const visible=await call(`/public/legal/${input.type}`);
  if(visible.id!==doc.id||visible.content!==input.content)throw new Error('Published legal text mismatch');
  evidence.push({type:input.type,version:input.version,id:doc.id,sha256:input.finalSha256,publishedAt:doc.publishedAt});
 }
 writeFileSync('docs/evidence/credit-legal-publication.json',JSON.stringify({checkedAt:new Date().toISOString(),documents:evidence,wechatPrivacyGuideUpdated:false,customerConsentImplied:false},null,2)+'\n');
 console.log(JSON.stringify({publishedTypes:evidence.map(doc=>doc.type),verified:true,customerConsentImplied:false}));
}finally{if(csrf)await call('/admin/auth/logout','POST',{}).catch(()=>{});}
