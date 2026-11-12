// Local synthetic browser fixture only. No API proxy, database, SMS or provider access.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
const root=resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const requests=[];let logged=false,verified=false,selected=false;
const documents=['terms','privacy','owner-identity','owner-auto-sign','owner-rental-contract'].map((type,i)=>({id:type==='owner-rental-contract'?'qa-template':`qa-doc-${i}`,type,version:1,title:`合成验收 · ${type}`,content:'这是本地合成测试文案，不构成真实协议，也不调用短信或法大大。',contentHash:'a'.repeat(64)}));
const session={customer:{id:'qa-customer',maskedMobile:'138****0000'},csrfToken:'qa-only',expiresAt:'2099-01-01T00:00:00Z'};
const detail=()=>({id:'qa-owner',name:'合成验收企业（非真实主体）',creditCode:'QA0000000000000000',address:'本地合成资料',status:verified?'VERIFIED':'DRAFT',revision:1,memberStatus:verified?'VERIFIED':'INVITED',realNameStatus:verified?'VERIFIED':'NOT_STARTED',certStatus:verified?'BOUND':'UNKNOWN',readyForSigning:verified&&selected,autoSigningEnabled:false,authorizationEntryEnabled:true,autoSigningExecutionEnabled:false,seals:verified?[{id:'qa-seal',status:selected?'ACTIVE':'DISCOVERED',checkedAt:'2026-10-20T00:00:00Z',imageHash:'a'.repeat(64)}]:[],legalRepresentative:{name:'合成法人',maskedMobile:'138****0000'},capabilities:{canStartVerification:!verified,canRefreshVerification:verified,canSelectSeal:verified,canRequestAuthority:verified&&selected,canManageAuthority:verified,canEnableAuthority:false},blockers:verified?[]:['请由法人本人同意认证文案并办理认证。']});
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(path==='/__qa/status'){json({mode:'local-synthetic-no-provider',requests});return;}
 if(path.startsWith('/owner/api')){
  const route=path.replace('/owner/api','');let body={};if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;try{body=JSON.parse(raw);}catch{json({error:{code:'BAD_INPUT',message:'合成请求格式错误'}},400);return;}}
  requests.push({method:req.method,route,...(req.method==='POST'?{csrf:!!req.headers['x-csrf-token'],consentCount:body.consents?.length,scope:body.scope?{vehicleCount:body.scope.vehicleIds.length,minMonthlyFeeAmount:body.scope.minMonthlyFeeAmount,maxMonthlyFeeAmount:body.scope.maxMonthlyFeeAmount}:undefined}:{})});
  if(route==='/config')json({enabled:true,mode:'OWNER_LEGAL_H5',entryUrl:'http://127.0.0.1:3103/owner/'});
  else if(route==='/legal')json({documents});
  else if(route==='/auth/me')json(logged?session:{error:{code:'SESSION_REQUIRED',message:'请先登录'}},logged?200:401);
  else if(route==='/auth/sms/request')json({accepted:true});
  else if(route==='/auth/login'){logged=true;json(session);}
  else if(route==='/auth/logout'){logged=false;json({success:true});}
  else if(!logged)json({error:{code:'SESSION_REQUIRED',message:'请先登录'}},401);
  else if(route==='/owners')json([{ownerId:'qa-owner',name:detail().name,status:detail().status,memberStatus:detail().memberStatus}]);
  else if(route==='/owners/qa-owner')json(detail());
  else if(route==='/owners/qa-owner/verification'){verified=true;json({status:'VERIFIED'});}
  else if(route==='/owners/qa-owner/refresh')json(detail());
  else if(route==='/owners/qa-owner/seal'){selected=true;json(detail());}
  else if(route==='/owners/qa-owner/seals/qa-seal/image')json({imageType:'png',imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlGMAAAAASUVORK5CYII='});
  else if(route==='/owners/qa-owner/authority-options')json({vehicles:[{vehicleId:'qa-vehicle',vehicle:{title:'合成车辆 · 仅本地验收'}}],template:{id:'qa-template',version:1,hash:'a'.repeat(64),title:'合成合同模板'}});
  else if(route==='/owners/qa-owner/authorities'&&req.method==='GET')json([]);
  else if(route==='/owners/qa-owner/authorities')json({error:{code:'QA_NO_PROVIDER',message:'合成验收已接收范围。未调用任何真实授权或签章服务。'}},409);
  else json({error:{code:'NOT_FOUND',message:'本地合成验收未提供此接口'}},404);
  return;
 }
 const relative=['/owner/','/owner/return/','/owner'].includes(path)?'owner.html':path==='/miniapp-sign/'?'index.html':path.replace(/^\/(?:owner|miniapp-sign)\//,'');
 const target=resolve(root,relative);if(!target.startsWith(root+sep)){res.writeHead(404);res.end();return;}
 try{const data=await readFile(target);const type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png'}[extname(target)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end();}
});
server.listen(3103,'127.0.0.1',()=>console.log('Owner H5 synthetic fixture available at http://127.0.0.1:3103/owner/'));
