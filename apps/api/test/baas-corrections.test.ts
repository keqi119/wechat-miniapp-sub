import test from 'node:test';
import assert from 'node:assert/strict';
import {BaasService} from '../src/vehicle-baas/service';
import {AssetCostsService} from '../src/asset-costs/service';
import {AssetCostPlansService} from '../src/asset-costs/plans';
import {validateCostPlan} from '../src/asset-costs/source';
import {canonicalHash} from '../src/customers/types';
import {assetActor,assetCommand,assetError,assetFixture,assetNow,financeActor,prepareBaasRegistration} from './asset-ledger-fixture';

async function registered(active=true){
 const f=assetFixture(),service=new BaasService(()=>assetNow);f.seed('vehicleAssetProfile',{vehicleId:'vehicle',revision:1,batteryOwnership:'BAAS'});
 const draft=await f.serial(tx=>service.create(tx,assetActor,{...assetCommand(),vehicleId:'vehicle',vehicleRevision:3,assetRevision:1,provider:'合成出租方',contractNumber:'synthetic-correction',batteryPackage:'75kWh',effectiveFrom:'2027-01-01',effectiveTo:'2027-12-31',billingCycle:'MONTHLY',rentalAmount:72800,paymentDayOfMonth:8}));
 f.attach('BAAS',draft.id);prepareBaasRegistration(f,draft.id);const contract=active?await f.serial(tx=>service.transition(tx,assetActor,draft.id,'activate',{...assetCommand(),reason:'核对原件'})):draft;return{...f,service,contract};
}
async function generate(f:Awaited<ReturnType<typeof registered>>,period:string){const row=f.rows('vehicleBaasContract')[0],request={fromPeriod:period,toPeriod:period},preview=await f.service.preview(f.tx,assetActor,row.id,request);return f.serial(tx=>f.service.generate(tx,assetActor,row.id,{...assetCommand(row.revision),...request,previewHash:preview.previewHash,acknowledgedWarningIds:preview.warningIds}));}

test('correcting activated terms preserves original plans, payments and their source revision intervals',async()=>{
 const f=await registered(),costs=new AssetCostsService(()=>assetNow),plans=new AssetCostPlansService(()=>assetNow);
 const first=await generate(f,'2027-01'),second=await generate(f,'2027-02'),before=structuredClone(f.rows('assetCostPlan'));
 // Attachments and metadata advance aggregate revision without changing its terms.
 f.rows('vehicleBaasContract')[0].revision+=2;const current=f.rows('vehicleBaasContract')[0],oldRevision=current.revision;
 const body={...assetCommand(oldRevision),rentalAmount:80000,changeReason:'原件租金登记更正'};
 const corrected=await f.serial(tx=>f.service.update(tx,assetActor,current.id,body));
 assert.equal(corrected.status,'ACTIVE');assert.equal(corrected.rentalAmount,80000);assert.deepEqual(f.rows('assetCostPlan'),before);
 const history=f.rows('vehicleBaasContractRevision');assert.equal(history.length,1);assert.equal(history[0].fromRevision,0);assert.equal(history[0].toRevision,oldRevision);assert.equal(history[0].termsSnapshot.rentalAmount,72800);assert.equal(history[0].firstCostPeriod,'2027-01');
 assert.equal(history[0].termsHash,canonicalHash(history[0].termsSnapshot));assert.equal(history[0].changeReason,'原件租金登记更正');
 const writes=f.writes.length;assert.deepEqual(await f.serial(tx=>f.service.update(tx,assetActor,current.id,body)),corrected);assert.equal(f.writes.length,writes);
 for(const p of f.rows('assetCostPlan')){const source=await validateCostPlan(f.tx,p);assert.equal(source.revision,corrected.revision);assert.equal(source.terms.rentalAmount,72800);}
 const confirmed=await f.serial(tx=>costs.confirm(tx,financeActor,{idempotencyKey:assetCommand().idempotencyKey,plans:[{id:first.created[0].id,revision:0}]}));const entry=confirmed.entries[0];
 f.attach('COST',entry.id,'payment-evidence');
 const paid=await f.serial(tx=>costs.manualPayment(tx,financeActor,entry.id,{...assetCommand(entry.revision),paidAt:'2027-02-14',referenceNo:'synthetic-only',reason:'合成人工登记',fileIds:['payment-evidence']}));assert.equal(paid.payments[0].amount,72800);
 const voided=await f.serial(tx=>costs.voidPayment(tx,financeActor,entry.id,paid.payments[0].id,{...assetCommand(paid.revision),recordRevision:paid.payments[0].revision,reason:'合成撤销'}));
 await f.serial(tx=>costs.reverse(tx,financeActor,entry.id,{...assetCommand(voided.revision),reason:'合成冲正'}));
 const pending=second.created[0],voidedPlan=await f.serial(tx=>plans.void(tx,assetActor,pending.id,{...assetCommand(),reason:'保留旧期间'}));
 const reopen=await plans.reopenPreview(f.tx,assetActor,pending.id);await f.serial(tx=>plans.reopen(tx,assetActor,pending.id,{...assetCommand(voidedPlan.revision),sourceRevision:corrected.revision,previewHash:reopen.previewHash,reason:'沿原条款恢复'}));
 const next=await generate(f,'2027-03');assert.equal(next.created[0].amount,80000);assert.equal(f.rows('assetManualPaymentRecord')[0].amount,72800);assert.equal(f.rows('assetManualPaymentRecord')[0].status,'VOIDED');
 const again=await f.serial(tx=>f.service.update(tx,assetActor,current.id,{...assetCommand(f.rows('vehicleBaasContract')[0].revision),rentalAmount:72800,changeReason:'第二次修正'}));
 assert.equal(f.rows('vehicleBaasContractRevision')[1].fromRevision,oldRevision+1);assert.equal((await validateCostPlan(f.tx,f.rows('assetCostPlan')[2])).terms.rentalAmount,80000);assert.equal(again.rentalAmount,72800);
});

