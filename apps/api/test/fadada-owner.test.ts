import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {FadadaOwnerClient} from '../src/owner-signing/fadada-owner.client';
import {FadadaHttpClient} from '../src/esign/fadada/fadada-http-client';
import {MINIAPP_PROVIDER_API,MINIAPP_RETURN} from '../src/esign/native-signing';

const config:any={enabled:true,appId:'syntheticApp',appSecret:'syntheticSecret',baseUrl:MINIAPP_PROVIDER_API,apiVersion:'2.0',requestTimeoutMs:1000};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF4kAAAAASUVORK5CYII=';
const company={customerId:'OwnerAccountA',serialNo:'VerifyOwnerA',name:'测试甲公司',creditCode:'TEST00000000000001'};
const verified=()=>({code:1,data:{transactionNo:company.serialNo,type:'2',company:{companyName:company.name,organization:company.creditCode,organizationType:'0',status:'4'},manager:{type:'1',status:'2',personName:'测试人',mobile:'13900000000',idCard:'syntheticId'}},msg:'success'});
const grant={customerId:company.customerId,contractId:'GrantA',transactionId:'GrantTxA'};
test('enterprise certificate requires a current real-name certificate and rejects wrong account evidence',async()=>{
 const data={customerId:company.customerId,sequenceNo:'CertA',dn:'CN=synthetic',certType:'0',startTime:'20200101000000',endTime:'20990101000000'};
 assert.equal((await harness({code:1,data}).client.queryCertificate(company.customerId)).bound,true);
 for(const patch of [{certType:'1'},{endTime:'20200101000000'},{sequenceNo:undefined},{startTime:undefined}])assert.equal((await harness({code:1,data:{...data,...patch}}).client.queryCertificate(company.customerId)).bound,false);
 await assert.rejects(harness({code:1,data:{...data,customerId:'OtherAccount'}}).client.queryCertificate(company.customerId));
});
function harness(response:any){const requests:any[]=[];const client=new FadadaOwnerClient(config,new FadadaHttpClient(config,async req=>{requests.push({url:req.url,params:Object.fromEntries(new URLSearchParams(String(req.body)))});return{status:200,headers:{},bodyText:JSON.stringify(response)};}));return{client,requests};}
function digest(app:string,secret:string,time:string,params:Record<string,string>,transaction?:string){const upper=(kind:string,v:string)=>createHash(kind).update(v).digest('hex').toUpperCase();const values=transaction?params.customer_id:Object.keys(params).filter(k=>!['app_id','v','timestamp','msg_digest','m_verified_way'].includes(k)).sort().map(k=>params[k]).join('');return Buffer.from(upper('sha1',app+upper('md5',(transaction||'')+time)+upper('sha1',secret+values))).toString('base64');}

