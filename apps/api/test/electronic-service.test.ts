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
test('stopped complete signing preserves an authorized final file exactly once without business activation',async()=>{
 const db=new Db();try{const f=await fixture(db);await f.service.start(f.admin,f.task.id,await f.command());for(const[role,actor]of [['CUSTOMER',f.customer],['OWNER',f.ownerActor]] as const){await f.sign(actor);f.signed.add(role);await f.service.sync(actor,f.task.id,await f.command());}await f.sign(f.platform);
 await f.service.withdraw(f.admin,f.task.id,await f.command({reason:'stop late completion'}));f.signed.add('PLATFORM');await (f.service as any).reconcileStopped(f.task.id);await (f.service as any).reconcileStopped(f.task.id);
 const task:any=await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id}});assert.equal(task.status,'WITHDRAWN');assert.equal(f.activationCount(),0);assert.ok(task.stoppedEvidenceId);assert.ok(task.legalCompletedAt);assert.equal(task.archivedAt,null);assert.ok((await f.service.file(f.customer,f.task.id,'signed')).bytes.length>0);
 const version=await db.archiveVersion.findUniqueOrThrow({where:{id:f.version.id},include:{archive:true}});assert.notEqual(version.status,'ARCHIVED');assert.equal(version.archive.currentApprovedVersionId,null);assert.equal(await db.archiveFile.count({where:{versionId:version.id}}),0);assert.equal(f.calls.filter(c=>c[0]==='file').length,1);
 }finally{await db.$disconnect();}
});
test('stopped evidence filing timeout queries original contract and failed verification never exposes final file',async()=>{
 const db=new Db();try{const f=await fixture(db);await f.service.start(f.admin,f.task.id,await f.command());for(const[role,actor]of [['CUSTOMER',f.customer],['OWNER',f.ownerActor]] as const){await f.sign(actor);f.signed.add(role);await f.service.sync(actor,f.task.id,await f.command());}await f.sign(f.platform);await f.service.withdraw(f.admin,f.task.id,await f.command({reason:'stop before completion'}));f.signed.add('PLATFORM');f.loseFiling();await assert.rejects(f.service.reconcileStopped(f.task.id));
 let task=await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id},include:{parties:true}});assert.ok(task.parties.every(p=>p.status==='SIGNED'));assert.equal(task.filingStatus,'REQUESTED');const verify=f.provider.verifyFinalFile;f.provider.verifyFinalFile=async()=>{throw new Error('synthetic wrong certificate');};await assert.rejects(f.service.reconcileStopped(f.task.id));await assert.rejects(f.service.file(f.customer,f.task.id,'signed'));assert.equal(f.activationCount(),0);
 f.provider.verifyFinalFile=verify;await f.service.reconcileStopped(f.task.id);await f.service.reconcileStopped(f.task.id);assert.equal(f.calls.filter(c=>c[0]==='file').length,1);assert.equal(f.activationCount(),0);assert.equal(await db.electronicStoppedEvidence.count({where:{taskId:f.task.id}}),1);
 }finally{await db.$disconnect();}
});
test('a successful stop while automatic readiness is in flight prevents later automatic dispatch',async()=>{
 const db=new Db();try{const f=await fixture(db,true);await f.service.start(f.admin,f.task.id,await f.command());await f.sign(f.customer);f.signed.add('CUSTOMER');let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),held=new Promise<void>(resolve=>release=resolve);
 (f.service as any).options.refreshAuthorities=async()=>{entered();await held;};const advancing=f.service.sync(f.customer,f.task.id,await f.command());await ready;await f.service.withdraw(f.admin,f.task.id,await f.command({reason:'stop automatic dispatch race'}));release();await advancing;
 assert.equal(f.calls.some(c=>c[0]==='auto'),false);assert.equal((await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id}})).status,'WITHDRAWN');assert.equal(f.activationCount(),0);
 }finally{await db.$disconnect();}
});
import {ElectronicProvider} from '../src/electronic-documents/provider';
import {FilesController} from '../src/files/files';
test('rejected final bytes are privately quarantined with exact binding and duplicate retries retain one copy',async()=>{
 const db=new Db();try{const f=await fixture(db);await f.service.start(f.admin,f.task.id,await f.command());for(const[role,actor]of [['CUSTOMER',f.customer],['OWNER',f.ownerActor]] as const){await f.sign(actor);f.signed.add(role);await f.service.sync(actor,f.task.id,await f.command());}await f.sign(f.platform);await f.service.withdraw(f.admin,f.task.id,await f.command({reason:'retain rejected final evidence'}));f.signed.add('PLATFORM');
 const invalid=new ElectronicProvider({enabled:true,baseUrl:'https://textapi17.fadada.com/api2/',appId:'synthetic',appSecret:'synthetic',apiVersion:'2.0',requestTimeoutMs:1000} as any,async()=>({status:200,headers:{},bodyText:JSON.stringify({code:'1000',result:'success',data:[{integrityflag:true,signer:'2@Other@123456@serial',timestampflag:true,timestampverifyflag:true,signedontime:'2026-01-01 09:00:00',timestamptime:'2026-01-01 09:00:00'}]})}));f.provider.verifyFinalFile=invalid.verifyFinalFile.bind(invalid);
 await assert.rejects(f.service.reconcileStopped(f.task.id));await assert.rejects(f.service.reconcileStopped(f.task.id));
 const rows=await (db as any).electronicFileQuarantine.findMany({where:{taskId:f.task.id}});assert.equal(rows.length,1);const q=rows[0],file=await db.storedFile.findUniqueOrThrow({where:{id:q.fileId}}),expected=(await f.provider.downloadFinal()).bytes;
 assert.equal(q.archiveVersionId,f.version.id);assert.equal(q.providerContractId,f.task.providerContractId);assert.equal(q.sourceSha256,f.source.sha256);assert.equal(q.rejectionCode,'ELECTRONIC_FINAL_SUBJECT_MISMATCH');assert.match(q.verificationReceiptHash,/^[a-f0-9]{64}$/);assert.ok(q.checkedAt);assert.equal(file.customerId,null);assert.equal(file.purpose,'electronic-quarantine');assert.deepEqual(await new ContractPdfArtifactWriterService(db).readQuarantined(q.fileId,q.sha256),expected);
 await assert.rejects(assertNotAssetFiles(db,[q.fileId]),code('ELECTRONIC_QUARANTINE_PRIVATE'));
 const files=new FilesController(db);await assert.rejects(files.customerRead(q.fileId,{customer:{id:f.customer.id}},{}));await assert.rejects(files.adminRead(q.fileId,{admin:{id:f.operator.id,role:'ADMIN'}},{}));await assert.rejects(f.service.file(f.customer,f.task.id,'signed'));await assert.rejects(f.service.file(f.ownerActor,f.task.id,'signed'));
 await db.storedFile.update({where:{id:q.fileId},data:{purpose:'evidence',customerId:f.customer.id}});await assert.rejects(files.customerRead(q.fileId,{customer:{id:f.customer.id}},{}),code('ELECTRONIC_QUARANTINE_PRIVATE'));await assert.rejects(assertNotAssetFiles(db,[q.fileId]),code('ELECTRONIC_QUARANTINE_PRIVATE'));
 let downloads=0;for(const variant of ['second','third']){f.provider.downloadFinal=async()=>{downloads++;return{bytes:Buffer.concat([expected,Buffer.from(variant)])};};await assert.rejects(f.service.reconcileStopped(f.task.id));}assert.equal(await (db as any).electronicFileQuarantine.count({where:{taskId:f.task.id}}),3);await assert.rejects(f.service.reconcileStopped(f.task.id),code('ELECTRONIC_QUARANTINE_REVIEW_REQUIRED'));assert.equal(downloads,2);
 assert.equal(f.activationCount(),0);assert.equal((await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id}})).finalFileId,null);assert.equal((await db.documentArchive.findUniqueOrThrow({where:{id:f.version.archiveId}})).currentApprovedVersionId,null);
 }finally{await db.$disconnect();}
});
test('normal archive verification failure commits isolated evidence without promoting the business archive',async()=>{
 const db=new Db();try{const f=await fixture(db);f.provider.verifyFinalFile=async()=>{fail(502,'ELECTRONIC_FINAL_INTEGRITY_INVALID','synthetic invalid integrity');};await f.service.start(f.admin,f.task.id,await f.command());for(const[role,actor]of [['CUSTOMER',f.customer],['OWNER',f.ownerActor],['PLATFORM',f.platform]] as const){await f.sign(actor);f.signed.add(role);await f.service.sync(actor,f.task.id,await f.command());}
 const q=await db.electronicFileQuarantine.findFirstOrThrow({where:{taskId:f.task.id}});assert.equal(q.rejectionCode,'ELECTRONIC_FINAL_INTEGRITY_INVALID');assert.equal(q.verificationReceiptHash,null);await f.service.advance(f.task.id);assert.equal(await db.electronicFileQuarantine.count({where:{taskId:f.task.id}}),1);assert.equal(f.activationCount(),0);await assert.rejects(f.service.file(f.customer,f.task.id,'signed'));assert.equal((await db.documentArchive.findUniqueOrThrow({where:{id:f.version.archiveId}})).currentApprovedVersionId,null);assert.equal((await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id}})).archivedAt,null);
 }finally{await db.$disconnect();}
});
async function migratedSignedFixture(db:Db,missingCertificate:boolean,stopped:boolean,signedCount=3){
 const f=await fixture(db,false,missingCertificate),at=Date.now(),observed=new Map<string,Date>(),originals=new Map<string,string>();
 await db.electronicSigningTask.update({where:{id:f.task.id},data:{status:stopped?'WITHDRAWN':'SIGNING',withdrawnAt:stopped?new Date():null,stopStatus:stopped?'NEEDS_REVIEW':null,uploadStatus:'UPLOADED',uploadedAt:new Date(at-60000)}});
 for(const [i,p]of f.task.parties.slice(0,signedCount).entries()){const attemptedAt=new Date(at-50000+i*10000),verifiedAt=new Date(at-45000+i*10000),consent={taskId:f.task.id,role:p.role,actorId:p.subjectId,sourceSha256:f.task.sourceSha256};observed.set(p.id,verifiedAt);originals.set(p.id,p.transactionId);await db.electronicSigningParty.update({where:{id:p.id},data:{manualConsent:consent,manualConsentHash:require('../src/customers/types').canonicalHash(consent),attemptedAt,verifiedAt,status:'SIGNED',queryEvidenceHash:'e'.repeat(64)}});}
 f.provider.querySigner=async(_doc:any,p:any)=>{f.calls.push(['query',p.role,p.transactionId]);return{status:'SIGNED',...syntheticSigningTime(new Date(p.attemptedAt.getTime()+1000)),evidenceHash:'f'.repeat(64)};};return{...f,observed,originals};
}
test('pre-migration SIGNED parties enrich original transactions without replacing their earlier observation',async()=>{
 const db=new Db();try{const f=await migratedSignedFixture(db,false,false);await f.service.advance(f.task.id);const task=await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id},include:{parties:true}});assert.equal(task.status,'ARCHIVED');for(const p of task.parties){assert.ok(p.providerSignedAt);assert.equal(p.verifiedAt?.toISOString(),f.observed.get(p.id)?.toISOString());assert.equal(p.transactionId,f.originals.get(p.id));assert.equal((p as any).originalQueryEvidenceHash,'e'.repeat(64));assert.ok((p as any).evidenceCheckedAt);}assert.equal(f.calls.filter(c=>c[0]==='query').length,3);assert.equal(f.calls.some(c=>c[0]==='auto'||c[0]==='manual'),false);
 }finally{await db.$disconnect();}
});
test('legacy stopped snapshots enrich time but explicitly audit missing original certificate evidence',async()=>{
 const db=new Db();try{const f=await migratedSignedFixture(db,true,true,2),p=f.task.parties[0],config={appId:'fixture',appSecret:'fixture-secret'},timestamp=formatFadadaTimestamp(new Date()),event={transaction_id:p.transactionId,contract_id:f.task.providerContractId,customer_id:p.providerCustomerId,result_code:'3000',timestamp,msg_digest:buildFadadaMsgDigest({...config,timestamp,explicitSortString:p.transactionId})};await f.service.callback(event,config);await f.service.reconcileStopped(f.task.id);const task:any=await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id},include:{parties:true}});assert.equal(task.parties.filter((p:any)=>p.providerSignedAt&&p.status==='SIGNED').length,2);assert.equal(task.evidenceReviewStatus,'ORIGINAL_CERTIFICATE_REQUIRED');assert.equal(task.finalFileId,null);assert.equal(task.stoppedEvidenceId,null);assert.equal(f.calls.filter(c=>c[0]==='query').length,2);assert.equal(f.calls.some(c=>c[0]==='file'||c[0]==='auto'||c[0]==='manual'),false);assert.equal(await db.auditLog.count({where:{action:'ELECTRONIC_ORIGINAL_CERTIFICATE_REQUIRED',resourceId:f.task.id}}),1);for(const p of task.parties.filter((p:any)=>p.status==='SIGNED')){assert.equal(p.verifiedAt.toISOString(),f.observed.get(p.id)?.toISOString());assert.equal(p.transactionId,f.originals.get(p.id));}
 }finally{await db.$disconnect();}
});
import {reconcileElectronicBatch} from '../src/electronic-documents/reconciliation';
async function mixedOriginalRecoveryFixture(db:Db){
 const f=await migratedSignedFixture(db,false,true,2),platform=f.task.parties.find(p=>p.role==='PLATFORM')!,consent={taskId:f.task.id,role:platform.role,actorId:platform.subjectId,sourceSha256:f.task.sourceSha256};
 await db.electronicSigningParty.update({where:{id:platform.id},data:{status:'UNKNOWN',attemptedAt:new Date(Date.now()-10000),manualConsent:consent,manualConsentHash:require('../src/customers/types').canonicalHash(consent)}});
 const query=f.provider.querySigner;f.provider.querySigner=async(doc:any,p:any)=>{if(p.role==='CUSTOMER'){f.calls.push(['query',p.role,p.transactionId]);throw new Error('synthetic persistent original customer outage');}return query(doc,p);};return{...f,platform};
}
async function assertMixedOriginalEvidence(db:Db,f:Awaited<ReturnType<typeof mixedOriginalRecoveryFixture>>){
 const task=await db.electronicSigningTask.findUniqueOrThrow({where:{id:f.task.id},include:{parties:true}}),customer=task.parties.find(p=>p.role==='CUSTOMER')!,platform=task.parties.find(p=>p.role==='PLATFORM')!;
 assert.equal(customer.status,'SIGNED');assert.equal(customer.providerSignedAt,null);assert.equal(customer.queryEvidenceHash,'e'.repeat(64));assert.equal(customer.verifiedAt?.toISOString(),f.observed.get(customer.id)?.toISOString());
 assert.equal(platform.status,'SIGNED');assert.ok(platform.providerSignedAt);assert.equal(platform.queryEvidenceHash,'f'.repeat(64));assert.equal(platform.transactionId,f.platform.transactionId);assert.equal(f.calls.filter(c=>c[0]==='query'&&c[1]==='PLATFORM').length,1);
 assert.equal(f.calls.some(c=>['auto','manual','file','download'].includes(c[0])),false);assert.equal(task.status,'WITHDRAWN');assert.equal(task.filingStatus,'NOT_STARTED');assert.equal(task.finalFileId,null);assert.equal(task.stoppedEvidenceId,null);assert.equal(task.archivedAt,null);assert.equal(f.activationCount(),0);
 assert.equal((await db.documentArchive.findUniqueOrThrow({where:{id:f.version.archiveId}})).currentApprovedVersionId,null);assert.notEqual((await db.archiveVersion.findUniqueOrThrow({where:{id:f.version.id}})).status,'ARCHIVED');await assert.rejects(f.service.file(f.customer,f.task.id,'signed'));
 return platform;
}
test('stopped callback preserves its own original success before an older party query fails, and replay never signs again',async()=>{
 const db=new Db();try{const f=await mixedOriginalRecoveryFixture(db),p=f.platform,config={appId:'fixture',appSecret:'fixture-secret'},timestamp=formatFadadaTimestamp(new Date()),event={transaction_id:p.transactionId,contract_id:f.task.providerContractId,customer_id:p.providerCustomerId,result_code:'3000',timestamp,msg_digest:buildFadadaMsgDigest({...config,timestamp,explicitSortString:p.transactionId})};
 assert.deepEqual(await f.service.callback(event,config),{accepted:true});assert.deepEqual(f.calls.filter(c=>c[0]==='query')[0],['query','PLATFORM',p.transactionId]);const first=await assertMixedOriginalEvidence(db,f);
 await f.service.callback(event,config);const replay=await assertMixedOriginalEvidence(db,f);assert.equal(replay.evidenceCheckedAt?.toISOString(),first.evidenceCheckedAt?.toISOString());assert.equal(replay.verifiedAt?.toISOString(),first.verifiedAt?.toISOString());assert.equal(await db.providerEvent.count({where:{resourceId:f.task.id,status:'RETIRED_VERIFIED'}}),1);
 }finally{await db.$disconnect();}
});
test('stopped batch scan isolates an older original query failure and commits later success only once',async()=>{
 const db=new Db();try{const f=await mixedOriginalRecoveryFixture(db),now=new Date(),scoped:any={electronicSigningTask:{findMany:(q:any)=>db.electronicSigningTask.findMany({...q,where:{AND:[q.where,{id:f.task.id}]}}),updateMany:(q:any)=>db.electronicSigningTask.updateMany(q)}};
 await reconcileElectronicBatch(scoped,f.service,now);const first=await assertMixedOriginalEvidence(db,f);await reconcileElectronicBatch(scoped,f.service,new Date(now.getTime()+31000));const replay=await assertMixedOriginalEvidence(db,f);assert.equal(replay.evidenceCheckedAt?.toISOString(),first.evidenceCheckedAt?.toISOString());assert.ok(f.calls.filter(c=>c[0]==='query'&&c[1]==='CUSTOMER').length>=2);
 }finally{await db.$disconnect();}
});
test('persistent stopped queue reaches a later completed task behind twenty absent or failing originals',async()=>{
 const db=new Db();try{const fixtures:any[]=[],baseTime=Date.now()-120000;
 for(let i=0;i<20;i++){const f=await fixture(db),p=f.task.parties.find((p:any)=>p.role==='CUSTOMER'),consent={taskId:f.task.id,role:p.role,actorId:p.subjectId,sourceSha256:f.task.sourceSha256};await db.electronicSigningParty.update({where:{id:p.id},data:{status:'ISSUED',attemptedAt:new Date(baseTime),manualConsent:consent,manualConsentHash:require('../src/customers/types').canonicalHash(consent)}});await db.electronicSigningTask.update({where:{id:f.task.id},data:{status:'WITHDRAWN',withdrawnAt:new Date(baseTime),uploadStatus:'UPLOADED',uploadedAt:new Date(baseTime-1000),updatedAt:new Date(baseTime+i)}});if(i===0)f.provider.querySigner=async()=>{throw new Error('synthetic outage');};fixtures.push(f);}
 const completed=await migratedSignedFixture(db,false,true);fixtures.push(completed);const ids=fixtures.map(f=>f.task.id),now=new Date(),scoped:any={electronicSigningTask:{findMany:async(q:any)=>db.electronicSigningTask.findMany({...q,where:{AND:[q.where,{id:{in:ids}}]}}),updateMany:(q:any)=>db.electronicSigningTask.updateMany(q)}};
 const service:any={advance:async()=>{throw new Error('no live task expected');},reconcileStopped:async(id:string)=>fixtures.find(f=>f.task.id===id).service.reconcileStopped(id)};
 await reconcileElectronicBatch(scoped,service,now);assert.equal((await db.electronicSigningTask.findUniqueOrThrow({where:{id:completed.task.id}})).stoppedEvidenceId,null);await reconcileElectronicBatch(scoped,service,now);assert.ok((await db.electronicSigningTask.findUniqueOrThrow({where:{id:completed.task.id}})).stoppedEvidenceId);assert.equal(await db.electronicSigningTask.count({where:{id:{in:ids.slice(0,20)},recoveryNextCheckAt:{gt:now}}}),20);assert.equal(completed.activationCount(),0);
 }finally{await db.$disconnect();}
});

