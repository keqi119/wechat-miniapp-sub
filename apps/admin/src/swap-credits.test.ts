import {test} from 'node:test';
import assert from 'node:assert/strict';
import {swapPurchaseSafe,swapPurchaseActionAllowed,swapCreditRefundPayload,swapCreditRestorePayload,swapPurchaseNotice,swapCreditStatusLabel,validSwapPurchase} from './swap-credits.ts';
import {resources,resourceWritable,resourceAccessible,actionAllowed,detailFor} from './resources.ts';
import {mutationPayload} from './form.ts';
import {swapDetailSafe} from './swap.ts';
const purchase={id:'qa-purchase',orderId:'qa-order',customerId:'qa-customer',quantity:1,amount:80000,currency:'CNY',status:'ACTIVE',billId:'qa-bill',paymentId:'qa-payment',creditId:'qa-credit',bill:{id:'qa-bill',type:'SWAP_CREDIT',amount:80000,paidAmount:80000,status:'PAID'},refunds:[],canClose:false,canRequestRefund:true,canPay:false,terms:{version:'SWAP_CREDIT_V1',documentId:'qa-doc',documentVersion:1,hash:'a'.repeat(64)},expiresOn:'2027-10-15'};
test('purchase resource is readable by assigned roles, has no creation/edit/grant/pay and close is finance only',()=>{
 const resource=resources.find(r=>r.key==='swap-credit-purchases')!;assert.ok(resource);assert.equal(resource.create,undefined);assert.equal(resource.edit,undefined);assert.deepEqual(resource.actions?.map(a=>a.path),['close','restore']);
 for(const role of ['ADMIN','OPERATIONS','FINANCE','SUPPORT']){assert.equal(resourceAccessible(resource,['swap-credit-purchases.read'],role),true);assert.equal(resourceWritable(resource,['swap-credit-purchases.write'],role),['ADMIN','FINANCE'].includes(role));}
 assert.equal(resourceAccessible(resource,[],'ADMIN'),false);
});
test('restoring a wholly rejected unapproved refund requires explicit safe authority and never creates a new credit',()=>{
 const value={...purchase,status:'REFUND_PENDING',canRestore:true,restoreRefundId:'qa-rejected',refunds:[{id:'qa-rejected',status:'REJECTED',amount:80000}]};
 assert.equal(swapPurchaseActionAllowed('restore',value,'FINANCE'),true);assert.equal(swapPurchaseActionAllowed('restore',value,'OPERATIONS'),false);assert.deepEqual(swapCreditRestorePayload(value,'已核对全部未审批拒绝的退款','qa-restore-stable-key'),{refundId:'qa-rejected',reason:'已核对全部未审批拒绝的退款',idempotencyKey:'qa-restore-stable-key'});
 for(const update of [{canRestore:false},{restoreRefundId:'qa-other'},{reservedChangeId:'qa-swap'},{status:'REFUNDED'},{refunds:[{id:'qa-rejected',status:'FAILED'}]},{refunds:[{id:'qa-rejected',status:'PROCESSING'}]}])assert.throws(()=>swapCreditRestorePayload({...value,...update},'原因','qa-restore-stable-key'));
 const safe=swapPurchaseSafe(value);assert.equal(safe.canRestore,true);assert.equal(safe.restoreRefundId,'qa-rejected');
});
test('close needs exact server capability and pending unpaid state, preserving original request key',()=>{
 const entity={...purchase,status:'PENDING_PAYMENT',canClose:true};assert.equal(swapPurchaseActionAllowed('close',entity,'FINANCE'),true);assert.equal(actionAllowed('swap-credit-purchases',{path:'close',label:'关闭'},entity),true);
 for(const role of ['OPERATIONS','SUPPORT'])assert.equal(swapPurchaseActionAllowed('close',entity,role),false);
 for(const status of ['ACTIVE','CONSUMED','PAYMENT_REVIEW','REFUND_PENDING','REFUNDED','EXPIRED','VOID'])assert.equal(swapPurchaseActionAllowed('close',{...entity,status},'ADMIN'),false);
 for(const canClose of [false,undefined,'true',1])assert.equal(swapPurchaseActionAllowed('close',{...entity,canClose},'FINANCE'),false);
 assert.deepEqual(mutationPayload('swap-credit-purchases','action',{},'qa-stable-close-key'),{idempotencyKey:'qa-stable-close-key'});
});
test('exception refund sends one fixed full amount, never creates credits or changes orders',()=>{
 assert.deepEqual(swapCreditRefundPayload(purchase,'例外退款依据','qa-stable-refund-key'),{paymentId:'qa-payment',amount:80000,reason:'例外退款依据',idempotencyKey:'qa-stable-refund-key'});
 assert.equal(swapPurchaseActionAllowed('refund',purchase,'FINANCE'),true);assert.equal(swapPurchaseActionAllowed('refund',purchase,'OPERATIONS'),false);
 for(const value of [{...purchase,amount:1},{...purchase,quantity:2},{...purchase,currency:'USD'},{...purchase,canRequestRefund:false},{...purchase,reservedChangeId:'qa-reserved'},{...purchase,consumedChangeId:'qa-consumed'},{...purchase,paymentId:null}])assert.throws(()=>swapCreditRefundPayload(value,'原因','qa-stable-refund-key'));
 assert.throws(()=>swapCreditRefundPayload(purchase,'','qa-stable-refund-key'),/原因/);
});
test('refund pending can retry only after credible failed/rejected records, never unknown/inflight/succeeded',()=>{
 for(const status of ['FAILED','REJECTED'])assert.equal(swapPurchaseActionAllowed('refund',{...purchase,status:'REFUND_PENDING',refunds:[{id:'qa-refund',amount:80000,status}]},'ADMIN'),true);
 for(const status of ['PENDING_APPROVAL','PROCESSING','SUCCEEDED','UNKNOWN'])assert.equal(swapPurchaseActionAllowed('refund',{...purchase,status:'REFUND_PENDING',refunds:[{id:'qa-refund',amount:80000,status}]},'ADMIN'),false);
});
test('purchase detail recursively whitelists records without provider, identity or prepay material',()=>{
 const raw={...purchase,openid:'private',prepayId:'private',bill:{...purchase.bill,providerResponse:{private:true}},terms:{...purchase.terms,content:'not part of purchase safe',token:'private'},refunds:[{id:'qa-refund',amount:80000,status:'FAILED',providerPayload:'private'}]};
 const safe=swapPurchaseSafe(raw);assert.equal(JSON.stringify(safe).includes('private'),false);assert.equal(JSON.stringify(detailFor('swap-credit-purchases',raw)).includes('private'),false);assert.equal((safe.terms as any).hash,'a'.repeat(64));assert.equal('content'in(safe.terms as object),false);
});
test('late paid money and unknown refunds are explicitly frozen, never unreceived or spendable',()=>{
 assert.match(swapPurchaseNotice({...purchase,status:'PAYMENT_REVIEW',manualReviewRequired:true,statusMessage:'真实晚到款已入账，需人工核账'})?.message??'',/已入账/);
 assert.match(swapPurchaseNotice({...purchase,status:'REFUND_PENDING',refunds:[{id:'qa-refund',status:'PROCESSING'}]})?.message??'',/冻结/);
 assert.equal(swapCreditStatusLabel('swap-credit-purchases','ACTIVE'),'已可信到账');assert.equal(swapCreditStatusLabel('payments','ACTIVE'),undefined);
});
test('swap account preserves real paid counts, purchase sources and consent text without provider fields',()=>{
 const detail:any=swapDetailSafe({id:'qa-change',swapAccount:{contractMode:'ESIGN',paidAvailable:1,paidReserved:2,paidConsumed:3,paidFrozen:4,paidExpired:5,canPurchase:true,purchaseBlockers:[],product:{id:'SWAP_CREDIT_1',quantity:1,amount:80000,currency:'CNY',secret:'private'},purchases:[{...purchase,prepayId:'private'}],purchaseTerms:{version:'SWAP_CREDIT_V1',documentId:'qa-doc',documentVersion:1,hash:'a'.repeat(64),content:'QA 已批准的专门购买说明',providerPayload:'private'},ledger:[{id:'qa-grant',type:'GRANT',source:'PAID',changeId:null,purchaseId:'qa-purchase',recordedAt:'2026-10-16T00:00:00Z',provider:'private'}]}});
 assert.equal(detail.swapAccount.paidFrozen,4);assert.equal(detail.swapAccount.paidExpired,5);assert.equal(detail.swapAccount.canPurchase,true);assert.equal(detail.swapAccount.purchases[0].bill.type,'SWAP_CREDIT');assert.equal(detail.swapAccount.ledger[0].purchaseId,'qa-purchase');assert.equal(detail.swapAccount.ledger[0].changeId,null);assert.equal(detail.swapAccount.purchaseTerms.content,'QA 已批准的专门购买说明');assert.equal(JSON.stringify(detail).includes('private'),false);
});

