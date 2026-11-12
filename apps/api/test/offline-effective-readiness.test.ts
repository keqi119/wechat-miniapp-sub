import test from 'node:test';
import assert from 'node:assert/strict';
import {readContractReady} from '../src/offline-documents/readiness';
import {agreementFixture} from './offline-change-agreement-fixture';
import {readEffectiveContractChain} from '../src/order-changes/agreement-readiness';
import {workspaceProjection} from '../src/offline-documents/workspace.service';

test('payment and settlement readiness use the complete paper chain after a change without rewriting the rental',async()=>{
 const f=agreementFixture(),c=f.addChange(true);f.order.status='ACTIVE';
 f.tx.orderChange.findFirst=async()=>null;
 f.tx.orderTermsVersion.findUnique=async({where}:any)=>f.terms.find(v=>v.id===where.id)??null;
 f.tx.documentArchive.findFirst=async()=>f.rental;f.tx.archiveFeedback={count:async()=>0};
 const before=f.rental.versions[0].businessSnapshotHash;
 for(const purpose of ['PAYMENT','DELIVERY','CONTRACT_CHANGE','SETTLEMENT','CLOSURE'] as const){const result=await readContractReady(f.tx,f.order.id,purpose);assert.equal(result.ready,true,JSON.stringify(result));assert.equal(f.rental.versions[0].businessSnapshotHash,before);}
 c.version.status='INVALIDATED';for(const purpose of ['PAYMENT','SETTLEMENT']as const)assert.equal((await readContractReady(f.tx,f.order.id,purpose)).ready,false);
});
test('customer workspace shows original and amendment archives and follows the same effective-chain payment gate',async()=>{
 const f=agreementFixture(),c=f.addChange(true);f.order.status='AWAITING_PAYMENT';f.order.currentBusinessHash=c.quote.commercialHash;
 f.order.bills=[{id:'bill',type:'SUBSCRIPTION',status:'PENDING',amount:10000,paidAmount:0}];f.order.offlineContractChain=await readEffectiveContractChain(f.tx,f.order.id);
 c.archive.quote={id:c.quote.id,commercialHash:c.quote.commercialHash,change:{orderId:f.order.id}};
 const view=workspaceProjection(f.order,f.archives,{id:f.order.customerId,role:'CUSTOMER'});
 assert.equal(view.capabilities.canPay,true);assert.equal(view.nextAction.code,'PAY_BILL');assert.ok(view.contracts.every(a=>a.blockers.length===0));
 f.order.offlineContractChain={...f.order.offlineContractChain,ready:false,blockers:['AGREEMENT_ARCHIVE_REQUIRED']};
 assert.equal(workspaceProjection(f.order,f.archives,{id:f.order.customerId,role:'CUSTOMER'}).capabilities.canPay,false);
});
