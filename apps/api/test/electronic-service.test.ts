import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
import {ElectronicDocumentService} from '../src/electronic-documents/service';
import {createElectronicTask} from '../src/electronic-documents/repository';
import {offlineOrder} from './offline-fixtures';
import {signingParties} from './electronic-fixtures';
import {buildFadadaMsgDigest,formatFadadaTimestamp} from '../src/esign/fadada/fadada-digest';
import {fail} from '../src/common/errors';
const code=(v:string)=>(e:any)=>e?.getResponse?.().error?.code===v;
async function fixture(db:Db,auto=false){
 const base=await offlineOrder(db),now=new Date(),writer=new ContractPdfArtifactWriterService(db),operator=await db.adminUser.create({data:{username:'electronic-'+randomUUID(),name:'合成运营',passwordHash:'synthetic-disabled',role:'OPERATIONS',active:true}}),owner=await db.vehicleOwner.create({data:{name:'合成合作商',address:'合成地址',createdBy:operator.id}});
 await db.order.update({where:{id:base.order.id},data:{contractMode:'ELECTRONIC',status:'AWAITING_SIGNATURE'}});
 const source=await writer.persistPdf(Buffer.from('%PDF-1.7\n'+('Synthetic unsigned PDF '.repeat(20))+'\n%%EOF'),{customerId:base.customer.id,name:'合成待签协议.pdf',purpose:'electronic-source'});
 await db.contract.update({where:{id:base.contract.id},data:{executionMode:'ELECTRONIC',sourceFileId:source.id}});
 const archive=await db.documentArchive.create({data:{kind:'RENTAL',subjectType:'ORDER',subjectId:base.order.id,orderId:base.order.id,ownerId:owner.id,createdBy:operator.id}}),parties=signingParties();parties[0].subjectId=base.customer.id;parties[1].subjectId=owner.id;
 for(const p of parties){p.certificate.checkedAt=now.toISOString();p.certificate.validFrom=new Date(now.getTime()-86400000).toISOString();p.certificate.validUntil=new Date(now.getTime()+86400000).toISOString();if(p.autoAuthority){p.autoAuthority.subjectId=p.subjectId;p.autoAuthority.checkedAt=now.toISOString();p.autoAuthority.validFrom=p.certificate.validFrom;p.autoAuthority.validUntil=p.certificate.validUntil;p.autoAuthority.enabled=auto;}}
 const context={kind:'SUBSCRIPTION' as const,platformSubjectId:'ninda',cooperationVersionId:'cooperation-v1',vehicleIds:['vehicle-a']};
 const version=await db.archiveVersion.create({data:{archiveId:archive.id,version:1,executionMode:'ELECTRONIC',templateId:'synthetic-approved',templateVersion:1,sourceFileId:source.id,businessSnapshotHash:'a'.repeat(64),requiredSigners:['CUSTOMER','OWNER','PLATFORM'],partiesSnapshot:parties.map(p=>({role:p.role,partyId:p.subjectId,subjectType:p.subjectType})),scopeSnapshot:{electronicContext:context,electronicDocument:{title:'合成协议',positions:{CUSTOMER:[{pagenum:0,x:40,y:600}],OWNER:[{pagenum:0,x:240,y:600}],PLATFORM:[{pagenum:0,x:440,y:600}]}}}}});
 const task=await db.serial(tx=>createElectronicTask(tx,{archiveVersionId:version.id,contractId:base.contract.id,context,parties,approvedBy:operator.id,now}));
 const calls:any[]=[];const signed=new Set<string>();let uploadError=false,autoError=false,filingError=false,filed=false,downloadError=false;
 const provider:any={upload:async(doc:any)=>{calls.push(['upload',doc.providerContractId]);if(uploadError)throw new Error('synthetic upload lost');return{evidenceHash:'b'.repeat(64)};},queryUpload:async()=>({uploaded:true,evidenceHash:'c'.repeat(64)}),manualUrl:async(_doc:any,p:any)=>{calls.push(['manual',p.role,p.transactionId]);return{url:'https://textapi17.fadada.com/api2/extsign.api?synthetic=true',expiresAt:new Date(Date.now()+60000).toISOString()};},autoSign:async(_doc:any,p:any)=>{calls.push(['auto',p.role,p.transactionId]);signed.add(p.role);if(autoError)throw new Error('synthetic response lost');return{evidenceHash:'d'.repeat(64)};},querySigner:async(_doc:any,p:any)=>{calls.push(['query',p.role,p.transactionId]);return{status:signed.has(p.role)?'SIGNED':'ABSENT',evidenceHash:'e'.repeat(64)};},fileContract:async(doc:any)=>{calls.push(['file',doc.providerContractId]);filed=true;if(filingError)throw new Error('synthetic filing lost');return{evidenceHash:'f'.repeat(64)};},queryFiling:async()=>({filed,evidenceHash:'f'.repeat(64)}),downloadFinal:async()=>{calls.push(['download']);if(downloadError)throw new Error('synthetic download failed');const bytes=Buffer.from('%PDF-1.7\n'+('Synthetic complete signatures '.repeat(30))+'\n%%EOF');return{bytes};}};
 const service=new ElectronicDocumentService(db,provider,writer,{resolveParties:async()=>structuredClone(parties),requireOwnerActor:async(_db:any,id:string,ownerId:string)=>{assert.equal(id,'legal-'+ownerId);},refreshAuthorities:async()=>{}});
 const admin={kind:'ADMIN' as const,id:operator.id},customer={kind:'CUSTOMER' as const,id:base.customer.id},ownerActor={kind:'OWNER' as const,id:'legal-'+owner.id,ownerId:owner.id},platform={kind:'OWNER' as const,id:'legal-ninda',ownerId:'ninda'};
 const command=async(extra:any={})=>({revision:(await db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}})).revision,idempotencyKey:randomUUID(),...extra});
 const sign=async(actor:any)=>service.sign(actor,task.id,await command({sourceSha256:source.sha256,accepted:true}));
 return{...base,owner,operator,task,version,parties,source,service,provider,calls,signed,admin,customer,ownerActor,platform,command,sign,loseUpload:()=>uploadError=true,loseAuto:()=>autoError=true,loseFiling:()=>filingError=true,failDownload:(value:boolean)=>downloadError=value};
}
test('three manual signers act in order; two signatures cannot file; final archive contains all three and no paper reviewer',async()=>{
 const db=new Db();try{const f=await fixture(db);await f.service.start(f.admin,f.task.id,await f.command());await assert.rejects(f.sign(f.ownerActor),code('ELECTRONIC_OPERATION_NOT_AVAILABLE'));
 await f.sign(f.customer);f.signed.add('CUSTOMER');await f.service.sync(f.customer,f.task.id,await f.command());await f.sign(f.ownerActor);f.signed.add('OWNER');await f.service.sync(f.ownerActor,f.task.id,await f.command());assert.equal(f.calls.some(c=>c[0]==='file'),false);
 await f.sign(f.platform);f.signed.add('PLATFORM');await f.service.sync(f.platform,f.task.id,await f.command());const task=await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id},include:{parties:true}}),version=await db.archiveVersion.findUniqueOrThrow({where:{id:f.version.id}});assert.equal(task.status,'ARCHIVED');assert.ok(task.parties.every(p=>p.status==='SIGNED'));assert.equal(version.reviewedBy,null);assert.notEqual(task.finalSha256,f.source.sha256);assert.equal(f.calls.filter(c=>c[0]==='file').length,1);
 }finally{await db.$disconnect();}
});
test('concurrent start and repeated sign commands share original operation and transaction',async()=>{
 const db=new Db();try{const f=await fixture(db),input=await f.command();await Promise.all([f.service.start(f.admin,f.task.id,input),f.service.start(f.admin,f.task.id,input)]);assert.equal(f.calls.filter(c=>c[0]==='upload').length,1);
 const sign=await f.command({sourceSha256:f.source.sha256,accepted:true});await f.service.sign(f.customer,f.task.id,sign);await f.service.sign(f.customer,f.task.id,sign);const row=await db.electronicSigningParty.findUniqueOrThrow({where:{taskId_role:{taskId:f.task.id,role:'CUSTOMER'}}});assert.ok(row.manualConsentHash);assert.equal(await db.electronicSigningOperation.count({where:{taskId:f.task.id,kind:'SIGN'}}),1);
 await assert.rejects(f.service.sign(f.customer,f.task.id,{...sign,sourceSha256:'0'.repeat(64)}));
 }finally{await db.$disconnect();}
});
test('unknown upload recovers by original query without another upload',async()=>{
 const db=new Db();try{const f=await fixture(db);f.loseUpload();await f.service.start(f.admin,f.task.id,await f.command());assert.equal((await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id}})).uploadStatus,'UNKNOWN');await f.service.sync(f.admin,f.task.id,await f.command());assert.equal(f.calls.filter(c=>c[0]==='upload').length,1);assert.equal((await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id}})).uploadStatus,'UPLOADED');}finally{await db.$disconnect();}
});
test('unknown automatic seal is queried on the same transaction and never repeated or changed to manual',async()=>{
 const db=new Db();try{const f=await fixture(db,true);f.loseAuto();await f.service.start(f.admin,f.task.id,await f.command());await f.sign(f.customer);f.signed.add('CUSTOMER');await f.service.sync(f.customer,f.task.id,await f.command());assert.equal(f.calls.filter(c=>c[0]==='auto'&&c[1]==='OWNER').length,1);
 await f.service.sync(f.admin,f.task.id,await f.command());await f.service.sync(f.admin,f.task.id,await f.command());assert.equal(f.calls.filter(c=>c[0]==='auto'&&c[1]==='OWNER').length,1);assert.equal(f.calls.filter(c=>c[0]==='auto'&&c[1]==='PLATFORM').length,1);assert.equal(f.calls.some(c=>c[0]==='manual'&&c[1]!=='CUSTOMER'),false);
 }finally{await db.$disconnect();}
});
test('lost filing response and failed PDF download recover the same task without duplicate filing',async()=>{
 const db=new Db();try{const f=await fixture(db);f.loseFiling();f.failDownload(true);await f.service.start(f.admin,f.task.id,await f.command());for(const[role,actor]of [['CUSTOMER',f.customer],['OWNER',f.ownerActor],['PLATFORM',f.platform]] as const){await f.sign(actor);f.signed.add(role);await f.service.sync(actor,f.task.id,await f.command());}
 assert.notEqual((await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id}})).status,'ARCHIVED');await f.service.sync(f.admin,f.task.id,await f.command());f.failDownload(false);await f.service.sync(f.admin,f.task.id,await f.command());assert.equal((await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id}})).status,'ARCHIVED');assert.equal(f.calls.filter(c=>c[0]==='file').length,1);
 }finally{await db.$disconnect();}
});
test('cross-customer, cross-owner, finance and backend administrators cannot personally sign; withdrawal stops new dispatch',async()=>{
 const db=new Db();try{const f=await fixture(db);await f.service.start(f.admin,f.task.id,await f.command());await assert.rejects(f.sign({...f.customer,id:'other'}));await assert.rejects(f.sign({...f.ownerActor,ownerId:'other'}));await assert.rejects(f.sign(f.admin),code('ELECTRONIC_PERSONAL_SIGNER_REQUIRED'));
 await db.adminUser.update({where:{id:f.operator.id},data:{role:'FINANCE'}});await assert.rejects(f.service.start(f.admin,f.task.id,await f.command()));await db.adminUser.update({where:{id:f.operator.id},data:{role:'OPERATIONS'}});
 await f.service.withdraw(f.admin,f.task.id,await f.command({reason:'合成测试撤回'}));await assert.rejects(f.sign(f.customer));assert.equal(f.calls.some(c=>c[0]==='manual'),false);
 }finally{await db.$disconnect();}
});
test('fresh provider grant is read before dispatch instead of treating an old preparation snapshot as current',async()=>{
 const db=new Db();try{const f=await fixture(db,true);await f.service.start(f.admin,f.task.id,await f.command());await f.sign(f.customer);const owner=await db.electronicSigningParty.findUniqueOrThrow({where:{taskId_role:{taskId:f.task.id,role:'OWNER'}}}),snapshot:any=owner.identitySnapshot;snapshot.autoAuthority.checkedAt=new Date(Date.now()-120000).toISOString();await db.electronicSigningParty.update({where:{id:owner.id},data:{identitySnapshot:snapshot}});f.signed.add('CUSTOMER');await f.service.sync(f.customer,f.task.id,await f.command());assert.equal((await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id}})).status,'ARCHIVED');}finally{await db.$disconnect();}
});
test('callbacks require a valid digest and original transaction query; late success after withdrawal records proof without reviving business',async()=>{
 const db=new Db();try{const f=await fixture(db);await f.service.start(f.admin,f.task.id,await f.command());await f.sign(f.customer);const p=await db.electronicSigningParty.findUniqueOrThrow({where:{taskId_role:{taskId:f.task.id,role:'CUSTOMER'}}}),config={appId:'fixture',appSecret:'fixture-secret'},timestamp=formatFadadaTimestamp(new Date()),event={transaction_id:p.transactionId,contract_id:f.task.providerContractId,customer_id:p.providerCustomerId,result_code:'3000',timestamp,msg_digest:buildFadadaMsgDigest({...config,timestamp,explicitSortString:p.transactionId})};
 await assert.rejects(f.service.callback({...event,msg_digest:'forged'},config));await f.service.callback(event,config);assert.equal((await db.electronicSigningParty.findUniqueOrThrow({where:{id:p.id}})).status,'ISSUED');
 await f.service.withdraw(f.admin,f.task.id,await f.command({reason:'合成测试撤回'}));f.signed.add('CUSTOMER');await f.service.callback(event,config);await f.service.callback(event,config);assert.equal((await db.electronicSigningParty.findUniqueOrThrow({where:{id:p.id}})).status,'SIGNED');assert.equal((await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id}})).status,'WITHDRAWN');assert.equal(f.calls.some(c=>c[0]==='file'),false);
 await assert.rejects(f.service.callback({...event,contract_id:'wrong'},config));
 }finally{await db.$disconnect();}
});
test('explicit filing rejection can retry the original contract only after a bound not-filed query',async()=>{
 const db=new Db();try{const f=await fixture(db),original=f.provider.fileContract;let failed=false;f.provider.fileContract=async(doc:any)=>{if(!failed){failed=true;f.calls.push(['rejected-file',doc.providerContractId]);fail(502,'ELECTRONIC_PROVIDER_REJECTED','合成明确失败');}return original(doc);};await f.service.start(f.admin,f.task.id,await f.command());for(const[role,actor]of [['CUSTOMER',f.customer],['OWNER',f.ownerActor],['PLATFORM',f.platform]] as const){await f.sign(actor);f.signed.add(role);await f.service.sync(actor,f.task.id,await f.command());}await f.service.sync(f.admin,f.task.id,await f.command());assert.equal((await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id}})).status,'ARCHIVED');assert.equal(await db.electronicSigningOperation.count({where:{taskId:f.task.id,kind:'FILE'}}),2);assert.ok(f.calls.filter(c=>c[0]==='file'||c[0]==='rejected-file').every(c=>c[1]===f.task.providerContractId));}finally{await db.$disconnect();}
});
