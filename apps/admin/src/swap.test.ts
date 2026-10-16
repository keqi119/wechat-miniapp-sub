import {test} from 'node:test';
import assert from 'node:assert/strict';
import {swapQuotePayload,swapQuoteDraft,swapCreatePayload,swapActionAllowed,swapActionPayload,swapHandoverPayload,swapDetailSafe,assignmentLabel,segmentEvidencePayload} from './swap.ts';
import {resourceAccessible,resourceWritable,actionAllowed,detailFor} from './resources.ts';
import {changeListPath} from './change-list.ts';
import {fieldsForAction} from './form.ts';
const key='qa-stable-request-key';
const draft={targetVehicleId:'qa-target',plannedReturnAt:'2026-10-20T09:00',plannedDeliveryAt:'2026-10-21T11:00',newMonthlyFeeAmount:'5000.01',depositAmount:'10000.02',handoverFeeAmount:'0',handoverFeeBasis:'本次交接费用协商免除',depositBasis:'沿用并补足本次约定押金',insuranceResponsibility:'按核对的目标车保险资料承担责任',downtimeArrangement:'明确无车间隔安排',settlementExplanation:'本次应退款与本期款项核清后交旧车',handoverArrangement:'先还旧车，后交新车',cancellationTerms:'按逐单已协商取消责任执行',reason:'客户申请换车',expiresAt:'2099-01-01T12:00',externalCompensationRequired:'false',periods:[{sequence:1,amount:'5000.01',dueDate:'2026-10-20',calculationBasis:'明确该期协商结果'}]};
test('swap quote uses typed integer cents, original sequences, explicit Shanghai times and no guessed allocation',()=>{
 const body=swapQuotePayload(3,[1],draft,key);assert.equal(body.newMonthlyFeeAmount,500001);assert.equal(body.depositAmount,1000002);assert.equal(body.handoverFeeAmount,0);assert.equal(body.plannedReturnAt,'2026-10-20T01:00:00.000Z');assert.equal(body.plannedDeliveryAt,'2026-10-21T03:00:00.000Z');assert.equal(body.externalCompensationRequired,false);assert.deepEqual(body.periods,[{sequence:1,amount:500001,dueDate:'2026-10-20',calculationBasis:draft.periods[0].calculationBasis}]);assert.equal('paidAmount'in body,false);assert.equal('newStartDate'in body,false);
});
test('quote rejects precision, negative, blank money, missing periods, duplicate sequences and missing responsibility',()=>{
 for(const bad of ['-1','0.001',''])assert.throws(()=>swapQuotePayload(3,[1],{...draft,handoverFeeAmount:bad},key));
 assert.throws(()=>swapQuotePayload(3,[1,2],draft,key),/订阅期/);
 assert.throws(()=>swapQuotePayload(3,[1,2],{...draft,periods:[draft.periods[0],draft.periods[0]]},key),/订阅期/);
 assert.throws(()=>swapQuotePayload(3,[1],{...draft,downtimeArrangement:''},key),/无车/);
});
test('quote has no default compensation answer and cannot turn external compensation into negative refund',()=>{
 assert.throws(()=>swapQuotePayload(3,[1],{...draft,externalCompensationRequired:''},key),/明确选择/);
 assert.throws(()=>swapQuotePayload(3,[1],{...draft,externalCompensationRequired:'true'},key),/人工/);
 assert.throws(()=>swapQuotePayload(3,[1],{...draft,plannedDeliveryAt:'2026-10-19T11:00'},key),/交付/);
 assert.throws(()=>swapQuotePayload(3,[1],{...draft,expiresAt:'2020-01-01T12:00'},key),/未来/);
});
test('new monthly fee follows positive API DTO while explicit zero period/handover fee is valid',()=>{
 assert.throws(()=>swapQuotePayload(3,[1],{...draft,newMonthlyFeeAmount:'0'},key),/月费/);
 const body=swapQuotePayload(3,[1],{...draft,periods:[{...draft.periods[0],amount:'0'}]},key);assert.equal((body.periods as any[])[0].amount,0);assert.equal(body.handoverFeeAmount,0);
});
test('create/action require actual revision/hash and stable key, review is different finance actor',()=>{
 assert.deepEqual(swapCreatePayload({orderRevision:2,priorTermsHash:'qa-hash'},'真实换车原因',key),{expectedOrderRevision:2,priorTermsHash:'qa-hash',reason:'真实换车原因',idempotencyKey:key});
 assert.throws(()=>swapCreatePayload({orderRevision:2},'原因',key),/哈希/);
 assert.deepEqual(swapActionPayload('prepare-finance',3,{},key),{revision:3,idempotencyKey:key});
 assert.throws(()=>swapActionPayload('apply',3,{},key),/不支持/);
 const detail={kind:'VEHICLE_CHANGE',canReview:true,quote:{createdBy:'qa-creator'}};
 assert.equal(swapActionAllowed('review',detail,'FINANCE','qa-other'),true);assert.equal(swapActionAllowed('review',detail,'ADMIN','qa-creator'),false);assert.equal(swapActionAllowed('review',detail,'OPERATIONS','qa-other'),false);
});
test('capabilities must be exact true, wrong kind/support cannot mutate or fake B3 purchase',()=>{
 assert.equal(swapActionAllowed('complete',{kind:'VEHICLE_CHANGE',canComplete:true},'OPERATIONS','qa-operator'),true);
 for(const value of [false,undefined,'true',1])assert.equal(swapActionAllowed('complete',{kind:'VEHICLE_CHANGE',canComplete:value},'ADMIN','qa-admin'),false);
 assert.equal(swapActionAllowed('quotes',{kind:'DELIVERY_DELAY',canQuote:true},'ADMIN','qa-admin'),false);
 assert.equal(swapActionAllowed('quotes',{kind:'VEHICLE_CHANGE',canQuote:true},'SUPPORT','qa-support'),false);
 assert.equal(swapActionAllowed('purchase',{kind:'VEHICLE_CHANGE',canPurchase:true},'ADMIN','qa-admin'),false);
});
test('separate sides send own real reading/ISO facts and never vehicle/client signed overrides',()=>{
 const body=swapHandoverPayload(4,'DELIVERY',{actualAt:'2026-10-21T11:00',readingKm:100,fileIds:['qa-evidence'],checklist:[{label:'实际交接时间地点',value:'合成验收事实'}],vehicleId:'injected',signatureStatus:'SIGNED'},key);
 assert.equal(body.side,'DELIVERY');assert.equal(body.readingKm,100);assert.equal(body.actualAt,'2026-10-21T03:00:00.000Z');assert.equal('vehicleId'in body,false);assert.equal('signatureStatus'in body,false);
 assert.throws(()=>swapHandoverPayload(4,'RETURN',{actualAt:'2026-10-20T09:00',readingKm:-1,fileIds:[],checklist:[]},key),/里程/);
});
test('null current assignment remains a gap; safe projection excludes supplier identities and preserves real facts',()=>{
 assert.equal(assignmentLabel(null),'旧车已交还，换车待交付');assert.equal(assignmentLabel(undefined),'当前车辆分配尚未取得');
 const safe:any=swapDetailSafe({id:'qa-swap',kind:'VEHICLE_CHANGE',currentAssignment:null,providerCustomerId:'private',targetVehicle:{id:'qa-target',title:'目标车',providerSignatureId:'private'},swapAccount:{cycle:{freeAvailable:0,freeReserved:1,freeConsumed:0},paidAvailable:0,canPurchase:false,openid:'private'},actualCompletedAt:'2026-10-21T03:00:00Z',recordedAt:'2026-11-01T00:00:00Z'});
 assert.equal(safe.currentAssignment,null);assert.equal('providerCustomerId'in safe,false);assert.equal('providerSignatureId'in safe.targetVehicle,false);assert.equal('openid'in safe.swapAccount,false);assert.notEqual(safe.actualCompletedAt,safe.recordedAt);assert.equal(safe.swapAccount.cycle.freeReserved,1);assert.equal(safe.swapAccount.cycle.freeConsumed,0);
});
test('segment evidence keeps same segment version, does not resubmit settled mileage or infer vehicle',()=>{
 assert.deepEqual(segmentEvidencePayload({revision:2},'月界照片不清，请补证',key),{revision:2,reason:'月界照片不清，请补证',idempotencyKey:key});
 assert.throws(()=>segmentEvidencePayload({},'理由',key),/版本/);assert.throws(()=>segmentEvidencePayload({revision:2},'',key),/理由/);
});
test('dedicated swap navigation uses real order-change permission and kind filter, never invented API resource',()=>{
 const resource:any={key:'vehicle-changes',permissionResource:'order-changes',title:'车辆更换',singular:'换车',subtitle:'',columns:[],writeRoles:['ADMIN','OPERATIONS','FINANCE']};
 assert.equal(resourceAccessible(resource,['order-changes.read'],'SUPPORT'),true);assert.equal(resourceAccessible(resource,[],'ADMIN'),false);assert.equal(resourceWritable(resource,['order-changes.write'],'SUPPORT'),false);
 const path=changeListPath('VEHICLE_CHANGE',2,'qa','SWAP_RETURNED');assert.equal(new URL(path,'https://qa.invalid').searchParams.get('kind'),'VEHICLE_CHANGE');assert.equal(new URL(changeListPath('DELIVERY_DELAY',1,'',''),'https://qa.invalid').searchParams.get('kind'),'DELIVERY_DELAY');
});
test('handover form serializes explicit ISO without accidentally converting it twice',()=>{
 assert.equal(swapHandoverPayload(4,'RETURN',{actualAt:'2026-10-20T01:00:00.000Z',readingKm:123,fileIds:[],checklist:[{label:'staffName',value:'QA'}]},key).actualAt,'2026-10-20T01:00:00.000Z');
});
test('segment-only mileage review keeps explicit boundary confirmation',()=>{
 const fields=fieldsForAction('mileages',{label:'审核',path:'review',fields:[{key:'decision',label:'结论'},{key:'boundaryConfirmed',label:'月界确认'}]},{id:'qa-reading',segmentId:'qa-segment'});
 assert.ok(fields.some(field=>field.key==='boundaryConfirmed'));
});
test('swap handover generic complete needs trusted signed status and current canComplete',()=>{
 const entity:any={id:'qa-side',type:'SWAP_RETURN',status:'CUSTOMER_CONFIRMED',signatureStatus:'SIGNED'};
 assert.equal(actionAllowed('handovers',{label:'完成',path:'complete'},entity),false);
 assert.equal(actionAllowed('handovers',{label:'完成',path:'complete'},{...entity,canComplete:true}),true);
 assert.equal(actionAllowed('handovers',{label:'完成',path:'complete'},{...entity,canComplete:true,signatureStatus:'PENDING'}),false);
 const period:any={id:'qa-period',status:'READY',segments:[{id:'s'}],startReadingKm:80000,endReadingKm:150};
 assert.equal('startReadingKm'in detailFor('usage-periods',period),false);assert.equal('endReadingKm'in detailFor('usage-periods',period),false);
});

