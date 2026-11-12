import test from 'node:test';
import assert from 'node:assert/strict';
import {readFields} from './domain-commands.ts';
import {terminationFields,terminationInitial,terminationDetailsBody,terminationReadiness,type TerminationContext} from './termination-details-model.ts';
const context:TerminationContext={originalContract:{archiveId:'a',versionId:'v',version:1,name:'原签订合同',number:'RENT-1',signedOn:'2026-10-01',businessSnapshotHash:'hash'},relevantTerms:{earlyTerminationRule:'原约定',depositRefundRule:'原押金约定'},delivery:{state:'NOT_DELIVERED'},funds:{receivedAmount:1,refundedAmount:1,netReceivedAmount:0,depositReceivedAmount:0,depositRefundedAmount:0},blockers:[]};
const input={reasonType:'CUSTOMER_REQUEST',reason:'客户申请终止',effectiveAt:'2026-10-30T09:00',violationStatus:'NOT_APPLICABLE',violationSummary:'未交付不适用',additionalPaymentAmount:'0',refundAmount:'0.01',refundDueOn:'2026-11-01',retainedDepositAmount:'0',retainedDepositHandling:'无保留款',settlementBasis:'各方协商并核对原合同',unresolvedMatters:'无'};
test('termination form never derives settlement amounts from receipts and converts explicit yuan exactly once',()=>{
 const initial=terminationInitial(undefined,context);assert.equal(initial.refundAmount,'');assert.equal(initial.additionalPaymentAmount,'');assert.equal(initial.retainedDepositAmount,'');
 const body=terminationDetailsBody(readFields(terminationFields(context),input),context);assert.equal(body.refundAmount,1);assert.equal(body.additionalPaymentAmount,0);assert.equal(body.effectiveAt,'2026-10-30T01:00:00.000Z');assert.match(body.conditionSummary,/未交付/);assert.equal(body.plannedReturnAt,undefined);
 assert.equal(terminationInitial(body,context).refundAmount,'0.01');assert.equal(terminationInitial(body,context).effectiveAt,'2026-10-30T09:00');
});
test('nonzero financial adjustments and pending matters need specific deadlines, not placeholders',()=>{
 const raw=readFields(terminationFields(context),input);
 assert.throws(()=>terminationDetailsBody({...raw,refundDueOn:''},context),/退款期限/);
 assert.throws(()=>terminationDetailsBody({...raw,additionalPaymentAmount:10},context),/付款期限/);
 assert.throws(()=>terminationDetailsBody({...raw,retainedDepositAmount:100,retainedDepositHandling:'待处理'},context),/保留款.*期限/);
 assert.throws(()=>terminationDetailsBody({...raw,violationStatus:'PENDING',violationSummary:'待处理'},context),/违章.*期限/);
 assert.doesNotThrow(()=>terminationDetailsBody({...raw,retainedDepositAmount:100,retainedDepositHandling:'七个工作日内核对后退回'},context));
});
test('return plan is explicit until physical receipt exists and frozen source blockers prevent generation',()=>{
 const awaiting={...context,delivery:{state:'AWAITING_RETURN' as const,deliveryId:'h'}};
 const fields=terminationFields(awaiting);assert(fields.find(f=>f.key==='plannedReturnAt')?.required);assert(fields.find(f=>f.key==='returnPlace')?.required);
 assert.throws(()=>terminationDetailsBody({...readFields(terminationFields(context),input),conditionSummary:'待现场查验'},awaiting),/计划交回/);
 const details=terminationDetailsBody(readFields(fields,{...input,conditionSummary:'交回时按现场查验记录确认',plannedReturnAt:'2026-11-01T10:00',returnPlace:'约定停车场'}),awaiting);assert.equal(details.returnPlace,'约定停车场');assert.equal(details.plannedReturnAt,'2026-11-01T02:00:00.000Z');
 assert.equal(terminationReadiness(details,awaiting),'');assert.match(terminationReadiness(details,{...awaiting,blockers:[{code:'MISSING',message:'原冻结条款缺失'}]}),/原冻结条款缺失/);assert.match(terminationReadiness(details,null),/读取/);
});
test('unconfirmed delivery allows arrangement drafts without asserting receipt, but never allows generation',()=>{
 const unknown={...context,delivery:{state:'UNKNOWN' as const}};
 const fields=terminationFields(unknown);assert.equal(fields.some(f=>f.key==='plannedReturnAt'),false);
 const details=terminationDetailsBody(readFields(fields,{...input,conditionSummary:'先核实交付及收车原始记录'}),unknown);
 assert.equal(details.conditionSummary,'先核实交付及收车原始记录');assert.equal(details.plannedReturnAt,undefined);
 assert.match(terminationReadiness(details,unknown),/待核实/);
});
