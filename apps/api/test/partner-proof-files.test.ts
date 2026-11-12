import {fileReadStore} from './file-store-fixture';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {promises as fs} from 'node:fs';
import {FilesController} from '../src/files/files';
import {projectRoot} from '../src/common/config';
import {evidenceFiles} from '../src/partners/types';
import {PartnerIdentityService} from '../src/partners/identity';
import {VehicleBindingService} from '../src/partners/vehicle-binding';

const proof=(purpose='identity')=>({id:'proof',name:'synthetic-proof.pdf',adminId:'maker',customerId:null,purpose,mimeType:'application/pdf',size:20,sha256:'a'.repeat(64),storagePath:resolve(projectRoot,'var/uploads/synthetic-partner-proof')});
const code=(value:string)=>(error:any)=>error.getResponse?.().error?.code===value;
function fileStore(file:any,source?:string,state?:string,role='OPERATIONS'){
 const zero={count:async()=>0},db:any={storedFile:{findUnique:async()=>file},paymentReconciliation:zero,customerQualificationVersion:zero,partnerIdentityBinding:zero,partnerVerification:zero,partnerVehicleBindingProposal:zero,ownerVehicle:zero,partnerVehicleBindingHistory:zero,offlineCancellationReview:zero,contract:zero,ownerSigningTask:zero,handover:zero,vehicleReceiptEvent:zero};
 if(source)db[source]={count:async({where}:any)=>where.evidenceFileId===file.id&&(!Object.hasOwn(where,'status')||where.status===state)&&(!Object.hasOwn(where,'validUntil')||where.validUntil===(state==='APPROVED'?null:'historical-end'))?1:0};
 db.adminUser={findUnique:async()=>({id:'staff',active:true,role,partnerCapabilities:role==='ADMIN'||role==='OPERATIONS'?['partner.cooperation.read']:[]})};return fileReadStore(db);
}
function response(){let streamed=false;return{res:{setHeader(){},sendFile(){streamed=true;}},streamed:()=>streamed};}

test('uploaded unbound identity originals are restricted to ADMIN/OPERATIONS before any partner submission',async t=>{
 t.mock.method(fs,'mkdir',async()=>undefined);t.mock.method(fs,'writeFile',async()=>undefined);
 const bytes=Buffer.from('%PDF-synthetic-private-proof');let stored:any=null;
 const uploadDb=fileStore(null);uploadDb.storedFile.create=async({data}:any)=>(stored={id:'uploaded-identity',...data});uploadDb.auditLog={create:async({data}:any)=>data};
 const uploaded=await new FilesController(uploadDb).adminUpload({buffer:bytes,size:bytes.length,mimetype:'application/pdf',originalname:'synthetic-proof.pdf'} as any,{admin:{id:'maker',role:'OPERATIONS'},body:{purpose:'identity'}});
 assert.equal(uploaded.id,'uploaded-identity');assert.equal(stored.purpose,'identity');assert.equal(stored.customerId,null);assert.equal(stored.adminId,'maker');
 for(const role of ['ADMIN','OPERATIONS','FINANCE','SUPPORT','FIELD']){
  const file=stored,out=response(),controller=new FilesController(fileStore(file));
  if(['ADMIN','OPERATIONS'].includes(role)){await controller.adminRead(file.id,{admin:{id:'staff',role}},out.res);assert.equal(out.streamed(),true);}
  else{await assert.rejects(controller.adminRead(file.id,{admin:{id:'staff',role}},out.res),code('CUSTOMER_FILE_PERMISSION'));assert.equal(out.streamed(),false);}
 }
 const file=stored,out=response(),zero={count:async()=>0};
 await assert.rejects(new FilesController(fileReadStore({storedFile:{findUnique:async()=>file},handover:zero,contract:zero,bill:zero}) as any).customerRead(file.id,{customer:{id:'unrelated-customer'}},out.res),code('NOT_FOUND'));
 await assert.rejects(new FilesController({storedFile:{findFirst:async({where}:any)=>where.purpose===file.purpose?file:null}} as any).media(file.id,out.res),code('NOT_FOUND'));
 assert.equal(out.streamed(),false);
});

for(const source of ['partnerVehicleBindingProposal','ownerVehicle','partnerVehicleBindingHistory'])test(`legacy ownership evidence in ${source} stays private regardless of current or historical status`,async()=>{
 for(const state of ['SUBMITTED','APPROVED','REJECTED','SUPERSEDED'])for(const role of ['FINANCE','SUPPORT','FIELD']){
  const file=proof('evidence'),out=response();
  await assert.rejects(new FilesController(fileStore(file,source,state,role)).adminRead(file.id,{admin:{id:'staff',role}},out.res),code('FORBIDDEN'));
  assert.equal(out.streamed(),false);
 }
 for(const role of ['ADMIN','OPERATIONS']){
  const file=proof('evidence'),out=response();
  await new FilesController(fileStore(file,source,'REJECTED',role)).adminRead(file.id,{admin:{id:'staff',role}},out.res);
  assert.equal(out.streamed(),true);
 }
});

test('unrelated finance and service evidence retain existing authorized generic access',async()=>{
 for(const role of ['FINANCE','SUPPORT']){
  const file=proof('evidence'),out=response();
  await new FilesController(fileStore(file)).adminRead(file.id,{admin:{id:'staff',role}},out.res);
  assert.equal(out.streamed(),true);
 }
});

