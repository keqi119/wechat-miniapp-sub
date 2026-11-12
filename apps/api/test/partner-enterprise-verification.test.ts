import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PartnerAdminController} from '../src/partners/controller';
import {identityMaterials} from '../src/owner-signing/identity-materials';

const at=new Date('2026-01-01T00:00:00.000Z');
function evidence(id='synthetic-owner'):any{
 const owner:any={id,subjectType:'ENTERPRISE',name:'合成认证企业',creditCode:'913100000000000001',address:'合成地址',status:'VERIFIED',revision:1};
 owner.legalRepresentative={name:'合成法人',mobileHash:'private-mobile-hash',evidenceHash:'private-legal-evidence',revision:1};
 owner.esignAccount={providerCustomerId:'private-provider-'+id,verificationTransactionNo:'private-transaction-'+id,managerCustomerId:'private-manager-'+id,realNameStatus:'VERIFIED',certStatus:'EXPIRED',certSerialNo:'private-certificate',verifiedAt:at,checkedAt:at,consentedAt:at,verificationUrlCiphertext:'private-url-ciphertext',managerCiphertext:'private-manager-ciphertext',consentSnapshot:{channel:'OWNER_LEGAL_H5',ownerId:id,customerId:'private-manager-'+id,legalRevision:1,legalName:owner.legalRepresentative.name,legalMobileHash:owner.legalRepresentative.mobileHash,materials:identityMaterials(owner)}};
 owner.members=[{customerId:owner.esignAccount.managerCustomerId,status:'VERIFIED',verifiedSerialNo:owner.esignAccount.verificationTransactionNo}];
 owner.seals=[{status:'ACTIVE',providerCustomerId:owner.esignAccount.providerCustomerId,providerSignatureId:'private-signature',imageCiphertext:'private-seal-image',imageHash:'private-seal-hash',checkedAt:at,selectedAt:at}];
 return owner;
}
function scalarOwner(owner:any){const{legalRepresentative,esignAccount,members,seals,...base}=owner;return structuredClone(base);}
function select(row:any,fields:any):any{
 if(row==null)return row;
 return Object.fromEntries(Object.entries(fields).map(([key,projection]:any)=>[key,projection===true?row[key]:Array.isArray(row[key])?row[key].map((value:any)=>select(value,projection.select)):select(row[key],projection.select)]));
}
function fixture(rows=[evidence()],role='OPERATIONS'){
 const reads:any[]=[],writes:any[]=[],staff={id:'synthetic-staff',role,active:true,authVersion:1};
 const deny=async(input:any)=>{writes.push(input);throw Error('A partner display read attempted a write');};
 const model=(methods:any)=>new Proxy(methods,{get(target,key){return key in target?target[key]:deny;}});
 const db:any={adminUser:model({findUnique:async()=>staff}),vehicleOwner:model({
  findMany:async(input:any)=>{reads.push(input);const matches=rows.filter(row=>!input.where?.id?.in||input.where.id.in.includes(row.id));return matches.map(row=>input.select?select(row,input.select):scalarOwner(row));},
  findUnique:async({where}:any)=>{const row=rows.find(owner=>owner.id===where.id);return row?scalarOwner(row):null;},
 }),partnerAgreementVehicle:model({findMany:async()=>[]}),partnerAgreement:model({findMany:async()=>[],count:async()=>0}),ownerVehicle:model({findMany:async()=>[]}),auditLog:model({}),providerEvent:model({})};
 db.serial=(work:any)=>work(db);
 return{controller:new PartnerAdminController(db),request:{admin:{id:staff.id,role,authVersion:1}},reads,writes,rows,db};
}
async function displays(f:ReturnType<typeof fixture>){
 const originalFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Partner reads must not call providers');};
 try{
  const list=await f.controller.list(f.request),detail=await f.controller.detail(f.request,f.rows[0].id);
  assert.equal(calls,0);assert.deepEqual(f.writes,[]);assert.deepEqual(list[0].enterpriseVerification,detail.enterpriseVerification);
  return{list,detail,display:detail.enterpriseVerification};
 }finally{globalThis.fetch=originalFetch;}
}
function assertSafe(value:any){
 const json=JSON.stringify(value);
 for(const secret of ['private-','providerCustomerId','providerSignatureId','managerCustomerId','verificationTransactionNo','consentSnapshot','imageCiphertext','mobileHash','evidenceHash','certSerialNo'])assert.equal(json.includes(secret),false,secret);
}

