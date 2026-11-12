import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {authorityFixture} from './v31-authority-fixture';import {seedV31Subscription} from './v31-cooperation-fixture';
import {ElectronicDocumentService} from '../src/electronic-documents/service';import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
import {syntheticSigningTime,syntheticFinalVerification} from './electronic-fixtures';import {activateElectronicCooperation} from '../src/electronic-documents/cooperation';import {archiveSealGrant} from '../src/electronic-documents/seal-authorization';import {activateElectronicSubscription} from '../src/electronic-documents/subscription';import {canonicalHash} from '../src/customers/types';

test('initial 02-main independent 02-grant and 01 prepare through manual signature proof and archive using unmodified default15s transactions',async()=>{
 const h=new JourneyHarness(),saved={...process.env};try{await h.start();Object.assign(process.env,{NEW_ORDER_CONTRACT_MODE:'ELECTRONIC',CONTRACT_CJK_FONT_PATH:'C:/Windows/Fonts/msyh.ttc',CONTRACT_CJK_FONT_FACE:'MicrosoftYaHei',CONTRACT_CJK_BOLD_FONT_PATH:'C:/Windows/Fonts/msyhbd.ttc',CONTRACT_CJK_BOLD_FONT_FACE:'MicrosoftYaHei-Bold'});
 const f=await authorityFixture(h),signed=new Set<string>();
 const provider:any={upload:async()=>({evidenceHash:'a'.repeat(64)}),manualUrl:async()=>({url:'https://synthetic.invalid/'}),querySigner:async(_d:any,p:any)=>({...syntheticSigningTime(new Date()),status:signed.has(p.transactionId)?'SIGNED':'ABSENT',evidenceHash:'b'.repeat(64)}),fileContract:async()=>({evidenceHash:'c'.repeat(64)}),downloadFinal:async()=>({bytes:Buffer.from('%PDF-1.7\nSynthetic initial candidate final proof '+randomUUID()+'\n%%EOF')}),verifyFinalFile:async(task:any,bytes:Buffer)=>syntheticFinalVerification(task,createHash('sha256').update(bytes).digest('hex'))};
 const service=new ElectronicDocumentService(h.db,provider,new ContractPdfArtifactWriterService(h.db),{afterArchive:async(tx:any,t:any)=>t.kind==='COOPERATION_GRANT'?archiveSealGrant(tx,t):t.kind==='COOPERATION'?activateElectronicCooperation(tx,t):activateElectronicSubscription(tx,t)});
 const actor=(company:any)=>({kind:'OWNER' as const,id:company.person.id,ownerId:company.owner.id});
 async function finish(task:any,actors:any[]){const started=Date.now();let current=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});await service.start({kind:'ADMIN',id:h.maker.id},task.id,command(current.revision));for(const person of actors){current=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});await service.sign(person,task.id,{...command(current.revision),sourceSha256:task.sourceSha256,accepted:true});const party=await h.db.electronicSigningParty.findFirstOrThrow({where:{taskId:task.id,role:person.kind==='CUSTOMER'?'CUSTOMER':person.ownerId===f.owner.owner.id?'OWNER':'PLATFORM'}});signed.add(party.transactionId);current=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});await service.sync(person,task.id,command(current.revision));}const result=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id},include:{parties:true}});assert.equal(result.status,'ARCHIVED');assert.ok(result.finalSha256);assert.ok(result.parties.every(p=>p.status==='SIGNED'&&p.queryEvidenceHash));console.log('SYNTHETIC_DEFAULT15S',result.kind,Date.now()-started);}
 await finish(f.grantTask,[actor(f.owner),actor(f.platform)]);await finish(f.task,[actor(f.owner),actor(f.platform)]);
 const sub=await seedV31Subscription(h.db,{actor:await h.db.adminUser.findUniqueOrThrow({where:{id:h.maker.id}}),owner:f.owner.owner,platform:f.platform.owner,vehicle:f.car,draft:{latestVersion:f.agreement.latestVersion},v31Sources:{productVersionIds:[f.product.id],templateRefs:[{id:f.subscription.id}]}});
 await h.db.eSignAccount.update({where:{customerId:sub.customer.id},data:{certSubjectHash:canonicalHash({customerId:sub.customer.id})}});
 const b:any=sub.order.finalPlanSnapshot;b.agreedFeeComponents={baseFeeAmount:b.productSnapshot.baseFeeAmount,mileageMonthlyFeeAmount:b.productSnapshot.mileageMonthlyFeeAmount};b.creditBand='GE750';b.creditRuleVersion='ZHIMA_MANUAL_V1';delete b.commercialHash;b.commercialHash=canonicalHash(b);await h.db.order.update({where:{id:sub.order.id},data:{finalPlanSnapshot:b}});await h.db.contract.updateMany({where:{orderId:sub.order.id},data:{documentHash:b.commercialHash}});
 const prepared=await service.prepare({kind:'ADMIN',id:h.maker.id},{kind:'SUBSCRIPTION',resourceId:sub.order.id,revision:sub.order.revision,idempotencyKey:randomUUID()});
 await finish(prepared,[{kind:'CUSTOMER',id:sub.customer.id},actor(f.owner),actor(f.platform)]);
 // Read complete authenticated PDF bodies, not just hrefs or 200 status.
 for(const task of [f.task,f.grantTask,prepared]){
  const current=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});
  for(const [variant,digest]of [['source',current.sourceSha256],['signed',current.finalSha256]]){
   const response=await fetch(`${h.base}/api/admin/electronic-documents/${task.id}/files/${variant}`,{headers:h.maker.headers});
   assert.equal(response.status,200);assert.match(response.headers.get('content-type')||'',/application\/pdf/);
   const bytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),digest);assert.ok(bytes.subarray(0,5).equals(Buffer.from('%PDF-')));
  }
 }
 const dependencies=await h.get(`/admin/electronic-documents/${prepared.id}/dependencies`);assert.ok(dependencies.items.some((item:any)=>item.id===f.task.id));
 const dependency=await h.get(`/admin/electronic-documents/${prepared.id}/dependencies/${f.task.id}`);assert.equal(dependency.id,f.task.id);
 const source=await fetch(`${h.base}/api/admin/electronic-documents/${dependency.id}/files/source`,{headers:h.maker.headers});const dependencyBytes=Buffer.from(await source.arrayBuffer());assert.equal(source.status,200);assert.equal(createHash('sha256').update(dependencyBytes).digest('hex'),dependency.sourceSha256);
 assert.equal(h.externalCalls+h.realSmsSends+h.identityCalls+h.esignCalls+h.payment.providerCalls,0);
 }finally{await h.close();for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
