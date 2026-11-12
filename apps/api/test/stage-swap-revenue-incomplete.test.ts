import {test} from 'node:test';import assert from 'node:assert/strict';
import {stageSwapPaymentFixture} from './stage-swap-payment-fixture';
import {readSimpleRevenue} from '../src/partners/simple-revenue';
async function incompleteFixture(){
 const f=await stageSwapPaymentFixture(),p=f.late(),rule=f.q.snapshot.targetRevenueRuleSnapshot;
 f.invalidate();const result=await f.billing.settle(p.id,{status:'SUCCEEDED',amount:p.amount,transactionId:'late-invalid-swap-paper'});
 assert.equal(result.reconciliationRequired,true);assert.equal(f.revenueEvents.length,0);
 f.tx.partnerAgreementVersion.findMany=async()=>[{id:rule.versionId,agreementId:rule.agreementId,title:rule.title,vehicleIds:[f.target.id]}];
 f.tx.partnerAgreementVehicle.findMany=async()=>[{vehicleId:f.target.id}];
 f.tx.payment.findMany=async()=>f.pending.filter(row=>row.status==='SUCCEEDED').map(row=>({...row,bill:{...f.first,order:f.order},refunds:[]}));
 return{...f,p,rule};
}
test('invalid staged swap source stays incomplete under target vehicle and agreement filters without using old car pricing',async()=>{const f=await incompleteFixture();assert.notEqual(f.target.id,f.stage.snapshot.termsSnapshot.revenueRuleSnapshot.vehicleId);for(const filter of [{vehicleId:f.target.id},{agreementId:f.rule.agreementId,vehicleId:f.target.id}]){const result=await readSimpleRevenue(f.tx,f.owner.id,{from:'2027-10-01',to:'2027-10-31',...filter});assert.equal(result.incompleteCount,1,'real late money cannot disappear behind the original stage vehicle filter');assert.equal(result.items.length,0);assert.equal(f.revenueEvents.length,0);}});
test('a missing or foreign stage parent cannot guess an owner for incomplete revenue',async()=>{const f=await incompleteFixture();f.first.customerId='foreign';const result=await readSimpleRevenue(f.tx,f.owner.id,{from:'2027-10-01',to:'2027-10-31',vehicleId:f.target.id});assert.equal(result.incompleteCount,0);assert.equal(result.items.length,0);assert.equal(f.revenueEvents.length,0);});