for(const role of ['ADMIN','OPERATIONS'])test(role+' partner list and detail show trusted company identity independently of an expired certificate',async()=>{
 const f=fixture(undefined,role),before=structuredClone(f.rows),{list,detail,display}=await displays(f);
 assert.equal(display.identity.state,'COMPLETED');assert.equal(display.identity.complete,true);assert.equal(display.identity.companyName,'合成认证企业');assert.equal(display.identity.creditCode,'913100000000000001');assert.equal(display.identity.legalName,'合成法人');assert.equal(display.identity.verifiedAt,at.toISOString());
 assert.equal(display.certification.state,'INCOMPLETE');assert.equal(display.seal.selected,true);assert.equal(display.seal.selectedAt,at.toISOString());assert.equal(display.seal.state,'REFRESH_REQUIRED');assertSafe({list,detail});assert.deepEqual(f.rows,before);
});
test('old certificate and seal checks keep completed identity while showing refresh required',async()=>{
 const row=evidence();row.esignAccount.certStatus='BOUND';const{display}=await displays(fixture([row]));
 assert.equal(display.identity.state,'COMPLETED');assert.equal(display.certification.state,'REFRESH_REQUIRED');assert.equal(display.seal.state,'REFRESH_REQUIRED');
});
test('fresh valid current proof and selected seal are display-ready',async()=>{
 const row=evidence();row.esignAccount.certStatus='BOUND';row.esignAccount.checkedAt=new Date();row.seals[0].checkedAt=new Date();
 const{display}=await displays(fixture([row]));assert.equal(display.identity.state,'COMPLETED');assert.equal(display.certification.state,'VERIFIED');assert.equal(display.seal.state,'READY');
});
for(const[reason,dates]of [['expired',{certValidUntil:at}],['not yet valid',{certValidFrom:new Date(Date.now()+86400000)}],['unreadable dates',{certValidUntil:'invalid'}]]as const)test('explicit certificate validity '+reason+' does not revoke identity or claim signing readiness',async()=>{
 const row=evidence();Object.assign(row.esignAccount,{certStatus:'BOUND',checkedAt:new Date()},dates);row.seals[0].checkedAt=new Date();
 const{display}=await displays(fixture([row]));assert.equal(display.identity.state,'COMPLETED');assert.equal(display.certification.state,'INCOMPLETE');assert.equal(display.seal.state,'REFRESH_REQUIRED');
});
const invalidEvidence:Array<[string,(row:any)=>void]>=[
 ['provider binding missing',row=>row.esignAccount.providerCustomerId=null],
 ['verification transaction missing',row=>{row.esignAccount.verificationTransactionNo=null;row.members[0].verifiedSerialNo=null;}],
 ['verified timestamp missing',row=>row.esignAccount.verifiedAt=null],
 ['verified timestamp invalid',row=>row.esignAccount.verifiedAt='invalid'],
 ['verified timestamp future',row=>row.esignAccount.verifiedAt=new Date(Date.now()+86400000)],
 ['member proof mismatch',row=>row.members[0].verifiedSerialNo='other-transaction'],
 ['manager member absent',row=>row.members=[]],
 ['unreadable consent',row=>row.esignAccount.consentSnapshot='not-an-object'],
 ['current legal consent absent',row=>row.esignAccount.consentedAt=null],
 ['current legal mobile binding missing',row=>{row.legalRepresentative.mobileHash='';row.esignAccount.consentSnapshot.legalMobileHash='';row.esignAccount.consentSnapshot.materials=identityMaterials(row);}],
 ['current legal evidence missing',row=>{row.legalRepresentative.evidenceHash='';row.esignAccount.consentSnapshot.materials=identityMaterials(row);}],
 ['empty company name',row=>{row.name=' ';row.esignAccount.consentSnapshot.materials=identityMaterials(row);}],
 ['invalid company credit code',row=>{row.creditCode='';row.esignAccount.consentSnapshot.materials=identityMaterials(row);}],
];
for(const[reason,mutate]of invalidEvidence)test('claimed VERIFIED is UNKNOWN when '+reason,async()=>{
 const row=evidence();mutate(row);const{display}=await displays(fixture([row]));
 assert.equal(display.identity.state,'UNKNOWN');assert.equal(display.identity.complete,false);for(const key of ['companyName','creditCode','legalName','verifiedAt'])assert.equal(display.identity[key],null);assert.notEqual(display.seal.state,'READY');assertSafe(display);
});
test('registration status alone does not establish enterprise identity',async()=>{
 const row=evidence();row.esignAccount=null;row.members=[];row.seals=[];
 const{display}=await displays(fixture([row]));assert.equal(display.identity.state,'UNKNOWN');assert.equal(display.identity.complete,false);
 row.status='DRAFT';const unstarted=await displays(fixture([row]));assert.equal(unstarted.display.identity.state,'NOT_STARTED');
});
test('material changes require reauthentication and only expose safe previous names',async()=>{
 const row=evidence(),previous={...identityMaterials(row),capturedAt:at.toISOString()};row.name='合成已变更企业';row.esignAccount.realNameStatus='REAUTH_REQUIRED';row.esignAccount.consentSnapshot.materials={...identityMaterials(row),status:'REAUTH_REQUIRED',previous};
 const{display}=await displays(fixture([row]));assert.equal(display.identity.state,'REAUTH_REQUIRED');assert.equal(display.identity.complete,false);assert.equal(display.identity.companyName,null);assert.deepEqual(display.identity.previous,{companyName:'合成认证企业',legalName:'合成法人',capturedAt:at.toISOString()});assertSafe(display);
});
test('current material mismatch is REAUTH_REQUIRED even if the stored account remains VERIFIED',async()=>{
 const row=evidence();row.name='合成不同主体材料';const{display}=await displays(fixture([row]));assert.equal(display.identity.state,'REAUTH_REQUIRED');assert.equal(display.identity.complete,false);
});
for(const[stored,state]of [['PENDING','PENDING'],['VERIFY_STARTING','PROCESSING'],['VERIFY_UNKNOWN','UNKNOWN'],['FAILED','FAILED'],['UNKNOWN_STATE','UNKNOWN']]as const)test('current transaction '+stored+' has explicit display state '+state,async()=>{
 const row=evidence();row.esignAccount.realNameStatus=stored;row.members[0].status='CLAIMED';const{display}=await displays(fixture([row]));assert.equal(display.identity.state,state);assert.equal(display.identity.complete,false);assert.equal(display.identity.companyName,null);
});
test('selected seals preserve a selection fact without asserting ownership or availability',async()=>{
 const row=evidence();row.seals[0].providerCustomerId='other-private-provider';let{display}=await displays(fixture([row]));assert.equal(display.seal.selected,true);assert.equal(display.seal.state,'UNAVAILABLE');
 row.seals.push({...row.seals[0]});({display}=await displays(fixture([row])));assert.equal(display.seal.selected,false);assert.equal(display.seal.state,'UNAVAILABLE');assert.equal(display.seal.selectedAt,null);
 row.seals=[{...row.seals[0],status:'DISCOVERED'}];({display}=await displays(fixture([row])));assert.equal(display.seal.selected,false);assert.equal(display.seal.state,'NOT_SELECTED');
});
test('individual partners do not acquire enterprise authentication facts',async()=>{
 const row=evidence();row.subjectType='INDIVIDUAL';const{display}=await displays(fixture([row]));assert.equal(display.applicable,false);assert.equal(display.identity.state,'NOT_APPLICABLE');assert.equal(display.identity.complete,false);assert.equal(display.identity.companyName,null);assert.equal(display.seal.selected,false);assertSafe(display);
});
test('partner evidence is batched to list IDs and never fetched for rejected staff roles or stale sessions',async()=>{
 const f=fixture([evidence('one'),evidence('two')]);const list=await f.controller.list(f.request);assert.equal(list.length,2);assert.equal(f.reads.length,2);assert.deepEqual(f.reads[1].where.id.in,['one','two']);assert.ok(f.reads[1].select);assertSafe(list);
 for(const role of ['FINANCE','SUPPORT','FIELD']){const denied=fixture(undefined,role);for(const run of [()=>denied.controller.list(denied.request),()=>denied.controller.detail(denied.request,denied.rows[0].id)])await assert.rejects(run,(error:any)=>error.getResponse?.().error?.code==='FORBIDDEN');assert.equal(denied.reads.length,0);}
 const stale=fixture();stale.request.admin.authVersion=2;await assert.rejects(stale.controller.list(stale.request),(error:any)=>error.getResponse?.().error?.code==='STAFF_SESSION_CHANGED');assert.equal(stale.reads.length,0);
});

