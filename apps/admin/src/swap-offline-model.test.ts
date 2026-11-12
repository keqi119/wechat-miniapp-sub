import test from 'node:test';
import assert from 'node:assert/strict';
import {swapContextSafe,swapDetailSafe} from './swap.ts';
import {delayArchivePayload} from './delay-offline.ts';
import {swapTestContext,swapTestDetail,swapTestHash} from './swap-offline-fixture.ts';
import {offlineSwapPreviewPayload,offlineSwapPreviewSafe,offlineSwapQuotePayload} from './swap-offline-model.ts';
import {swapTestTarget,swapTestPreview} from './swap-offline-fixture.ts';

test('explicit current stage keeps its own dates and permits genuine historical TERM/cycle rows',()=>{
 const raw=swapTestContext(),value=swapContextSafe(raw);
 assert.equal(value.swapAccount.canRequest,true);assert.equal(value.swapAccount.term?.startDate,'2026-10-01');assert.equal((value.swapAccount as any).serviceStageId,'stage-2');assert.equal((value.swapAccount.reservations[0] as any).serviceStageId,null);
 assert.equal(value.swapAccount.reservations[0].termSequence,5);assert.equal(value.swapAccount.ledger[0].cycleSequence,1);
 raw.swapAccount.endDate='2028-09-30';assert.equal(swapContextSafe(raw).swapAccount.term?.endDate,'2027-10-01');
});
test('automatic quote sends source facts only, preserves exact viewed inputs, and rejects invalid returned dates',()=>{
 const d=swapTestDetail(),draft={plannedReturnAt:'2026-11-01T09:00',plannedDeliveryAt:'2026-11-01T10:00',expiresAt:'2099-12-31T00:00',depositAmount:'123.45',depositBasis:'明确依据',insuranceResponsibility:'实际责任',downtimeArrangement:'当天安排',settlementExplanation:'逐期核对',handoverArrangement:'分别交还和交付',cancellationTerms:'真实约定',reason:'本人申请'};
 const input=offlineSwapPreviewPayload(d,draft,swapTestTarget);assert.equal(input.depositAmount,12345);assert.equal(input.plannedDeliveryAt,'2026-11-01T02:00:00.000Z');for(const k of ['targetVehicleId','periods','newMonthlyFeeAmount','handoverFeeAmount'])assert.equal(k in input,false);
 assert.throws(()=>offlineSwapPreviewPayload(d,{...draft,depositAmount:'0.001'},swapTestTarget));
 const p:any={changeId:d.id,revision:d.revision,orderId:d.orderId,inputHash:swapTestHash,sourceHash:swapTestHash,previewHash:swapTestHash,pricingHash:swapTestHash,pricingVersion:2,financialGate:'BEFORE_RETURN',target:swapTestTarget,currentMonthlyFeeAmount:10000,targetMonthlyFeeAmount:20000,depositAmount:12345,depositNetPaidAmount:0,depositChargeAmount:12345,depositRefundAmount:0,handoverFeeAmount:0,periods:[{sequence:1,startDate:'2026-10-01',endDate:'2026-11-01',dueDate:'2026-02-31',amount:20000,originalAmount:10000,differenceAmount:10000,netPaidAmount:10000,carryAmount:10000,chargeAmount:10000,refundAmount:0}]};
 assert.throws(()=>offlineSwapPreviewSafe(p,d,input),/日期/);
 const seen={input,preview:{previewHash:swapTestHash}};assert.equal(offlineSwapQuotePayload(input,seen,'frozen-request-key').previewHash,swapTestHash);assert.throws(()=>offlineSwapQuotePayload({...input,reason:'changed'},seen,'frozen-request-key'),/重新预览/);
});
test('OFFLINE action capability is exact true with known stage identity, never mode inference',()=>{
 const raw=swapTestContext();raw.swapAccount.canRequest=false;assert.equal(swapContextSafe(raw).swapAccount.canRequest,false);
 raw.swapAccount.stageSourceHash='bad';assert.throws(()=>swapContextSafe(raw));
 const malformed=swapTestContext();malformed.swapAccount.reservations[0].serviceStageId='stage-2' as any;assert.throws(()=>swapContextSafe(malformed));
});
test('real v2 swap paper uses only the confirmed quote template and exact archive binding',()=>{
 const d:any={...swapTestDetail(),status:'AWAITING_ARCHIVE',quote:{id:'q',revision:1,pricingVersion:2,confirmedAt:'2026-10-31T01:00:00Z',document:{id:'doc',type:'OFFLINE_ORDER_AMENDMENT',version:1,templateHash:swapTestHash,bodyHash:swapTestHash,content:'客户确认正文'}},contract:{id:'contract',kind:'AMENDMENT',executionMode:'OFFLINE',delayQuoteId:'q',offlineArchiveId:null,status:'DRAFT'}};
 assert.deepEqual(delayArchivePayload(swapDetailSafe(d),'paper-stable-key'),{kind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:'q',templateId:'doc',revision:0,idempotencyKey:'paper-stable-key'});
 d.quote.pricingVersion=1;assert.throws(()=>delayArchivePayload(d,'paper-stable-key'));
});

test('preview must carry the same genuine current stage and contiguous months, not original account dates',()=>{
 const d=swapTestDetail(),input={targetListingId:swapTestTarget.targetListingId,targetListingRevision:4,targetSourceHash:swapTestHash,depositAmount:0},p:any=swapTestPreview(input,d);assert.equal(offlineSwapPreviewSafe(p,d,input).periods[0].sequence,13);
 const missing=structuredClone(p);delete missing.serviceStageScope;assert.throws(()=>offlineSwapPreviewSafe(missing,d,input),/阶段/);
 const different=structuredClone(p);different.serviceStageScope.serviceStageId='other-stage';assert.throws(()=>offlineSwapPreviewSafe(different,d,input),/阶段/);
 const gap=structuredClone(p);gap.periods[1].startDate='2026-11-02';assert.throws(()=>offlineSwapPreviewSafe(gap,d,input),/连续|边界/);
});
