import {assertNotAssetFiles} from '../src/files/asset-files';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
import {ElectronicDocumentService} from '../src/electronic-documents/service';
import {createElectronicTask} from '../src/electronic-documents/repository';
import {offlineOrder} from './offline-fixtures';
import {signingParties,syntheticSigningTime} from './electronic-fixtures';
import {buildFadadaMsgDigest,formatFadadaTimestamp} from '../src/esign/fadada/fadada-digest';
import {fail} from '../src/common/errors';
const code=(v:string)=>(e:any)=>e?.getResponse?.().error?.code===v;
async function fixture(db:Db,auto=false,legacyCertificate=false){
 const base=await offlineOrder(db),now=new Date(),writer=new ContractPdfArtifactWriterService(db),operator=await db.adminUser.create({data:{username:'electronic-'+randomUUID(),name:'合成运营',passwordHash:'synthetic-disabled',role:'OPERATIONS',active:true}}),owner=await db.vehicleOwner.create({data:{name:'合成合作商',address:'合成地址',createdBy:operator.id}});
 await db.order.update({where:{id:base.order.id},data:{contractMode:'ELECTRONIC',status:'AWAITING_SIGNATURE'}});
 const source=await writer.persistPdf(Buffer.from('%PDF-1.7\n'+('Synthetic unsigned PDF '.repeat(20))+'\n%%EOF'),{customerId:base.customer.id,name:'合成待签协议.pdf',purpose:'electronic-source'});
 await db.contract.update({where:{id:base.contract.id},data:{executionMode:'ELECTRONIC',sourceFileId:source.id}});
 const archive=await db.documentArchive.create({data:{kind:'RENTAL',subjectType:'ORDER',subjectId:base.order.id,orderId:base.order.id,ownerId:owner.id,createdBy:operator.id}}),parties=signingParties();parties[0].subjectId=base.customer.id;parties[1].subjectId=owner.id;
 for(const p of parties){if(legacyCertificate)delete p.certificate.subjectHash;p.certificate.checkedAt=now.toISOString();p.certificate.validFrom=new Date(now.getTime()-86400000).toISOString();p.certificate.validUntil=new Date(now.getTime()+86400000).toISOString();if(p.autoAuthority){p.autoAuthority.subjectId=p.subjectId;p.autoAuthority.checkedAt=now.toISOString();p.autoAuthority.validFrom=p.certificate.validFrom;p.autoAuthority.validUntil=p.certificate.validUntil;p.autoAuthority.enabled=auto;}}
 const context={kind:'SUBSCRIPTION' as const,platformSubjectId:'ninda',cooperationVersionId:'cooperation-v1',vehicleIds:['vehicle-a']};
 const version=await db.archiveVersion.create({data:{archiveId:archive.id,version:1,executionMode:'ELECTRONIC',templateId:'synthetic-approved',templateVersion:1,sourceFileId:source.id,businessSnapshotHash:'a'.repeat(64),requiredSigners:['CUSTOMER','OWNER','PLATFORM'],partiesSnapshot:parties.map(p=>({role:p.role,partyId:p.subjectId,subjectType:p.subjectType})),scopeSnapshot:{electronicContext:context,electronicDocument:{title:'合成协议',positions:{CUSTOMER:[{pagenum:0,x:40,y:600}],OWNER:[{pagenum:0,x:240,y:600}],PLATFORM:[{pagenum:0,x:440,y:600}]}}}}});
 const task=await db.serial(tx=>createElectronicTask(tx,{archiveVersionId:version.id,contractId:base.contract.id,context,parties,approvedBy:operator.id,now}));
 let activations=0;const calls:any[]=[];const signed=new Set<string>();let uploadError=false,autoError=false,filingError=false,filed=false,downloadError=false;
 const provider:any={verifyFinalFile:async(task:any,bytes:Buffer)=>({providerContractId:task.providerContractId,sourceSha256:task.sourceSha256,finalSha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),subjects:task.parties.map((p:any)=>p.identitySnapshot.certificate.subjectHash),integrity:true,timestamps:true,evidenceHash:'a'.repeat(64),verifiedAt:new Date().toISOString()}),upload:async(doc:any)=>{calls.push(['upload',doc.providerContractId]);if(uploadError)throw new Error('synthetic upload lost');return{evidenceHash:'b'.repeat(64)};},queryUpload:async()=>({uploaded:true,evidenceHash:'c'.repeat(64)}),manualUrl:async(_doc:any,p:any)=>{calls.push(['manual',p.role,p.transactionId]);return{url:'https://textapi17.fadada.com/api2/extsign.api?synthetic=true',expiresAt:new Date(Date.now()+60000).toISOString()};},autoSign:async(_doc:any,p:any)=>{calls.push(['auto',p.role,p.transactionId]);signed.add(p.role);if(autoError)throw new Error('synthetic response lost');return{evidenceHash:'d'.repeat(64)};},querySigner:async(_doc:any,p:any)=>{calls.push(['query',p.role,p.transactionId]);const date=new Date(Math.floor(Date.now()/1000)*1000);return{status:signed.has(p.role)?'SIGNED':'ABSENT',providerSignedAt:date.toISOString(),providerSignedAtRaw:new Date(date.getTime()+8*3600000).toISOString().replace('T',' ').slice(0,19),providerSignedAtPrecisionMs:1000,evidenceHash:'e'.repeat(64)};},fileContract:async(doc:any)=>{calls.push(['file',doc.providerContractId]);filed=true;if(filingError)throw new Error('synthetic filing lost');return{evidenceHash:'f'.repeat(64)};},queryFiling:async()=>({filed,evidenceHash:'f'.repeat(64)}),downloadFinal:async()=>{calls.push(['download']);if(downloadError)throw new Error('synthetic download failed');const bytes=Buffer.from('%PDF-1.7\n'+('Synthetic complete signatures '.repeat(30))+'\n%%EOF');return{bytes};}};
 const service=new ElectronicDocumentService(db,provider,writer,{afterArchive:async()=>{activations++;},resolveParties:async()=>structuredClone(parties),requireOwnerActor:async(_db:any,id:string,ownerId:string)=>{assert.equal(id,'legal-'+ownerId);},refreshAuthorities:async()=>{}});
 const admin={kind:'ADMIN' as const,id:operator.id},customer={kind:'CUSTOMER' as const,id:base.customer.id},ownerActor={kind:'OWNER' as const,id:'legal-'+owner.id,ownerId:owner.id},platform={kind:'OWNER' as const,id:'legal-ninda',ownerId:'ninda'};
 const command=async(extra:any={})=>({revision:(await db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}})).revision,idempotencyKey:randomUUID(),...extra});
 const sign=async(actor:any)=>service.sign(actor,task.id,await command({sourceSha256:source.sha256,accepted:true}));
 return{activationCount:()=>activations,...base,owner,operator,task,version,parties,source,service,provider,calls,signed,admin,customer,ownerActor,platform,command,sign,loseUpload:()=>uploadError=true,loseAuto:()=>autoError=true,loseFiling:()=>filingError=true,failDownload:(value:boolean)=>downloadError=value};
}