const termTerms={version:'SWAP_CREDIT_V2',documentId:'term-document',documentVersion:2,hash:'a'.repeat(64),templateContent:'单次服务费 {{extraFeeYuan}} 元',templateHash:'b'.repeat(64)};
const termPurchase={...purchase,policyVersion:'SWAP_TERM_V2',pricingHash:'c'.repeat(64),amount:62345,terms:termTerms,bill:{...purchase.bill,amount:62345,paidAmount:62345}};
test('TERM purchase keeps frozen pricing and template evidence and refunds its exact original amount',()=>{
 const safe=swapPurchaseSafe({...termPurchase,providerPayload:'private'});assert.equal(validSwapPurchase(safe),true);assert.equal(safe.policyVersion,'SWAP_TERM_V2');assert.equal(safe.pricingHash,termPurchase.pricingHash);assert.equal((safe.terms as any).templateContent,termTerms.templateContent);assert.equal(JSON.stringify(safe).includes('private'),false);
 assert.deepEqual(swapCreditRefundPayload(safe,'核对原款','term-refund-stable'),{paymentId:'qa-payment',amount:62345,reason:'核对原款',idempotencyKey:'term-refund-stable'});assert.equal(swapPurchaseActionAllowed('refund',safe,'OPERATIONS'),false);
});
test('TERM purchase fails closed on missing pricing, wrong terms, noninteger amount or mismatching bill',()=>{
 for(const update of [{policyVersion:undefined},{policyVersion:'UNKNOWN'},{pricingHash:undefined},{pricingHash:'bad'},{amount:0},{amount:1.1},{amount:2147483648},{terms:{...termTerms,version:'SWAP_CREDIT_V1'}},{terms:{...termTerms,templateHash:undefined}},{terms:{...termTerms,templateContent:''}},{bill:{...termPurchase.bill,amount:80000}}])assert.equal(validSwapPurchase({...termPurchase,...update}),false,JSON.stringify(update));
 assert.equal(validSwapPurchase({...purchase,terms:termTerms}),false);assert.equal(validSwapPurchase({...purchase,pricingHash:'c'.repeat(64)}),false);
 assert.throws(()=>swapCreditRefundPayload({...termPurchase,bill:{...termPurchase.bill,paidAmount:80000}},'核对','term-refund-stable'));
 assert.equal(swapPurchaseActionAllowed('refund',{...termPurchase,status:'REFUND_PENDING',refunds:[{id:'partial',status:'FAILED',amount:1}]},'FINANCE'),false);
});
test('TERM account projection preserves entitlement and server request capability but requires purchase documents',()=>{
 const account={orderId:'o',contractMode:'OFFLINE',policyVersion:'SWAP_TERM_V2',startedOn:'2026-10-01',endDate:'2028-09-30',term:{startDate:'2026-10-01',endDate:'2028-10-01',includedCount:3,remaining:2,reserved:1,consumed:1,available:1},canRequest:true,canPurchase:true,reservations:[{id:'r',changeId:'c',source:'FREE',scope:'TERM',termSequence:2,status:'RESERVED'}],ledger:[{id:'l',source:'FREE',scope:'TERM',termSequence:1,type:'CONSUME'}],product:{id:'SWAP_CREDIT_TERM_1',policyVersion:'SWAP_TERM_V2',pricingHash:'c'.repeat(64),quantity:1,amount:62345,currency:'CNY'}};
 const result:any=swapDetailSafe({id:'change',swapAccount:account});assert.equal(result.swapAccount.policyVersion,'SWAP_TERM_V2');assert.deepEqual(result.swapAccount.term,account.term);assert.equal(result.swapAccount.cycle,undefined);assert.equal(result.swapAccount.reservations[0].termSequence,2);assert.equal(result.swapAccount.canRequest,true);assert.equal(result.swapAccount.canPurchase,false);
 for(const update of [{policyVersion:'UNKNOWN'},{policyVersion:undefined},{term:{...account.term,remaining:3}},{term:{...account.term,available:2}},{reservations:[{...account.reservations[0],termSequence:4}]},{ledger:[{...account.ledger[0],cycleSequence:1}]},{product:{id:'SWAP_CREDIT_1',quantity:1,amount:80000,currency:'CNY'}},{purchaseTerms:{...termTerms,templateHash:undefined}}])assert.throws(()=>swapDetailSafe({id:'change',swapAccount:{...account,...update}}));
});

test('historical purchases require the actual v1 consent identity and hash as well as the original fixed price',()=>{
 for(const patch of [{terms:undefined},{terms:{...purchase.terms,documentId:''}},{terms:{...purchase.terms,documentVersion:0}},{terms:{...purchase.terms,hash:'bad'}}])assert.equal(validSwapPurchase({...purchase,...patch}),false);
 assert.equal(validSwapPurchase(purchase),true);
});