test('loss of enterprise authority after customer signature falls back both unissued enterprises to manual',async()=>{
 const db=new Db();try{const f=await fixture(db,true);await f.service.start(f.admin,f.task.id,await f.command());await f.sign(f.customer);f.signed.add('CUSTOMER');f.parties[1].autoAuthority!.enabled=false;
 await f.service.sync(f.customer,f.task.id,await f.command());const rows=await db.electronicSigningParty.findMany({where:{taskId:f.task.id}});
 assert.ok(rows.filter(p=>p.role!=='CUSTOMER').every(p=>p.mode==='MANUAL'&&!p.attemptedAt));assert.equal(f.calls.some(c=>c[0]==='auto'),false);
 }finally{await db.$disconnect();}
});
test('after owner signature revocation preserves that proof and only pending platform changes to manual',async()=>{
 const db=new Db();try{const f=await fixture(db,true),auto=f.provider.autoSign;
 f.provider.autoSign=async(d:any,p:any)=>{const result=await auto(d,p);if(p.role==='OWNER')f.parties[2].autoAuthority!.enabled=false;return result;};
 await f.service.start(f.admin,f.task.id,await f.command());await f.sign(f.customer);f.signed.add('CUSTOMER');await f.service.sync(f.customer,f.task.id,await f.command());
 const rows=await db.electronicSigningParty.findMany({where:{taskId:f.task.id}}),owner=rows.find(p=>p.role==='OWNER')!,platform=rows.find(p=>p.role==='PLATFORM')!;
 assert.equal(owner.status,'SIGNED');assert.equal(owner.mode,'AUTO');assert.equal(platform.mode,'MANUAL');assert.equal(platform.attemptedAt,null);assert.equal(f.calls.filter(c=>c[0]==='auto').length,1);
 }finally{await db.$disconnect();}
});