test('workspace pagination includes retired history, stable ties and current staff',async()=>{
 const db=new Db();try{const f=await fixture(db);const original=await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id},include:{parties:true}});
 for(let n=0;n<102;n++){
  const version=await db.archiveVersion.create({data:{archiveId:f.version.archiveId,version:n+2,executionMode:'ELECTRONIC',templateId:f.version.templateId,templateVersion:1,sourceFileId:f.source.id,businessSnapshotHash:f.version.businessSnapshotHash,partiesSnapshot:f.version.partiesSnapshot!,requiredSigners:f.version.requiredSigners,scopeSnapshot:f.version.scopeSnapshot!}});
  const contract=await db.contract.create({data:{orderId:f.order.id,customerId:f.customer.id,executionMode:'ELECTRONIC',sourceFileId:f.source.id,documentHash:f.task.businessHash}});
  const {id,parties,createdAt,updatedAt,archiveVersionId,contractId,...base}=original;const copied=parties.map(({id,taskId,...p})=>({...p,transactionId:randomUUID().replaceAll('-','')}));const snapshot={...base.snapshot as any,archiveVersionId:version.id,contractId:contract.id,parties:copied.map(require('../src/electronic-documents/repository').frozenParty)};
  await db.electronicSigningTask.create({data:{...base,archiveVersionId:version.id,contractId:contract.id,providerContractId:randomUUID().replaceAll('-',''),snapshot,snapshotHash:require('../src/customers/types').canonicalHash(snapshot),createdAt:new Date('2026-01-01'),...(n===101?{status:'RETIRED',retiredAt:new Date()}:{}),parties:{create:copied}}});
 }
 const all=await f.service.list(f.admin,f.order.id,{page:1,pageSize:100} as any);assert.equal((all as any).total,103);assert.equal(all.items.length,100);
 const tail=await f.service.list(f.customer,f.order.id,{page:2,pageSize:100} as any);assert.equal(tail.items.length,3);assert.equal(new Set([...all.items,...tail.items].map(t=>t.id)).size,103);
 assert.equal((await f.service.list({...f.customer,id:'foreign'},f.order.id) as any).total,0);
 await assert.rejects(()=>f.service.detail({...f.customer,id:'foreign'},f.task.id));
 await db.adminUser.update({where:{id:f.operator.id},data:{authVersion:2}});
 await assert.rejects(()=>f.service.list({...f.admin,role:'OPERATIONS',authVersion:0} as any),code('STAFF_SESSION_CHANGED'));
 assert.equal(f.calls.length,0);
 }finally{await db.$disconnect();}
});

