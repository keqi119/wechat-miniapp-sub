import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(resolve('apps/api/package.json'));
const env=require('dotenv').parse(readFileSync('.runtime/production/.env.production'));
const manifestPath='docs/legal/technical-signing-approval-manifest.json';
const manifest=JSON.parse(readFileSync(manifestPath));
const release=process.argv[2],sha=b=>createHash('sha256').update(b).digest('hex');
if(!release||!/^20261016-technical-signing-v[1-9][0-9]*$/.test(release))throw Error('Specify the verified technical signing release');
if(manifest.status!=='APPROVED'||manifest.documents.length!==1||manifest.customerSignatureAuthorizedByTemplateApproval!==false||manifest.enterpriseSealUseAuthorizedByTemplateApproval!==false)throw Error('Explicit template approval and signing boundary required');
const input=manifest.documents[0],content=readFileSync(input.finalFile,'utf8');
if(input.type!=='technical-signing-verification'||input.version!==1||sha(readFileSync(input.approvedSource))!==input.approvedSourceSha256||sha(Buffer.from(content))!==input.finalSha256)throw Error('Approved text changed');
let cookie='',csrf='';
async function call(path,method='GET',body){
 const response=await fetch('https://mini-api.subauto.keybox.cloud/api'+path,{method,headers:{Origin:env.ADMIN_ORIGIN,...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
 const result=await response.json();
 if(!response.ok)throw Error('Template publication '+response.status+' '+(result.error?.code||result.code||'UNKNOWN'));
 return result;
}
try{
 if((await call('/health')).version!==release)throw Error('Deploy verified technical release first');
 csrf=(await call('/admin/auth/login','POST',{username:env.BOOTSTRAP_ADMIN_USERNAME,password:env.BOOTSTRAP_ADMIN_PASSWORD})).csrfToken;
 const existing=(await call('/admin/legal-documents?pageSize=100')).items.filter(item=>item.type===input.type&&item.version===input.version);
 if(existing.length>1)throw Error('Duplicate legal version');
 let doc=existing[0];
 if(doc&&doc.content!==content)throw Error('Existing legal version differs');
 if(!doc)doc=await call('/admin/legal-documents','POST',{type:input.type,version:input.version,title:'纯电主义电子签署流程验证确认书',content,confirmedBy:manifest.approvedBy,confirmedAt:manifest.recordedAt});
 if(doc.status==='DRAFT')doc=await call('/admin/legal-documents/'+doc.id+'/publish','POST',{});
 if(doc.status!=='PUBLISHED')throw Error('Legal text is not published');
 const visible=await call('/public/legal/'+input.type);
 if(visible.id!==doc.id||visible.content!==content)throw Error('Published content mismatch');
 const evidencePath='docs/evidence/technical-signing-legal-publication.json';
 writeFileSync(evidencePath,JSON.stringify({checkedAt:new Date().toISOString(),release,type:input.type,version:input.version,id:doc.id,sha256:input.finalSha256,publishedAt:doc.publishedAt,customerAgreementImplied:false,actualSignatureCreated:false,enterpriseSealUseApproved:false},null,2)+'\n');
 manifest.published=true;manifest.publicationEvidence=evidencePath;
 writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({published:input.type,verified:true,actualSignatureCreated:false}));
}finally{if(csrf)await call('/admin/auth/logout','POST',{}).catch(()=>{});}