import {OwnerAuthorizationService} from '../src/owner-signing/authorization';
test('dispatch holds the same enterprise row lock as real technical revocation; accepted signature is retained',async()=>{
 const db=new Db();try{
 const f=await fixture(db,true),grant=await db.ownerAutoAuthority.create({data:{ownerId:f.owner.id,sealId:'synthetic',providerCustomerId:'synthetic-owner',providerSignatureId:'synthetic-seal',certificateSerialNo:'synthetic-cert',providerContractId:randomUUID(),providerTransactionId:randomUUID(),requestedBy:'synthetic-person',idempotencyKey:randomUUID(),requestHash:'a'.repeat(64),scope:{},scopeHash:'a'.repeat(64),consentSnapshot:{},method:'PROVIDER_AUTO_GRANT',status:'AUTHORIZED',enabled:true,checkedAt:new Date()}});
 let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),released=new Promise<void>(r=>release=r),auto=f.provider.autoSign;
 f.provider.autoSign=async(d:any,p:any)=>{if(p.role==='OWNER'){enter();await released;}return auto(d,p);};
 const service=new ElectronicDocumentService(db,f.provider,new ContractPdfArtifactWriterService(db),{resolveParties:async(_tx:any,_id:string,_now:Date,completed:any[]=[])=>{const current=await _tx.ownerAutoAuthority.findUnique({where:{id:grant.id}});return f.parties.map(p=>completed.find(s=>s.role===p.role)??({...structuredClone(p),...(p.autoAuthority?{autoAuthority:{...p.autoAuthority,enabled:current.enabled}}:{})}));},requireOwnerActor:async()=>({} as any)});
 await service.start(f.admin,f.task.id,await f.command());await service.sign(f.customer,f.task.id,await f.command({sourceSha256:f.source.sha256,accepted:true}));f.signed.add('CUSTOMER');
 const advancing=service.sync(f.customer,f.task.id,await f.command());await entered;
 await assert.rejects(db.$transaction(tx=>tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id=${f.owner.id} FOR UPDATE NOWAIT`));
 const revoker=new OwnerAuthorizationService(db,{} as any,{} as any),pausing=revoker.pause(f.operator.id,f.owner.id,grant.id);
 let waiting=false;for(let i=0;i<100&&!waiting;i++){const rows:any[]=await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%VehicleOwner%'`;waiting=rows.length>0;if(!waiting)await new Promise(r=>setTimeout(r,10));}release();assert.equal(waiting,true,'revocation must wait on the dispatch owner lock');await Promise.all([advancing,pausing]);
 await service.sync(f.admin,f.task.id,await f.command());const rows=await db.electronicSigningParty.findMany({where:{taskId:f.task.id}});assert.equal(rows.find(p=>p.role==='OWNER')!.status,'SIGNED');assert.equal(rows.find(p=>p.role==='PLATFORM')!.mode,'MANUAL');assert.equal(f.calls.filter(c=>c[0]==='auto').length,1);
 }finally{await db.$disconnect();}
});
