import test from 'node:test';
import assert from 'node:assert/strict';
import {BaasService} from '../src/vehicle-baas/service';
import {baasTerms,validateCostPlan} from '../src/asset-costs/source';
import {hash} from '../src/common/data';
import {assetActor,assetCommand,assetError,assetFixture,assetNow,prepareBaasRegistration} from './asset-ledger-fixture';

async function fixture(){
 const f=assetFixture(),service=new BaasService(()=>assetNow);f.seed('vehicleAssetProfile',{vehicleId:'vehicle',revision:1,batteryOwnership:'BAAS'});
 const body={...assetCommand(),vehicleId:'vehicle',vehicleRevision:3,assetRevision:1,provider:'合成出租方',contractNumber:'BAAS-synthetic-existing',batteryPackage:'75kWh',effectiveFrom:'2027-01-01',effectiveTo:'2027-12-31',billingCycle:'MONTHLY' as const,rentalAmount:72800,paymentDayOfMonth:8};
 const current=await f.serial(tx=>service.create(tx,assetActor,body));return{...f,service,current,body};
}
const fieldError=(error:any)=>error.getStatus?.()===409&&error.getResponse?.().error?.code==='BAAS_PREVIOUS_CONTRACT'&&error.getResponse?.().error?.field==='previousContractId';

test('existing archived record accepts legacy 无 as no predecessor without querying a fictitious contract',async()=>{
 const f=await fixture();f.rows('vehicleBaasContract')[0].status='ARCHIVED';const reads:string[]=[],find=f.tx.vehicleBaasContract.findUnique;f.tx.vehicleBaasContract.findUnique=(query:any)=>{reads.push(query.where.id);return find(query);};
 const body={...assetCommand(),previousContractId:'无',changeReason:'补齐登记资料'},saved=await f.serial(tx=>f.service.update(tx,assetActor,f.current.id,body));
 assert.equal(saved.id,f.current.id);assert.equal(saved.previousContractId,null);assert.equal(saved.status,'ARCHIVED');assert.equal(saved.activatedAt,null);assert(!reads.includes('无'));assert.equal(f.rows('vehicleBaasContractRevision').length,0);assert.equal(f.rows('assetCostPlan').length,0);
 const writes=f.writes.length;assert.deepEqual(await f.serial(tx=>f.service.update(tx,assetActor,f.current.id,body)),saved);assert.equal(f.writes.length,writes);
 await assert.rejects(f.serial(tx=>f.service.update(tx,assetActor,f.current.id,{...body,previousContractId:null})),assetError('IDEMPOTENCY_CONFLICT'));
});

test('create and edit interpret blank or exact 无 only inside the command as explicit null',async()=>{
 for(const value of ['', '  ', '无', null]){
  const f=await fixture(),created=await f.serial(tx=>f.service.create(tx,assetActor,{...f.body,...assetCommand(),previousContractId:value}));assert.equal(created.previousContractId,null);
  const before=f.rows('vehicleBaasContract')[0],prior={...structuredClone(before),id:'prior-contract',activatedAt:assetNow,status:'TERMINATED'};f.seed('vehicleBaasContract',prior);
  const assigned=await f.serial(tx=>f.service.update(tx,assetActor,f.current.id,{...assetCommand(),previousContractId:prior.id}));assert.equal(assigned.previousContractId,prior.id);
  const kept=await f.serial(tx=>f.service.update(tx,assetActor,f.current.id,{...assetCommand(assigned.revision),notes:'省略承接字段时保持原关系'}));assert.equal(kept.previousContractId,prior.id);
  const cleared=await f.serial(tx=>f.service.update(tx,assetActor,f.current.id,{...assetCommand(kept.revision),previousContractId:value}));assert.equal(cleared.previousContractId,null);
 }
});

test('missing, foreign, self and never activated predecessors produce only a field-specific conflict and no writes',async()=>{
 const f=await fixture(),base=structuredClone(f.rows('vehicleBaasContract')[0]);
 for(const row of [{...base,id:'foreign-prior',vehicleId:'other-vehicle',status:'TERMINATED',activatedAt:assetNow},{...base,id:'unactivated-prior',status:'ARCHIVED',activatedAt:null},{...base,id:'draft-prior',status:'DRAFT',activatedAt:assetNow}])f.seed('vehicleBaasContract',row);
 for(const id of ['missing-prior','foreign-prior','unactivated-prior','draft-prior',f.current.id]){
  const writes=f.writes.length;await assert.rejects(f.serial(tx=>f.service.update(tx,assetActor,f.current.id,{...assetCommand(),previousContractId:id})),fieldError);assert.equal(f.writes.length,writes);
  await assert.rejects(f.serial(tx=>f.service.create(tx,assetActor,{...f.body,...assetCommand(),previousContractId:id==='missing-prior'?id:'foreign-prior'})),fieldError);assert.equal(f.writes.length,writes);
 }
});