test('non-draft correction requires a reason, preserves lifecycle, and metadata does not invent a terms revision',async()=>{
 const f=await registered(false),row=f.rows('vehicleBaasContract')[0];row.status='ARCHIVED';row.archivedAt=assetNow;
 await assert.rejects(f.serial(tx=>f.service.update(tx,assetActor,row.id,{...assetCommand(),lesseeName:'新承租人'})),assetError('BAAS_CHANGE_REASON_REQUIRED'));
 const corrected=await f.serial(tx=>f.service.update(tx,assetActor,row.id,{...assetCommand(),lesseeName:'合成 登记车主',changeReason:'补齐登记'}));assert.equal(corrected.status,'ARCHIVED');assert.equal(corrected.activatedAt,null);assert.equal(f.rows('vehicleBaasContractRevision').length,0);
 const log=f.rows('auditLog').at(-1);assert.equal(log.data.changeReason,'补齐登记');assert.equal(log.data.metadataAfter.lesseeName,'合成 登记车主');
 assert.equal(corrected.recentChanges[0].changeReason,'补齐登记');assert.equal(corrected.recentChanges[0].termsChanged,false);assert.deepEqual(corrected.recentChanges[0].metadataFields,['lesseeName']);assert.equal(corrected.recentChanges[0].createdBy,assetActor.id);assert(!JSON.stringify(corrected.recentChanges).includes('lessorCollectionAccountInfo'));
 await assert.rejects(f.serial(tx=>f.service.update(tx,financeActor,row.id,{...assetCommand(corrected.revision),notes:'越权',changeReason:'不允许'})),assetError('FORBIDDEN'));
 const active=await f.serial(tx=>f.service.transition(tx,assetActor,row.id,'activate',{...assetCommand(corrected.revision),reason:'主动核对启用'}));assert.equal(active.status,'ACTIVE');
 await assert.rejects(f.serial(tx=>f.service.update(tx,assetActor,row.id,{...assetCommand(active.revision),provider:null,changeReason:'清空'})),assetError('BAAS_DRAFT_INCOMPLETE'));
 await assert.rejects(f.serial(tx=>f.service.update(tx,assetActor,row.id,{...assetCommand(active.revision),notes:'旧版本',changeReason:'旧版本'})).then(()=>f.service.update(f.tx,assetActor,row.id,{...assetCommand(active.revision),notes:'迟到版本',changeReason:'迟到版本'})),assetError('REVISION_CONFLICT'));
});

test('historical plan validation rejects wrong interval, altered historical terms, and missing trusted history',async()=>{
 const f=await registered();await generate(f,'2027-01');const row=f.rows('vehicleBaasContract')[0];await f.serial(tx=>f.service.update(tx,assetActor,row.id,{...assetCommand(row.revision),notes:'条款备注更正',changeReason:'核对原件'}));
 const history=f.rows('vehicleBaasContractRevision')[0],plan=f.rows('assetCostPlan')[0],saved=structuredClone(history);
 history.fromRevision=plan.sourceRevision+1;await assert.rejects(validateCostPlan(f.tx,plan),assetError('COST_SOURCE_MISMATCH'));Object.assign(history,saved);
 history.termsSnapshot.rentalAmount=1;await assert.rejects(validateCostPlan(f.tx,plan),assetError('COST_SOURCE_MISMATCH'));Object.assign(history,structuredClone(saved));
 f.rows('vehicleBaasContractRevision').splice(0);await assert.rejects(validateCostPlan(f.tx,plan),assetError('COST_SOURCE_MISMATCH'));
});

test('new cost generation requires current contract evidence inside the command but successful replay survives later disposal',async()=>{
 const f=await registered(),row=f.rows('vehicleBaasContract')[0],request={fromPeriod:'2027-01',toPeriod:'2027-01'},preview=await f.service.preview(f.tx,assetActor,row.id,request),body={...assetCommand(row.revision),...request,previewHash:preview.previewHash,acknowledgedWarningIds:preview.warningIds};
 const made=await f.serial(tx=>f.service.generate(tx,assetActor,row.id,body));f.rows('assetPrivateFile').splice(0);
 assert.deepEqual(await f.serial(tx=>f.service.generate(tx,assetActor,row.id,body)),made);
 const next={fromPeriod:'2027-02',toPeriod:'2027-02'},fresh=await f.service.preview(f.tx,assetActor,row.id,next);await assert.rejects(f.serial(tx=>f.service.generate(tx,assetActor,row.id,{...assetCommand(f.rows('vehicleBaasContract')[0].revision),...next,previewHash:fresh.previewHash,acknowledgedWarningIds:fresh.warningIds})),assetError('ASSET_FILES_REQUIRED'));
});