test('guarded real database list and detail preserve identity, membership and seal facts without writes',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.port==='55432'&&url.pathname==='/chundian_test');
 const{Db}=await import('../src/common/db');const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL}),suffix=randomUUID();let staff:any,customer:any,owner:any;
 try{
  staff=await db.adminUser.create({data:{username:'partner-display-'+suffix,name:'合成状态运营',role:'OPERATIONS',passwordHash:'synthetic'}});customer=await db.customer.create({data:{mobile:'139'+String(Date.now()).slice(-8)}});
  owner=await db.vehicleOwner.create({data:{name:'合成认证企业'+suffix,creditCode:'913100'+String(Date.now()).slice(-12),subjectType:'ENTERPRISE',address:'合成地址',status:'VERIFIED',createdBy:staff.id}});
  const profile=await db.ownerLegalRepresentative.create({data:{ownerId:owner.id,name:'合成认证法人',mobileHash:'private-mobile',maskedMobile:'139****0000',evidenceHash:'private-evidence',createdBy:staff.id,updatedBy:staff.id}});
  const providerCustomerId='private-provider-'+suffix,verificationTransactionNo='private-transaction-'+suffix;
  await db.ownerMember.create({data:{ownerId:owner.id,customerId:customer.id,status:'VERIFIED',verifiedSerialNo:verificationTransactionNo,verifiedAt:at}});
  await db.ownerESignAccount.create({data:{ownerId:owner.id,providerCustomerId,verificationTransactionNo,managerCustomerId:customer.id,realNameStatus:'VERIFIED',certStatus:'EXPIRED',certSerialNo:'private-certificate',checkedAt:at,verifiedAt:at,consentedAt:at,consentSnapshot:{channel:'OWNER_LEGAL_H5',ownerId:owner.id,customerId:customer.id,legalRevision:profile.revision,legalName:profile.name,legalMobileHash:profile.mobileHash,materials:identityMaterials({...owner,legalRepresentative:profile})}}});
  await db.ownerSeal.create({data:{ownerId:owner.id,providerCustomerId,providerSignatureId:'private-signature-'+suffix,status:'ACTIVE',imageHash:'private-image-hash',imageCiphertext:'private-image-ciphertext',checkedAt:at,selectedAt:at,selectedBy:customer.id}});
  // The shared local test database retains many unrelated historical agreement fixtures.
  // Retain real serializable reads; allow its existing global assignment projection time to finish.
  const reader=Object.create(db);reader.serial=(work:any)=>db.$transaction(work,{isolationLevel:'Serializable',timeout:60000});
  const controller=new PartnerAdminController(reader),request={admin:{id:staff.id,role:staff.role,authVersion:staff.authVersion}};
  const snapshot=()=>db.vehicleOwner.findUnique({where:{id:owner.id},include:{legalRepresentative:true,esignAccount:true,members:true,seals:true}}),before=await snapshot(),audits=await db.auditLog.count();
  const list=await controller.list(request),detail=await controller.detail(request,owner.id),summary=list.find((row:any)=>row.id===owner.id).enterpriseVerification;
  assert.deepEqual(summary,detail.enterpriseVerification);assert.equal(summary.identity.state,'COMPLETED');assert.equal(summary.identity.legalName,profile.name);assert.equal(summary.seal.selected,true);assertSafe(summary);assert.deepEqual(await snapshot(),before);assert.equal(await db.auditLog.count(),audits);
  await db.ownerESignAccount.update({where:{ownerId:owner.id},data:{realNameStatus:'REAUTH_REQUIRED'}});
  assert.equal((await controller.detail(request,owner.id)).enterpriseVerification.identity.state,'REAUTH_REQUIRED');
 }finally{
  if(owner){await db.ownerSeal.deleteMany({where:{ownerId:owner.id}});await db.ownerESignAccount.deleteMany({where:{ownerId:owner.id}});await db.ownerMember.deleteMany({where:{ownerId:owner.id}});await db.ownerLegalRepresentative.deleteMany({where:{ownerId:owner.id}});await db.vehicleOwner.delete({where:{id:owner.id}});}
  if(customer)await db.customer.delete({where:{id:customer.id}});if(staff)await db.adminUser.delete({where:{id:staff.id}});await db.$disconnect();
 }
});
