import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ElectronicProvider,electronicTransport} from '../src/electronic-documents/provider';
import {recordFadadaQuery} from '../src/esign/fadada-query-binding';
const pdf=Buffer.from('%PDF-1.7\n'+('synthetic source '.repeat(10))+'\n%%EOF'),hash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
const document={providerContractId:'NDDocument123',sourceSha256:hash(pdf),title:'合成三方协议',positions:{CUSTOMER:[{pagenum:0,x:80,y:600}],OWNER:[{pagenum:0,x:250,y:600}],PLATFORM:[{pagenum:0,x:420,y:600}]}},party={role:'OWNER' as const,subjectType:'ENTERPRISE' as const,providerCustomerId:'OwnerAccount',signatureId:'OwnerSeal',transactionId:'OwnerTransaction'};
const config:any={enabled:true,signingEnabled:true,baseUrl:'https://textapi17.fadada.com/api2/',appId:'synthetic',appSecret:'synthetic-secret',apiVersion:'2.0',requestTimeoutMs:1000,signUrlValidityMinutes:15};
async function flags(fn:()=>Promise<void>){const values={ELECTRONIC_SIGNING_ENABLED:'true',ESIGN_NEW_REQUESTS_ENABLED:'true',PLATFORM_API_ORIGIN:'https://api.evsub.ndacar.com',H5_SIGNING_ORIGIN:'https://app.evsub.ndacar.com'};const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);try{await fn();}finally{for(const[k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}}
function harness(){let result:any={code:'1000',result:'success'},status=0,binary=pdf,sign:any={code:'1',data:{result:'3000'}},redirect=false;const requests:any[]=[];
 const transport:any=async(req:any)=>{requests.push(req);const body=req.responseType==='arraybuffer'?{bodyBuffer:binary}:req.url.endsWith('query_sign_result.api')?{bodyText:JSON.stringify(sign)}:req.url.endsWith('contract_status.api')?{bodyText:JSON.stringify({...result,contract_status:status})}:{bodyText:JSON.stringify(result)};return{status:redirect?302:200,headers:{'content-type':'application/pdf'},...body};};
 return{provider:new ElectronicProvider(config,transport),requests,setResult:(v:any)=>result=v,setStatus:(v:number)=>status=v,setPdf:(v:Buffer)=>binary=v,setSign:(v:any)=>sign=v,setRedirect:()=>redirect=true};
}
test('upload and filing require explicit provider success and bind the actual contract',async()=>flags(async()=>{
 const f=harness();await f.provider.upload(document,pdf);await f.provider.fileContract(document);
 for(const raw of [{code:'1000'},{code:'2002',result:'success'},{code:'1000',result:'success',contract_id:'other'}]){f.setResult(raw);await assert.rejects(f.provider.upload(document,pdf));await assert.rejects(f.provider.fileContract(document));}
 f.setResult({code:'1000',result:'success'});await assert.rejects(f.provider.upload(document,Buffer.from('not source')));assert.ok(f.requests[0].url.endsWith('/uploaddocs.api'));
}));
test('signed status needs the exact signed query receipt; generic success and contradictory identities cannot complete a party',async()=>flags(async()=>{
 const f=harness();assert.equal((await f.provider.querySigner(document,party)).status,'SIGNED');f.setSign({code:'1000',result:'success'});await assert.rejects(f.provider.querySigner(document,party));f.setSign({code:'1',data:{result:'3000',customer_id:'Another'}});await assert.rejects(f.provider.querySigner(document,party));
 f.setSign({code:1201,msg:'签署记录为空',data:null});assert.equal((await f.provider.querySigner(document,party)).status,'ABSENT');
}));
test('an unknown upload is recovered only by original bytes; pre-filing status never proves all signatures or filing',async()=>flags(async()=>{
 const f=harness();assert.equal((await f.provider.queryUpload(document)).uploaded,true);assert.equal((await f.provider.queryFiling(document)).filed,false);f.setPdf(Buffer.from('%PDF-1.7\nchanged'+('x'.repeat(100))));await assert.rejects(f.provider.queryUpload(document));f.setStatus(2);assert.equal((await f.provider.queryFiling(document)).filed,true);await assert.rejects(f.provider.queryUpload(document));
}));
test('manual page fixes actual company seal, Ningda callback, role coordinates and proper surface, without provider request',async()=>flags(async()=>{
 const f=harness(),url=new URL((await f.provider.manualUrl(document,party,'OWNER_H5')).url);
 assert.equal(url.searchParams.get('signature_id'),'OwnerSeal');assert.equal(url.searchParams.get('customer_id'),'OwnerAccount');assert.equal(url.searchParams.get('transaction_id'),'OwnerTransaction');assert.equal(url.searchParams.get('notify_url'),'https://api.evsub.ndacar.com/api/callbacks/fadada-electronic-sign');assert.equal(url.searchParams.get('return_url'),'https://app.evsub.ndacar.com/owner/return/');assert.equal(url.searchParams.get('open_environment'),'0');assert.equal(f.requests.length,0);
 const personal=new URL((await f.provider.manualUrl(document,{...party,role:'CUSTOMER',subjectType:'INDIVIDUAL',signatureId:undefined},'MINIAPP')).url);assert.equal(personal.searchParams.has('signature_id'),false);assert.equal(personal.searchParams.get('open_environment'),'4');
 await assert.rejects(f.provider.manualUrl(document,{...party,signatureId:undefined},'OWNER_H5'));await assert.rejects(f.provider.manualUrl(document,party,'MINIAPP'));
}));
test('auto acceptance is not a signature, and final PDF must differ from source',async()=>flags(async()=>{
 const f=harness();const accepted=await f.provider.autoSign(document,party);assert.equal('signed' in accepted,false);await assert.rejects(f.provider.downloadFinal(document));f.setPdf(Buffer.from('%PDF-1.7\nSigned synthetic '+('s'.repeat(100))+'\n%%EOF'));assert.notEqual((await f.provider.downloadFinal(document)).sha256,document.sourceSha256);
}));
test('fixed channel and mutation gate apply to all calls; default transport rejects redirects',async()=>flags(async()=>{
 const f=harness();process.env.ELECTRONIC_SIGNING_ENABLED='false';await assert.rejects(f.provider.upload(document,pdf));assert.equal(f.requests.length,0);process.env.ELECTRONIC_SIGNING_ENABLED='true';const foreign=new ElectronicProvider({...config,baseUrl:'https://foreign.invalid/'},async()=>{throw new Error('must not dispatch');});await assert.rejects(foreign.querySigner(document,party));
 const fetchOld=globalThis.fetch;let options:any;globalThis.fetch=async(_url:any,init:any)=>{options=init;return new Response('redirect',{status:302});};try{await assert.rejects(electronicTransport({url:config.baseUrl+'contract_status.api',method:'POST',headers:{},body:'synthetic',timeoutMs:1000} as any));assert.equal(options.redirect,'error');}finally{globalThis.fetch=fetchOld;}
}));