test('a truly missing current record retains its original 404 instead of reporting a predecessor field error',async()=>{
 const f=await fixture();await assert.rejects(f.serial(tx=>f.service.update(tx,assetActor,'missing-current',{...assetCommand(),previousContractId:'无'})),(error:any)=>error.getStatus?.()===404&&error.getResponse?.().error?.code==='NOT_FOUND'&&!error.getResponse?.().error?.field);
});

test('previous successful legacy command replays its exact parsed hash without reapplying revised predecessor validation',async()=>{
 const f=await fixture(),body={revision:0,idempotencyKey:'legacy-previous-command-key',provider:'  合成更正方  ',previousContractId:'  prior-contract  ',changeReason:'旧版成功收据'};
 // This literal freezes the pre-fix schema order and trim behavior, independently of its current parser.
 const legacyParsed={provider:'合成更正方',previousContractId:'prior-contract',revision:0,idempotencyKey:body.idempotencyKey,changeReason:'旧版成功收据'},snapshot={id:f.current.id,legacyReceipt:true};
 f.seed('archiveCommand',{actorId:assetActor.id,resourceId:'asset:baas-contracts:'+f.current.id,action:'UPDATE_BAAS',key:body.idempotencyKey,requestHash:hash(legacyParsed),resultSnapshot:snapshot});const writes=f.writes.length;
 assert.deepEqual(await f.serial(tx=>f.service.update(tx,assetActor,f.current.id,body)),snapshot);assert.equal(f.writes.length,writes);
 f.revoke(assetActor.id);await assert.rejects(f.serial(tx=>f.service.update(tx,assetActor,f.current.id,body)),assetError('STAFF_SESSION_CHANGED'));
});

test('a successful legacy create receipt retains original field order, defaults and command hash',async()=>{
 const f=await fixture(),body={...f.body,idempotencyKey:'legacy-create-predecessor-key',previousContractId:'  historical-prior  '};
 const legacyParsed={provider:'合成出租方',contractNumber:'BAAS-synthetic-existing',supplierContractNumber:'',batteryPackage:'75kWh',batterySerialNumber:'',effectiveFrom:'2027-01-01',effectiveTo:'2027-12-31',billingCycle:'MONTHLY',rentalAmount:72800,paymentDayOfMonth:8,graceDays:0,invoiceRequired:false,taxIncluded:null,currency:'CNY',notes:'',previousContractId:'historical-prior',revision:0,idempotencyKey:body.idempotencyKey,vehicleId:'vehicle',vehicleRevision:3,assetRevision:1};
 const snapshot={id:'historical-created-contract',legacyCreate:true};f.seed('archiveCommand',{actorId:assetActor.id,resourceId:'asset:baas-contracts:NEW',action:'CREATE_BAAS',key:body.idempotencyKey,requestHash:hash(legacyParsed),resultSnapshot:snapshot});const writes=f.writes.length;
 assert.deepEqual(await f.serial(tx=>f.service.create(tx,assetActor,body)),snapshot);assert.equal(f.writes.length,writes);
});

test('legacy none does not alter stored 16-field terms or old generated plan validation',async()=>{
 const f=await fixture();f.attach('BAAS',f.current.id);prepareBaasRegistration(f,f.current.id);const active=await f.serial(tx=>f.service.transition(tx,assetActor,f.current.id,'activate',{...assetCommand(),reason:'核对原件'})),request={fromPeriod:'2027-01',toPeriod:'2027-01'},preview=await f.service.preview(f.tx,assetActor,f.current.id,request);
 await f.serial(tx=>f.service.generate(tx,assetActor,f.current.id,{...assetCommand(active.revision),...request,previewHash:preview.previewHash,acknowledgedWarningIds:preview.warningIds}));
 const before=structuredClone(f.rows('vehicleBaasContract')[0]),plan=structuredClone(f.rows('assetCostPlan')[0]),terms=baasTerms(before);
 const saved=await f.serial(tx=>f.service.update(tx,assetActor,f.current.id,{...assetCommand(before.revision),previousContractId:'无',changeReason:'无承接合同'}));
 assert.equal(saved.termsHash,before.termsHash);assert.deepEqual(baasTerms(f.rows('vehicleBaasContract')[0]),terms);assert.equal(Object.keys(terms).length,16);assert.equal(f.rows('vehicleBaasContractRevision').length,0);assert.deepEqual(f.rows('assetCostPlan')[0],plan);assert.equal((await validateCostPlan(f.tx,plan)).revision,saved.revision);assert.equal(f.rows('assetCostEntry').length,0);
});
