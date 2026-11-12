import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../src/order-renewals/cancellation-policy';
import {filePrivacyBoundary} from '../src/files/files';
import {assertV31FactChain,cancellationDependencies,v31CancellationView} from '../src/order-renewals/cancellation-v31';
import {canonicalHash} from '../src/customers/types';
test('mutable lifecycle projection cannot substitute for immutable verified fact or change its original scope',async()=>{
 const m:any=await import('../src/order-renewals/cancellation-v31');assert.equal(typeof m.assertV31FactChain,'function');
 const pin={orderId:'o',customerId:'c',changeId:'change',quoteId:'q',stageId:'stage',contractId:'05',archiveVersionId:'archive'},record:any={id:'case',serviceStageId:'stage',revision:1,lifecycleState:'CLAIM',sourceHash:canonicalHash(pin)};
 const body:any={id:'f1',cancellationId:'case',...pin,sourceHash:record.sourceHash,revision:1,predecessorId:null,predecessorHash:null,kind:'CLAIM'},f={...body,factHash:canonicalHash(body)};
 m.assertV31FactChain(record,[f],pin);record.lifecycleState='VERIFIED';assert.throws(()=>m.assertV31FactChain(record,[f],pin));record.lifecycleState='CLAIM';
 const wrong={...body,archiveVersionId:'different-archive'};assert.throws(()=>m.assertV31FactChain(record,[{...wrong,factHash:canonicalHash(wrong)}],pin));
});
test('a later stage binding preserves the null-stage prefix and rejects altered hashes, chronology, duplicate bindings and projection-only scopes',()=>{
 const pin={orderId:'o',customerId:'c',changeId:'change',quoteId:'q',stageId:null,stageHash:null,contractId:'05',archiveVersionId:'archive'},current={...pin,stageId:'stage',stageHash:'a'.repeat(64)},preparedAt=new Date('2027-01-31T03:00Z');
 const record={id:'case',serviceStageId:'stage',revision:3,lifecycleState:'CLAIM',sourceHash:canonicalHash(pin)},facts:any[]=[];
 const add=(kind:string,stageId:string|null,payload:any,recordedAt:Date)=>{
  const previous=facts.at(-1),body={id:'f'+(facts.length+1),cancellationId:record.id,orderId:pin.orderId,customerId:pin.customerId,changeId:pin.changeId,quoteId:pin.quoteId,contractId:pin.contractId,archiveVersionId:pin.archiveVersionId,stageId,kind,payload,recordedAt,occurredAt:new Date('2027-01-31T01:00Z'),sourceHash:record.sourceHash,revision:facts.length+1,predecessorId:previous?.id??null,predecessorHash:previous?.factHash??null};
  const f={...body,factHash:canonicalHash(body)};facts.push(f);return f;
 };
 add('CLAIM',null,{},new Date('2027-01-31T01:00Z'));const rejected=add('REJECTED',null,{},new Date('2027-01-31T02:00Z'));
 assertV31FactChain({...record,serviceStageId:null,revision:2,lifecycleState:'REJECTED'},facts,pin,current,preparedAt);
 const binding={kind:'STAGE_PREPARED_AFTER_REJECTION',intakeSourceHash:record.sourceHash,stageId:current.stageId,stageHash:current.stageHash,sourceHash:canonicalHash(current),rejectedFactId:rejected.id,rejectedFactHash:rejected.factHash,financePreparedAt:preparedAt.toISOString()};
 add('CLAIM','stage',{stageBinding:binding},new Date('2027-01-31T04:00Z'));assert.equal(assertV31FactChain(record,facts,pin,current,preparedAt).id,'f3');
 const bad=(rows:any[]=facts,projection=record,nowPin=current,at=preparedAt)=>assert.throws(()=>assertV31FactChain(projection,rows,pin,nowPin,at),(e:any)=>e.getResponse?.().error?.code==='RENEWAL_CANCELLATION_FACT_CHAIN');
 bad(facts,{...record,serviceStageId:null as any});bad(facts,{...record,serviceStageId:'another-stage'});bad(facts,record,{...current,stageId:'replacement'});bad(facts,record,{...current,stageHash:'b'.repeat(64)});
 for(const field of ['intakeSourceHash','stageId','stageHash','sourceHash','rejectedFactId','rejectedFactHash','financePreparedAt']){
  const {factHash,...body}=facts[2],changed={...body,payload:{stageBinding:{...binding,[field]:'altered'}}};bad([...facts.slice(0,2),{...changed,factHash:canonicalHash(changed)}]);
 }
 const {factHash,...first}=facts[0],wrongPrefix={...first,stageId:'stage'};bad([{...wrongPrefix,factHash:canonicalHash(wrongPrefix)},...facts.slice(1)]);
 bad(facts,record,current,new Date('2027-01-31T01:30Z'));bad(facts,record,current,new Date('2027-01-31T05:00Z'));
 add('CLAIM','stage',{stageBinding:binding},new Date('2027-01-31T05:00Z'));bad(facts,{...record,revision:4});
});
test('actual services, receipt events and consumed service rights survive as separate sources while a later receipt reopens current finance readiness',async()=>{
 const none={findMany:async()=>[]},tx:any={usagePeriod:none,swapCredit:none,handover:none,mileage:none,vehicleReceiptEvent:{findMany:async()=>[{id:'receipt',receivedAt:new Date('2027-04-30T01:00Z')}]},serviceRequest:{findMany:async()=>[{id:'service',status:'COMPLETED',createdAt:new Date('2027-04-30T01:00Z')}]},entitlementLedger:{findMany:async()=>[{id:'consumption',type:'CONSUME',createdAt:new Date('2027-04-30T02:00Z')}]},payment:{count:async()=>0},paymentReconciliation:none};
 const s:any={pin:{startDate:'2027-04-30'},task:{status:'ARCHIVED',parties:[]},stage:{id:'stage'},order:{id:'order',customerId:'customer'},change:{id:'change'},agreement:{contractId:'05',archiveVersionId:'archive'},record:{id:'case',orderId:'order',customerId:'customer',lifecycleState:'CORRECTED'},history:[{kind:'CORRECTED',factHash:'correction',recordedAt:new Date()}]};
 const deps=await cancellationDependencies(tx,s);assert.deepEqual(new Set(deps.map(d=>d.value.kind)),new Set(['PHYSICAL_RECEIPT','SERVICE','CONSUMED_SERVICE_RIGHT']));
 tx.vehicleReceiptEvent=tx.serviceRequest=tx.entitlementLedger=none;
 const bill:any={id:'bill',customerId:'customer',payments:[]};tx.bill={findMany:async()=>[bill]};
 const ready:any=await v31CancellationView(tx,s);assert.equal(ready.financialStatus,'READY_TO_CLOSE');
 s.record.lifecycleState='FINANCE_CLOSED';s.history.push({kind:'FINANCE_CLOSED',payload:{financialSourceHash:ready.financialSourceHash}});
 assert.equal((await v31CancellationView(tx,s)).financialStatus,'CLOSED');
 bill.payments.push({id:'late-payment',billId:'bill',customerId:'customer',status:'SUCCEEDED',amount:100,providerTransactionId:'original-late-receipt',succeededAt:new Date(),reconciliationRequired:false,refunds:[]});
 const reopened:any=await v31CancellationView(tx,s);assert.equal(reopened.financialStatus,'UNRESOLVED');assert.equal(reopened.refundSources[0].remainingAmount,100);assert.equal(reopened.oldDebtOffsetAmount,0);
 bill.payments=[];s.task={status:'WITHDRAWN',stopStatus:'NEEDS_REVIEW',parties:[{attemptedAt:new Date()}]};assert.equal((await v31CancellationView(tx,s)).financialStatus,'UNRESOLVED','accepted external signature remains an owned Task4 dependency');
});
test('separate dependency closeout requires its own reviewed fully paid bill and never spends renewal receipts',async()=>{
 const module:any=await import('../src/order-renewals/cancellation-dependency').catch(()=>({}));assert.equal(typeof module.readDependencySettlement,'function');
 const record={id:'case',orderId:'order',customerId:'customer',serviceStageId:'renewal'},dep='a'.repeat(64),staff=[{id:'creator',staffPersonId:'person-a'},{id:'reviewer',staffPersonId:'person-b'}];
 const bill:any={id:'bill',orderId:'order',customerId:'customer',serviceStageId:null,type:'EXTRA_FEE',amount:100,status:'PAID',createdBy:'creator',reviewedBy:'reviewer',reviewedAt:new Date(),idempotencyKey:`v31-renewal-dependency:case:${dep}`,payments:[{id:'payment',billId:'bill',customerId:'customer',status:'SUCCEEDED',amount:100,providerTransactionId:'trusted-cash',succeededAt:new Date(),reconciliationRequired:false,refunds:[]}]};
 const tx:any={bill:{findMany:async()=>[bill]},adminUser:{findMany:async()=>staff}};
 assert.equal((await module.readDependencySettlement(tx,record,dep)).ready,true);
 bill.serviceStageId='renewal';await assert.rejects(module.readDependencySettlement(tx,record,dep));bill.serviceStageId=null;
 bill.payments[0].status='PENDING';assert.equal((await module.readDependencySettlement(tx,record,dep)).ready,false);bill.payments[0].status='SUCCEEDED';
 staff[1].staffPersonId='person-a';await assert.rejects(module.readDependencySettlement(tx,record,dep));
});
test('append-only bilateral cancellation evidence is a private file boundary',async()=>{
 const none={count:async()=>0,findUnique:async()=>null,findMany:async()=>[]},tx:any={};
 for(const key of ['electronicFileQuarantine','partnerIdentityBinding','partnerVerification','partnerVehicleBindingProposal','ownerVehicle','partnerVehicleBindingHistory','partnerCooperationDraft','partnerCooperationSubmission','partnerSettlementFile','archiveFile','archiveVersion','insurancePolicyFile','partnerAgreementVersion','assetPrivateFile','orderRenewalCancellation','vehicleDocumentFile','vehicleInspectionFile'])tx[key]=none;
 tx.renewalCancellationFact={count:async()=>1};assert.equal((await filePrivacyBoundary(tx,'bilateral-original-file')).renewalEvidence,true);
});
test('new electronic05 commercial summary states late verification and independent real-use dependencies without extra paper',()=>{
 assert.equal(typeof (policy as any).renewalCancellationTerms,'function');
 const text=(policy as any).renewalCancellationTerms('ELECTRONIC');
 assert.ok(text.includes('有权人员'));assert.ok(text.includes('技术激活'));assert.ok(text.includes('独立核验'));assert.ok(text.includes('不要求另签'));
 assert.equal((policy as any).renewalCancellationTerms('OFFLINE'),policy.RENEWAL_CANCELLATION_TERMS);
});