test('partner proof validation accepts backend identity and legacy evidence without accepting customer or malformed material',async()=>{
 for(const purpose of ['identity','evidence']){
  const file=proof(purpose);assert.deepEqual(await evidenceFiles({vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},storedFile:{findMany:async()=>[file]}},[file.id]),[file]);
  for(const changed of [{customerId:'customer'},{adminId:null},{mimeType:'text/plain'},{sha256:'invalid'}]){
   await assert.rejects(evidenceFiles({vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},storedFile:{findMany:async()=>[{...file,...changed}]}},[file.id]),code('PARTNER_MATERIALS_REQUIRED'));
  }
 }
 for(const purpose of ['vehicle','profile','insurance','partner-settlement'])await assert.rejects(evidenceFiles({vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},storedFile:{findMany:async()=>[proof(purpose)]}},['proof']),code('PARTNER_MATERIALS_REQUIRED'));
});

// Preserve historical identity compatibility and current ownership using an
// in-memory persistence boundary. No Prisma client or external service runs.
function partnerStore(purpose:string){
 const file=proof(purpose),maker={id:'maker',role:'OPERATIONS',authVersion:0,staffPersonId:'maker-person',partnerCapabilities:['partner.cooperation.write','partner.cooperation.review']},reviewer={id:'reviewer',role:'ADMIN',authVersion:0,staffPersonId:'reviewer-person',partnerCapabilities:['partner.cooperation.write','partner.cooperation.review']};
 const owner={id:'owner',name:'合成企业',address:'合成地址',subjectType:'ENTERPRISE',creditCode:'A'.repeat(18),revision:0,status:'DRAFT'};
 let binding:any=null,verification:any=null,proposal:any=null,vehicleBinding:any=null;
 const commands=new Map<string,any>(),zero={count:async()=>0};
 const change=(row:any,data:any)=>({...row,...data,...(data.revision&&typeof data.revision==='object'?{revision:row.revision+data.revision.increment}:{})});
 const tx:any={
  vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},
  $queryRaw:async()=>[],$executeRaw:async()=>1,
  adminUser:{findUnique:async({where}:any)=>({...((where.id===maker.id)?maker:reviewer),active:true}),findMany:async()=>[maker,reviewer]},
  vehicleOwner:{findUnique:async()=>owner},customer:{findUnique:async()=>({id:'customer'})},
  storedFile:{findMany:async({where}:any)=>where.id.in.includes(file.id)?[file]:[]},
  archiveCommand:{findUnique:async({where}:any)=>commands.get(JSON.stringify(where.actorId_resourceId_action_key)),create:async({data}:any)=>{const{actorId,resourceId,action,key}=data;commands.set(JSON.stringify({actorId,resourceId,action,key}),data);return data;}},
  auditLog:{create:async({data}:any)=>data},
  partnerIdentityBinding:{findUnique:async()=>binding,create:async({data}:any)=>(binding={id:'binding',...data}),update:async({data}:any)=>(binding=change(binding,data))},
  partnerVerification:{findFirst:async()=>verification,create:async({data}:any)=>(verification={id:'verification',...data}),update:async({data}:any)=>(verification=change(verification,data))},
  vehicle:{findUnique:async()=>({id:'vehicle',reservedOrderId:null,holdId:null})},
  vehicleAssignment:zero,vehicleHold:zero,order:zero,fieldHandoverTask:zero,handover:zero,
  ownerVehicle:{findUnique:async()=>vehicleBinding,upsert:async({create,update}:any)=>(vehicleBinding=vehicleBinding?change(vehicleBinding,update):{id:'vehicle-binding',...create})},
  partnerVehicleBindingProposal:{create:async({data}:any)=>(proposal={id:'proposal',status:'SUBMITTED',...data}),findUnique:async()=>proposal,update:async({data}:any)=>(proposal=change(proposal,data))},
  partnerVehicleBindingHistory:{updateMany:async()=>({count:0}),create:async({data}:any)=>({id:'history',...data})},
 };
 return{tx,maker,reviewer,owner,file,vehicleBinding:()=>vehicleBinding};
}

for(const purpose of ['identity','evidence'])test(`legacy identity and ownership accept ${purpose} originals while retaining independent review`,async()=>{
 const f=partnerStore(purpose),identity=new PartnerIdentityService(),vehicles=new VehicleBindingService();
 const relation=await identity.submit(f.tx,f.maker,f.owner.id,{revision:0,idempotencyKey:'identity-submit-1',customerId:'customer',relationship:'ENTERPRISE_REPRESENTATIVE',evidenceFileIds:[f.file.id],identityChecked:true});
 assert.equal(relation.status,'SUBMITTED');assert.equal(relation.reviewedBy,null);
 const review={revision:relation.revision,idempotencyKey:'identity-review-1',decision:'APPROVE',reason:'合成独立核验'};
 await assert.rejects(identity.review(f.tx,f.maker,f.owner.id,relation.id,review),code('PARTNER_SELF_REVIEW'));
 const approved=await identity.review(f.tx,f.reviewer,f.owner.id,relation.id,review);assert.equal(approved.status,'APPROVED');
 const proposal=await vehicles.submit(f.tx,f.maker,f.owner.id,'vehicle',{revision:0,idempotencyKey:'ownership-submit-1',evidenceFileId:f.file.id});
 assert.equal(proposal.status,'SUBMITTED');assert.equal(f.vehicleBinding(),null);
 const bindingReview={revision:0,idempotencyKey:'ownership-review-1',ownerId:f.owner.id,proposalId:proposal.id};
 await assert.rejects(vehicles.rebind(f.tx,f.maker,'vehicle',bindingReview),code('PARTNER_SELF_REVIEW'));
 assert.equal((await vehicles.rebind(f.tx,f.reviewer,'vehicle',bindingReview)).status,'APPROVED');
});
