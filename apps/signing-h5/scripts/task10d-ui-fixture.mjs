import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const fixture=JSON.parse(readFileSync('../../.runtime/task10d-ui-source.json','utf8'));
const label='【本地合成夹具，不可用于真实签署】宁达企业本人长范围验证';
const session={mode:'ELECTRONIC_LEGAL',sessionBinding:'synthetic-current-session',csrfToken:'synthetic',expiresAt:new Date(Date.now()+3600000).toISOString(),viewer:{maskedMobile:'138****0000'},owners:[{ownerId:'fixture'}]};
const task={id:'task',orderId:null,kind:'COOPERATION',status:'READY',revision:2,sourceSha256:'a'.repeat(64),parties:[{role:'OWNER',mode:'MANUAL',status:'PENDING',signedAt:null},{role:'PLATFORM',mode:'MANUAL',status:'PENDING',signedAt:null}],nextAction:{kind:'SIGN',role:'OWNER'},stopStatus:'NONE',evidenceReviewStatus:'NONE',filingStatus:'PENDING',legalCompletedAt:null,archivedAt:null,finalFileAvailable:false,grant:null,frozenSources:{parties:{OWNER:{id:'fixture'},PLATFORM:{id:'platform'}}}};
function handler(req,res,next){
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 if(path.startsWith('/__qa/')){res.setHeader('Set-Cookie',`task10d_fixture=${path.endsWith('readonly')?'readonly':'legal'}; Path=/; SameSite=Lax`);res.writeHead(302,{Location:path.endsWith('readonly')?'/owner/#/owners/fixture/overview':'/owner/?purpose=legal#/legal/fixture/task'});return res.end();}
 if(!path.startsWith('/owner/api'))return next();
 const p=path.slice(10),readonly=req.headers.cookie?.includes('task10d_fixture=readonly');
 const data=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(v));};
 if(req.method==='POST')return data({error:{message:'合成版本冲突：请重新读取；未连接真实供应商'}},409);
 if(p==='/config')return data({enabled:true,mode:'PARTNER_READONLY'});
 if(['/legal','/legal-signing'].includes(p))return data({documents:['terms','privacy','owner-identity','owner-auto-sign'].map(type=>({id:type,type,version:1,title:'合成验证 '+type,content:'本地合成文案，仅供挂载验证。'}))});
 if(p==='/auth/me')return data(readonly?{...session,mode:'PARTNER_READONLY',scopes:[{ownerId:'fixture',accessVersion:1}]}:session);
 if(p==='/owners')return data([{ownerId:'fixture',name:label,accessVersion:1,subjectType:'ENTERPRISE',status:'VERIFIED'}]);
 if(p==='/owners/fixture')return data(readonly?{id:'fixture',name:label,mode:'PARTNER_READONLY',executionMode:'ELECTRONIC',accessVersion:1,status:'VERIFIED',companyAdmin:{maskedMobile:'138****0000'}}:{id:'fixture',name:label,subjectType:'ENTERPRISE',revision:1,status:'VERIFIED',legalRepresentative:{name:'合成法人',maskedMobile:'138****0000'},capabilities:{canStartVerification:false,canRefreshVerification:false,canSelectSeal:false},seals:[],readyForSigning:false,verificationDisplay:{message:'合成状态：真实身份尚未验收'}});
 if(p.endsWith('/files/source')||p.includes('/agreements/')&&p.includes('/files/')){res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'no-store'});return res.end(readFileSync(fixture.pdfPath));}
 if(p.endsWith('/electronic-documents/authorities/list'))return data({items:[]});
 if(p.endsWith('/authority-options'))return data({scopeVersion:2,authorizationMethod:'PROVIDER_AUTO_GRANT',delegates:[{id:'platform',name:'上海宁达信息科技有限公司'}],documentKinds:[],authorizationNotice:null});
 if(p.endsWith('/authorities'))return data([]);
 if(p.endsWith('/electronic-documents'))return data({items:[task],total:1,page:1,pageSize:20});
 if(p.endsWith('/electronic-documents/task'))return data(task);
 if(p.endsWith('/agreements'))return data(fixture.agreements);
 if(p.endsWith('/cooperation-vehicles'))return data({items:[],models:[],total:0,page:1,pageSize:100});
 if(p.endsWith('/revenue'))return data({totals:{partnerAmount:0,netAmount:0,receivedAmount:0,refundedAmount:0},groups:[],items:[],total:0,page:1,pageSize:20,incompleteCount:0});
 return data({error:{message:'合成夹具未实现读取 '+p}},404);
}
const server=await createServer({configFile:resolve('vite.config.ts'),mode:'owner',plugins:[{name:'synthetic-10d',configureServer(s){s.middlewares.use(handler);}}],server:{host:'127.0.0.1',port:3199,strictPort:true}});
await server.listen();console.log('SYNTHETIC_ONLY Task10d OwnerApp http://127.0.0.1:3199/__qa/legal and /__qa/readonly');