test('enterprise registration uses stable enterprise open_id and never personal account type',async()=>{
 const {client,requests}=harness({code:1,data:company.customerId});assert.equal((await client.registerEnterprise('OwnerLocalA')).customerId,company.customerId);
 assert.equal(requests[0].params.account_type,'2');assert.equal(requests[0].params.open_id,'OwnerLocalA');
 await assert.rejects(client.registerEnterprise('bad:open/id'));assert.equal(requests.length,1);
});
test('provider failure cannot register an account from misleading data',async()=>{await assert.rejects(harness({code:1004,data:'bad',msg:'private text must not leak'}).client.registerEnterprise('OwnerLocalA'),e=>!String(e).includes('private text'));});
test('company verification signs every business field except m_verified_way and binds native return',async()=>{
 const {client,requests}=harness({code:1,data:{transactionNo:company.serialNo,url:Buffer.from('https://realnameverify.fadada.com/verify?a=1').toString('base64')}});
 const result=await client.createVerification(company);const p=requests[0].params;
 assert.equal(p.is_mini_program,'3');assert.equal(p.cert_flag,'1');assert.equal(p.organization_type,'0');assert.equal(p.return_url,MINIAPP_RETURN);assert.equal(p.m_verified_way,'0');
 assert.deepEqual(JSON.parse(p.company_info),{company_name:company.name,credit_no:company.creditCode});
 assert.equal(p.msg_digest,digest(config.appId,config.appSecret,p.timestamp,p));assert.equal(result.url,'https://realnameverify16.fadada.com/verify?a=1');assert.equal(result.serialNo,company.serialNo);
});
test('company verification rejects a foreign URL and missing verification transaction',async()=>{
 for(const data of [{transactionNo:'v',url:Buffer.from('https://evil.example/verify').toString('base64')},{url:Buffer.from('https://realnameverify16.fadada.com/verify').toString('base64')}])await assert.rejects(harness({code:1,data}).client.createVerification(company));
});
test('only final enterprise and manager certification can be ready; provisional review is pending',async()=>{
 const r=await harness(verified()).client.queryEnterprise(company);assert.equal(r.verified,true);assert.equal(r.customerId,company.customerId);assert.equal(r.manager?.mobile,'13900000000');assert.equal('raw' in r,false);
 for(const status of ['0','1','2','3','5','6','unexpected']){const body=verified();body.data.company.status=status;assert.equal((await harness(body).client.queryEnterprise(company)).verified,false);}
 const body=verified();body.data.manager.status='3';assert.equal((await harness(body).client.queryEnterprise(company)).verified,false);
});
test('wrong organization, credit code, verification transaction or account cannot verify owner',async()=>{
 const bodies=[verified(),verified(),verified(),verified()];bodies[0].data.company.companyName='测试乙公司';bodies[1].data.company.organization='TEST00000000000002';bodies[2].data.transactionNo='OtherTx';(bodies[3].data as any).customer_id='OtherAccount';
 for(const body of bodies)await assert.rejects(harness(body).client.queryEnterprise(company));
});
test('personal or missing nested company status cannot be mistaken for enterprise certification',async()=>{
 const person:any=verified();person.data.type='1';await assert.rejects(harness(person).client.queryEnterprise(company));
 const missing:any=verified();delete missing.data.company.status;missing.data.status='4';assert.equal((await harness(missing).client.queryEnterprise(company)).verified,false);
});
test('seal query only accepts enterprise stamps returned for requested owner and rejects duplicate ids',async()=>{
 const seal={signature_id:'SealA',signature_type:2,signature_scope:1,signature_source:0,signature_img_base64:png};
 const result=await harness({code:1,data:[seal]}).client.querySeals(company.customerId);assert.equal(result[0].signatureId,'SealA');assert.equal(result[0].customerId,company.customerId);assert.match(result[0].imageHash,/^[a-f0-9]{64}$/);
 for(const data of [[{...seal,signature_type:1}],[seal,seal],[{...seal,customer_id:'OtherAccount'}],[{...seal,signature_img_base64:Buffer.from('<svg/>').toString('base64')}]])await assert.rejects(harness({code:1,data}).client.querySeals(company.customerId));
});
test('code success with no authorization, wrong authorization type or unknown status is never authorized',async()=>{
 for(const data of [{status:0},{status:1,authType:2,contractId:'GrantA',transactionNo:'GrantTxA'},{status:2},{},{status:null}])assert.equal((await harness({code:1,data}).client.queryAuthorization(grant)).authorized,false);
});
test('authorization must match the saved grant document and transaction, not another earlier grant',async()=>{
 const data={status:1,authType:1,contractId:'GrantA',transactionNo:'GrantTxA'};assert.equal((await harness({code:1,data}).client.queryAuthorization(grant)).authorized,true);
 for(const patch of [{contractId:'OtherGrant'},{transactionNo:'OtherTx'},{transactionNo:undefined},{customer_id:'OtherAccount'},{transactionId:'OtherTx'}])await assert.rejects(harness({code:1,data:{...data,...patch}}).client.queryAuthorization(grant));
});
test('authorization URL includes exact company/seal/grant and does not make HTTP call or authorize itself',()=>{
 const {client,requests}=harness({});const result=client.createAuthorizationUrl({...grant,signatureId:'SealA'});const u=new URL(result.url),p=Object.fromEntries(u.searchParams);
 assert.equal(u.pathname,'/api2/before_authsign.api');assert.equal(p.customer_id,company.customerId);assert.equal(p.signature_id,'SealA');assert.equal(p.contract_id,'GrantA');assert.equal(p.auth_type,'1');assert.equal(p.open_environment,'4');assert.equal(p.return_url,MINIAPP_RETURN);assert.equal(p.msg_digest,digest(config.appId,config.appSecret,p.timestamp,p,p.transaction_id));assert.equal(requests.length,0);assert.equal('authorized' in result,false);
});
test('owner manual sign binds the correct enterprise seal and coordinates without auto-signing',()=>{
 const {client,requests}=harness({});const result=client.createManualSignUrl({customerId:company.customerId,signatureId:'SealA',contractId:'ContractA',transactionId:'OwnerSignA',title:'测试订阅合同',positions:[{pagenum:2,x:200,y:700}]});const u=new URL(result.url),p=Object.fromEntries(u.searchParams);
 assert.equal(u.pathname,'/api2/extsign.api');assert.equal(p.signature_id,'SealA');assert.equal(p.customer_id,company.customerId);assert.deepEqual(JSON.parse(p.signature_positions),[{pagenum:2,x:200,y:700}]);assert.equal(p.open_environment,'4');assert.equal(p.msg_digest,digest(config.appId,config.appSecret,p.timestamp,p,p.transaction_id));assert.equal(requests.length,0);
 for(const positions of [[],[{pagenum:-1,x:0,y:0}],[{pagenum:0,x:NaN,y:0}],[{pagenum:0,x:900,y:0}]])assert.throws(()=>client.createManualSignUrl({customerId:'a',signatureId:'s',contractId:'c',transactionId:'t',title:'合同',positions}));
});
test('disabled integration or unapproved provider endpoint cannot issue requests or usable signing links',async()=>{
 for(const patch of [{enabled:false},{baseUrl:'https://evil.example/api2/'},{baseUrl:'http://textapi17.fadada.com/api2/'}]){
  let calls=0;const c={...config,...patch},client=new FadadaOwnerClient(c,new FadadaHttpClient(c,async()=>{calls++;throw Error('network');}));
  await assert.rejects(client.registerEnterprise('OwnerLocalA'));assert.throws(()=>client.createAuthorizationUrl({...grant,signatureId:'SealA'}));assert.equal(calls,0);
 }
});
test('default owner transport forbids redirects of signed enterprise parameters',async()=>{
 const original=globalThis.fetch;let redirect:unknown;
 globalThis.fetch=async(_url,init)=>{redirect=init?.redirect;return new Response(JSON.stringify({code:1,data:'OwnerAccountA'}),{status:200});};
 try{assert.equal((await new FadadaOwnerClient(config).registerEnterprise('OwnerLocalA')).customerId,'OwnerAccountA');assert.equal(redirect,'error');}finally{globalThis.fetch=original;}
});