const recoveryQuote:Record<string,unknown>={...swapQuotePayload(3,[1],draft,key),id:'qa-recovery-baseline',financeSourceQuoteId:'qa-original-finance',recoveryFromQuoteId:'qa-signed-version',previousQuoteId:'qa-previous'};
const recoveryDetail={id:'qa-change',revision:4,kind:'VEHICLE_CHANGE',recoveryOnly:true,quote:recoveryQuote,returnHandover:{status:'COMPLETED',actualAt:'2026-10-20T01:00:35.123Z'}};
const recoveryContext:any={depositAmount:123,periods:[{sequence:1,amount:999,dueDate:'2020-01-01'}]};
test('recovery safe and draft use active frozen quote, never live financial context or a new target selection',()=>{
 const safe:any=swapDetailSafe(recoveryDetail);assert.equal(safe.recoveryOnly,true);assert.equal(safe.quote.financeSourceQuoteId,'qa-original-finance');assert.equal(safe.quote.recoveryFromQuoteId,'qa-signed-version');assert.equal(safe.quote.externalCompensationRequired,false);
 const initial=swapQuoteDraft(safe,recoveryContext);assert.equal(initial.newMonthlyFeeAmount,'5000.01');assert.equal(initial.depositAmount,'10000.02');assert.equal(initial.periods[0].amount,'5000.01');assert.equal(initial.periods[0].dueDate,'2026-10-20');assert.equal(initial.periods[0].calculationBasis,draft.periods[0].calculationBasis);assert.equal(initial.externalCompensationRequired,'false');assert.equal(initial.expiresAt,'');
});
test('recovery permits new arrangements only and preserves completed return timestamp including seconds',()=>{
 const changed={...swapQuoteDraft(recoveryDetail,recoveryContext),plannedDeliveryAt:'2026-10-22T11:30',handoverArrangement:'客户已协商新交车安排',downtimeArrangement:'已明确延长空窗安排',reason:'调整交付安排',expiresAt:'2099-02-01T10:00'};
 const body=swapQuotePayload(4,[1],changed,key,recoveryDetail);assert.equal(body.plannedReturnAt,'2026-10-20T01:00:35.123Z');assert.equal(body.plannedDeliveryAt,'2026-10-22T03:30:00.000Z');assert.equal(body.targetVehicleId,recoveryQuote.targetVehicleId);assert.deepEqual(body.periods,recoveryQuote.periods);assert.equal('financeSourceQuoteId'in body,false);assert.deepEqual(body,swapQuotePayload(4,[1],changed,key,recoveryDetail));
 assert.throws(()=>swapQuotePayload(4,[1],{...changed,plannedReturnAt:'2026-10-20T10:00'},key,recoveryDetail),/实际归还/);
});
test('recovery rejects changed target, money, fixed responsibility and all period financial fields',()=>{
 const initial={...swapQuoteDraft(recoveryDetail,recoveryContext),expiresAt:'2099-02-01T10:00'};
 for(const [field,value]of [['targetVehicleId','qa-other'],['newMonthlyFeeAmount','5000.02'],['depositAmount','0'],['handoverFeeAmount','1'],['insuranceResponsibility','另一个责任'],['settlementExplanation','另一个资金安排'],['cancellationTerms','另一个取消责任']])assert.throws(()=>swapQuotePayload(4,[1],{...initial,[field]:value},key,recoveryDetail),/冻结/);
 for(const update of [{amount:'5000.02'},{dueDate:'2026-10-21'},{calculationBasis:'不同依据'}])assert.throws(()=>swapQuotePayload(4,[1],{...initial,periods:[{...initial.periods[0],...update}]},key,recoveryDetail),/冻结/);
 assert.throws(()=>swapQuotePayload(4,[1],initial,key,{...recoveryDetail,quote:null}),/原报价/);
});
