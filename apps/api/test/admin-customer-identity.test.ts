import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AdminController} from '../src/operations/admin';
import {encryptIdentity} from '../src/esign/fadada/fadada-safety';

const encryptionKey=Buffer.alloc(32,43).toString('base64');
const syntheticIdCardNo='110101199001010000';
const verifiedAt=new Date('2026-01-01T00:00:00.000Z');
const actor=(role='OPERATIONS')=>({admin:{id:'synthetic-staff',role,authVersion:1}});
async function environment(work:()=>Promise<void>){
 const previous={key:process.env.ESIGN_IDENTITY_ENCRYPTION_KEY,policy:process.env.CUSTOMER_IDENTITY_POLICY,fetch:globalThis.fetch};
 process.env.ESIGN_IDENTITY_ENCRYPTION_KEY=encryptionKey;process.env.CUSTOMER_IDENTITY_POLICY='PROVIDER_REQUIRED';
 let providerCalls=0;globalThis.fetch=async()=>{providerCalls++;throw Error('Admin identity reads must never call a provider');};
 try{await work();assert.equal(providerCalls,0);}finally{globalThis.fetch=previous.fetch;for(const[key,value]of [['ESIGN_IDENTITY_ENCRYPTION_KEY',previous.key],['CUSTOMER_IDENTITY_POLICY',previous.policy]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;}
}
function account(customerId='customer',changes:any={}){
 const identityCiphertext=encryptIdentity({name:'实名合成客户-'+customerId,idCardNo:syntheticIdCardNo},customerId,encryptionKey);
 return{id:'private-account-'+customerId,customerId,providerCustomerId:'private-provider-'+customerId,registrationStatus:'REGISTERED',realNameStatus:'VERIFIED',identityVersion:1,verificationSource:'QUERY',identityCiphertext,verifiedIdentityHash:createHash('sha256').update(identityCiphertext).digest('hex'),verifiedSerialNo:'private-serial',verificationTransactionNo:'private-transaction',verificationLeaseToken:null,verificationLeaseUntil:null,verifiedAt,checkedAt:verifiedAt,certStatus:'EXPIRED',certSerialNo:'private-cert',...changes};
}
function fixture(rows:any[]=[account()],ids=['customer']){
 const customers=ids.map(id=>({id,name:'资料姓名-'+id,mobile:'13800000000',openId:'private-openid',providerCustomerId:'private-customer-provider',createdAt:verifiedAt,updatedAt:verifiedAt}));
 const accountReads:any[]=[],customerReads:any[]=[],writes:any[]=[];
 const forbiddenWrite=async(input:any)=>{writes.push(input);throw Error('Read-only projection attempted a write');};
 const db:any={customer:{
  findMany:async(input:any)=>{customerReads.push(input);return customers.slice(input.skip,input.skip+input.take);},count:async()=>customers.length,
  findUnique:async({where}:any)=>customers.find(customer=>customer.id===where.id)||null,update:forbiddenWrite,updateMany:forbiddenWrite,
 },eSignAccount:{
  findMany:async(input:any)=>{accountReads.push(input);return rows.filter(row=>input.where.customerId.in.includes(row.customerId)).map(row=>input.select?Object.fromEntries(Object.keys(input.select).filter(key=>input.select[key]).map(key=>[key,row[key]])):structuredClone(row));},
  findUnique:async()=>{throw Error('Customer list must batch account reads');},create:forbiddenWrite,update:forbiddenWrite,updateMany:forbiddenWrite,
 },auditLog:{create:forbiddenWrite},providerEvent:{create:forbiddenWrite,update:forbiddenWrite}};
 return{controller:new AdminController(db),db,customers,rows,accountReads,customerReads,writes};
}
function assertPrivateFieldsAbsent(value:any,rows:any[]){
 const json=JSON.stringify(value);
 for(const sensitive of [syntheticIdCardNo,'private-provider-','private-account-','private-openid','private-customer-provider','private-serial','private-transaction','private-cert',...rows.flatMap(row=>[row.identityCiphertext,row.verifiedIdentityHash]).filter(Boolean)])assert.equal(json.includes(sensitive),false);
 for(const key of ['identityCiphertext','verifiedIdentityHash','providerCustomerId','verificationSource','snapshot'])assert.equal(json.includes('"'+key+'"'),false);
}

for(const role of ['ADMIN','OPERATIONS'])test(role+' list and detail expose only trusted, masked identity despite expired signing certificate',async()=>environment(async()=>{
 const f=fixture(),before=structuredClone(f.rows),request=actor(role);
 const list=await f.controller.list('customers',{},request),detail=await f.controller.detail('customers','customer',request);
 const expected={status:'VERIFIED',verified:true,locked:true,name:'实名合成客户-customer',maskedIdCardNo:'110101********0000',verifiedAt:verifiedAt.toISOString()};
 assert.deepEqual(list.items[0].identity,expected);assert.deepEqual(detail.identity,expected);
 assertPrivateFieldsAbsent({list,detail},f.rows);assert.deepEqual(f.rows,before);assert.deepEqual(f.writes,[]);
 assert.equal(f.accountReads.length,2);
}));

for(const [stored,expected]of [[null,'NOT_STARTED'],['NOT_STARTED','NOT_STARTED'],['STARTING','PENDING'],['PENDING','PENDING'],['FAILED','FAILED'],['EXPIRED','UNKNOWN'],['UNRECOGNISED','UNKNOWN']]as const)test('unverified '+stored+' becomes '+expected+' without personal identity fields',async()=>environment(async()=>{
 const rows=stored===null?[]:[account('customer',{realNameStatus:stored,verifiedAt:null,verifiedIdentityHash:null,identityVersion:0,verificationSource:'UNKNOWN'})],f=fixture(rows);
 for(const dto of [(await f.controller.list('customers',{},actor())).items[0],await f.controller.detail('customers','customer',actor())])assert.deepEqual(dto.identity,{status:expected,verified:false,locked:false});
 assert.deepEqual(f.writes,[]);
}));

test('claimed VERIFIED with invalid or unreadable evidence remains UNKNOWN and never exposes identity fields',async()=>environment(async()=>{
 const malformed='synthetic-unreadable-cipher';
 for(const changes of [
  {verificationSource:'FRONTEND'}, {verifiedIdentityHash:'0'.repeat(64)}, {verifiedSerialNo:null}, {registrationStatus:'PENDING'},
  {identityVersion:0}, {verifiedAt:new Date('2099-01-01T00:00:00Z')},
  {identityCiphertext:malformed,verifiedIdentityHash:createHash('sha256').update(malformed).digest('hex')},
 ]){
  const f=fixture([account('customer',changes)]);
  for(const dto of [(await f.controller.list('customers',{},actor())).items[0],await f.controller.detail('customers','customer',actor())]){
   assert.deepEqual(dto.identity,{status:'UNKNOWN',verified:false,locked:true});assertPrivateFieldsAbsent(dto,f.rows);
  }
 }
 const f=fixture();process.env.ESIGN_IDENTITY_ENCRYPTION_KEY=Buffer.alloc(32,44).toString('base64');
 assert.deepEqual((await f.controller.detail('customers','customer',actor())).identity,{status:'UNKNOWN',verified:false,locked:true});
}));

for(const name of ['   ','姓'.repeat(41)])test('bound proof with '+(name.trim()?'overlong':'blank')+' name cannot receive a verified admin identity badge',async()=>environment(async()=>{
 const identityCiphertext=encryptIdentity({name,idCardNo:syntheticIdCardNo},'customer',encryptionKey);
 const f=fixture([account('customer',{identityCiphertext,verifiedIdentityHash:createHash('sha256').update(identityCiphertext).digest('hex')})]);
 for(const dto of [(await f.controller.list('customers',{},actor())).items[0],await f.controller.detail('customers','customer',actor())])assert.deepEqual(dto.identity,{status:'UNKNOWN',verified:false,locked:true});
}));

test('manual admission policy preserves trusted historical identity and does not invent one for an unverified customer',async()=>environment(async()=>{
 process.env.CUSTOMER_IDENTITY_POLICY='MANUAL_REVIEW';const f=fixture([account('verified')],['verified','none']);
 const list=await f.controller.list('customers',{},actor());
 assert.equal(list.items[0].identity.status,'VERIFIED');assert.equal(list.items[0].identity.verified,true);
 assert.deepEqual(list.items[1].identity,{status:'NOT_STARTED',verified:false,locked:false});
 assert.equal((await f.controller.detail('customers','verified',actor())).identity.verified,true);
}));

test('retained but downgraded evidence stays locked without an unproven verified badge',async()=>environment(async()=>{
 for(const [stored,status]of [['PENDING','PENDING'],['FAILED','FAILED'],['EXPIRED','UNKNOWN'],['NOT_STARTED','UNKNOWN']]){
  const f=fixture([account('customer',{realNameStatus:stored})]);
  assert.deepEqual((await f.controller.detail('customers','customer',actor())).identity,{status,verified:false,locked:true});
 }
}));

for(const role of ['SUPPORT','FINANCE'])test(role+' retains minimal customer list/detail and never reads identity evidence',async()=>environment(async()=>{
 const f=fixture();let forbiddenReads=0;f.db.eSignAccount.findMany=async()=>{forbiddenReads++;throw Error('Role must not read identity');};
 for(const dto of [(await f.controller.list('customers',{},actor(role))).items[0],await f.controller.detail('customers','customer',actor(role))]){
  assert.deepEqual(Object.keys(dto).sort(),['id','name','mobile','createdAt','updatedAt'].sort());assert.equal(dto.mobile,'138****0000');assert.equal('identity'in dto,false);assertPrivateFieldsAbsent(dto,f.rows);
 }
 assert.equal(forbiddenReads,0);assert.deepEqual(f.accountReads,[]);assert.deepEqual(f.writes,[]);
}));

test('customer pagination batches only current-page evidence and preserves total and page metadata',async()=>environment(async()=>{
 const ids=['one','two','three','four','five'],f=fixture(ids.map(id=>account(id)),ids);
 const page=await f.controller.list('customers',{page:'2',pageSize:'2'},actor());
 assert.deepEqual(page.items.map((item:any)=>item.id),['three','four']);assert.equal(page.total,5);assert.equal(page.page,2);assert.equal(page.pageSize,2);
 assert.equal(f.accountReads.length,1);assert.deepEqual(f.accountReads[0].where.customerId.in,['three','four']);
 assert.deepEqual(page.items.map((item:any)=>item.identity.name),['实名合成客户-three','实名合成客户-four']);
 const empty=await f.controller.list('customers',{page:'9',pageSize:'2'},actor());assert.deepEqual(empty.items,[]);assert.equal(f.accountReads.length,1);assert.deepEqual(f.writes,[]);
}));

test('unavailable persisted evidence is unknown rather than a false not-started identity',async()=>environment(async()=>{
 const f=fixture();f.db.eSignAccount.findMany=async()=>{throw Error('synthetic read unavailable');};
 for(const dto of [(await f.controller.list('customers',{},actor())).items[0],await f.controller.detail('customers','customer',actor())])assert.deepEqual(dto.identity,{status:'UNKNOWN',verified:false,locked:true});
 assert.deepEqual(f.writes,[]);
}));

test('protected local HTTP list/detail enforce role projection and preserve persisted identity without provider activity',{skip:process.env.MVP_TEST_GUARD!=='local-project-v1'},async()=>{
 const {JourneyHarness}=await import('./seven-module-journey-fixtures');const h=new JourneyHarness();
 const previousPolicy=process.env.CUSTOMER_IDENTITY_POLICY;
 try{
  await h.start();process.env.ESIGN_IDENTITY_ENCRYPTION_KEY=encryptionKey;process.env.CUSTOMER_IDENTITY_POLICY='MANUAL_REVIEW';
  const who=await h.customer('admin-identity-'+h.prefix),row=account(who.id,{verificationTransactionNo:'admin-identity-'+h.prefix,verifiedSerialNo:'admin-identity-'+h.prefix});
  await h.db.eSignAccount.create({data:row});const before=await h.db.eSignAccount.findUniqueOrThrow({where:{customerId:who.id}});
  const detailPath='/admin/customers/'+who.id,listPath='/admin/customers?keyword='+encodeURIComponent('admin-identity-'+h.prefix);
  for(const staff of [h.maker,h.reviewer]){
   const list=await h.get(listPath,staff),detail=await h.get(detailPath,staff);
   assert.equal(list.items.length,1);assert.equal(list.items[0].id,who.id);assert.deepEqual(list.items[0].identity,detail.identity);
   assert.deepEqual(detail.identity,{status:'VERIFIED',verified:true,locked:true,name:'实名合成客户-'+who.id,maskedIdCardNo:'110101********0000',verifiedAt:verifiedAt.toISOString()});
   assertPrivateFieldsAbsent({list,detail},[row]);
  }
  for(const staff of [h.finance,h.support])for(const dto of [(await h.get(listPath,staff)).items[0],await h.get(detailPath,staff)])assert.equal('identity'in dto,false);
  await h.reject(detailPath,undefined,h.field,'FORBIDDEN');await h.reject(listPath,undefined,h.field,'FORBIDDEN');
  assert.deepEqual(await h.db.eSignAccount.findUniqueOrThrow({where:{customerId:who.id}}),before);
  const malformed='synthetic-unreadable-local-proof';await h.db.eSignAccount.update({where:{customerId:who.id},data:{identityCiphertext:malformed,verifiedIdentityHash:createHash('sha256').update(malformed).digest('hex')}});
  const unreadable=await h.db.eSignAccount.findUniqueOrThrow({where:{customerId:who.id}});
  assert.deepEqual((await h.get(detailPath)).identity,{status:'UNKNOWN',verified:false,locked:true});
  assert.deepEqual(await h.db.eSignAccount.findUniqueOrThrow({where:{customerId:who.id}}),unreadable);
  assert.equal(h.externalCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.payment.providerCalls,0);
 }finally{await h.close();if(previousPolicy===undefined)delete process.env.CUSTOMER_IDENTITY_POLICY;else process.env.CUSTOMER_IDENTITY_POLICY=previousPolicy;}
});