test('no-task workspace returns actionable current source gates without granting write to finance',async()=>{
 const db=new Db();try{const f=await fixture(db),empty=await offlineOrder(db);await db.order.update({where:{id:empty.order.id},data:{contractMode:'ELECTRONIC',finalPlanSnapshot:{commercialHash:'a'.repeat(64),lessorSnapshot:{ownerId:f.owner.id,agreementVersionId:'missing',vehicleId:empty.vehicle.id},productSnapshot:{productVersionId:'missing'}}}});
 const view=await (f.service as any).workspace(f.admin,empty.order.id,{});assert.equal(view.orderId,empty.order.id);assert.ok(view.readiness.some((r:any)=>r.missing.length));assert.equal(view.permissions.prepare,true);
 await db.adminUser.update({where:{id:f.operator.id},data:{role:'FINANCE'}});const read=await (f.service as any).workspace({...f.admin,role:'FINANCE',authVersion:0},empty.order.id,{});assert.equal(read.permissions.prepare,false);assert.ok(read.readiness.every((r:any)=>r.missing.every((m:any)=>!m.action?.enabled)));
 await assert.rejects(()=>(f.service as any).workspace({...f.customer,id:'foreign'},empty.order.id,{}));assert.equal(f.calls.length,0);
 }finally{await db.$disconnect();}
});

test('historical dependency binding and genuine notification read remain distinct from legal receipt',async()=>{
 const db=new Db();try{const f=await fixture(db),other=await fixture(db);
 async function child(n:number){
 const contract=await db.contract.create({data:{orderId:f.order.id,customerId:f.customer.id,executionMode:'ELECTRONIC',sourceFileId:f.source.id,documentHash:f.task.businessHash}});
 const version=await db.archiveVersion.create({data:{archiveId:f.version.archiveId,version:n,executionMode:'ELECTRONIC',sourceFileId:f.source.id,templateId:f.version.templateId,templateVersion:1,businessSnapshotHash:f.task.businessHash,partiesSnapshot:f.version.partiesSnapshot!,requiredSigners:f.version.requiredSigners,scopeSnapshot:{...f.version.scopeSnapshot as any,originalArchiveVersionId:f.version.id}}});
 return db.serial(tx=>createElectronicTask(tx,{archiveVersionId:version.id,contractId:contract.id,context:(f.task.snapshot as any).context,parties:f.parties,approvedBy:f.operator.id,now:new Date()}));
 }
 const selected=await child(2),newest=await child(3);
 await assert.rejects(()=>(f.service as any).dependency(f.customer,selected.id,other.task.id));
 const pinned=await (f.service as any).dependency(f.customer,selected.id,f.task.id);assert.equal(pinned.archiveVersionId,f.version.id);
 const dependencies=await (f.service as any).dependencies(f.customer,selected.id);assert.equal(dependencies.items.some((d:any)=>d.id===newest.id),false);
 const notification=await db.notification.create({data:{customerId:f.customer.id,title:'合成站内提醒',content:'提醒不构成到达或同意',resourceType:'ELECTRONIC_DOCUMENT',resourceId:f.task.id}});
 let view=await (f.service as any).workspace(f.customer,f.order.id);let notice=view.related.notifications.find((n:any)=>n.id===notification.id);assert.equal(notice.receiptStatus,'UNKNOWN');assert.equal(notice.agreement,false);assert.equal(notice.readAt,null);
 await db.notification.update({where:{id:notification.id},data:{readAt:new Date()}});view=await (f.service as any).workspace(f.customer,f.order.id);notice=view.related.notifications.find((n:any)=>n.id===notification.id);assert.ok(notice.readAt);assert.equal(notice.receiptStatus,'UNKNOWN');assert.equal(notice.agreement,false);assert.equal(f.calls.length,0);
 }finally{await db.$disconnect();}
});
