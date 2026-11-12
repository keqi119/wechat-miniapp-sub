import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateUpgradePricing} from '../src/vehicle-changes/upgrade-pricing';
import {freezeSwapTerms,calculateSwapFacts} from '../src/contract-terms/swap';
import {serviceFundsRows} from '../src/order-changes/context';
import {assertElectronicSwapCommercial} from '../src/vehicle-changes/electronic-source';
import {hash} from '../src/common/data';
import {canonicalHash} from '../src/customers/types';

const source=()=>({orderId:'order',customerId:'customer',changeId:'change',priorTermsHash:'a'.repeat(64),originalAssignmentId:'assignment',ownerId:'owner',targetOwnerId:'owner',originalVehicleId:'old',targetVehicleId:'new',targetProduct:{productVersionId:'product',sourceHash:'b'.repeat(64),months:3,minimumTermMonths:3},depositAmount:60000,originalDepositAmount:60000,currentMonthlyFeeAmount:31000,targetMonthlyFeeAmount:62000,serviceFeeAmount:5000,serviceAnchor:{firstStartDay:'2027-01-31',anchorDay:31,ruleVersion:'V31' as const},startDate:'2027-04-30',months:3,periods:[{sequence:4,startDate:'2027-04-30',endDate:'2027-05-31',dueDate:'2027-04-30',amount:31000},{sequence:5,startDate:'2027-05-31',endDate:'2027-06-30',dueDate:'2027-05-31',amount:31000},{sequence:6,startDate:'2027-06-30',endDate:'2027-07-31',dueDate:'2027-06-30',amount:31000}]});

test('electronic swap commercial hash binds displayed summary and complete frozen calculation',()=>{
 const change={priorTermsHash:'a'.repeat(64)},document={id:'03',type:'ELECTRONIC_V31_VEHICLE_SWAP',version:1,templateHash:'b'.repeat(64)},base={electronicContractId:'contract',electronicTerms:freezeSwapTerms(source()),document};
 const snapshot={...base,document:{...document,content:'synthetic summary',bodyHash:hash('synthetic summary')}},q={commercialHash:canonicalHash({priorTermsHash:change.priorTermsHash,snapshot,contractId:'contract'}),snapshot};
 assert.doesNotThrow(()=>assertElectronicSwapCommercial(change,q));
 const altered=structuredClone(q);altered.snapshot.electronicTerms.snapshot.depositAmount++;assert.throws(()=>assertElectronicSwapCommercial(change,altered));
 const summary=structuredClone(q);summary.snapshot.document.content='different';summary.snapshot.document.bodyHash=hash('different');assert.throws(()=>assertElectronicSwapCommercial(change,summary));
});

test('frozen swap rejects cross lessor, downgrade and changed deposit',()=>{
 for(const patch of [{targetOwnerId:'other'},{targetMonthlyFeeAmount:30999},{depositAmount:1}])assert.throws(()=>freezeSwapTerms({...source(),...patch}));
});
test('actual delayed delivery recalculates only facts; gap and service fee stay separate',()=>{
 const frozen=freezeSwapTerms(source()),original=structuredClone(frozen);
 const paid=[{sequence:4,netPaidAmount:31000,paymentIds:['payment-4']},{sequence:5,netPaidAmount:0,paymentIds:[]},{sequence:6,netPaidAmount:0,paymentIds:[]}];
 const immediate=calculateSwapFacts(frozen,'2027-05-01T10:00:00+08:00','2027-05-01T10:00:00+08:00',paid);
 const delayed=calculateSwapFacts(frozen,'2027-05-01T10:00:00+08:00','2027-05-03T10:00:00+08:00',paid);
 assert.deepEqual(frozen,original);
 assert.equal(immediate.periods[0].upgradeRentAmount,30000);
 assert.equal(delayed.periods[0].upgradeRentAmount,28000);
 assert.equal(delayed.periods[0].gapReductionAmount,2000);
 assert.equal(delayed.periods[0].amount,57000);
 assert.equal(delayed.periods[0].alreadyPaidCreditAmount,31000);
 assert.equal(delayed.periods[0].chargeAmount,26000);
 assert.equal(delayed.serviceFeeAmount,5000);
 assert.equal(delayed.shareableUpgradeRentAmount,90000);
});
test('same price late delivery refunds unperformed gap and preserves source payment IDs',()=>{
 const frozen=freezeSwapTerms({...source(),targetMonthlyFeeAmount:31000});
 const result=calculateSwapFacts(frozen,'2027-05-30T23:59:00+08:00','2027-06-02T00:01:00+08:00',[{sequence:4,netPaidAmount:31000,paymentIds:['p4']},{sequence:5,netPaidAmount:31000,paymentIds:['p5']},{sequence:6,netPaidAmount:0,paymentIds:[]}]);
 assert.equal(result.periods[0].refundAmount,1000);
 assert.equal(result.periods[1].refundAmount,2067);
 assert.deepEqual(result.periods[1].paymentIds,['p5']);
 assert.equal(result.shareableUpgradeRentAmount,0);
});
test('facts reject invalid chronology, missing/duplicate payment periods and amount overflow',()=>{
 const frozen=freezeSwapTerms(source());
 assert.throws(()=>calculateSwapFacts(frozen,'2027-05-03T10:00:00+08:00','2027-05-01T10:00:00+08:00',[]));
 assert.throws(()=>calculateSwapFacts(frozen,'2027-05-01T10:00:00+08:00','2027-05-03T10:00:00+08:00',[]));
 assert.throws(()=>freezeSwapTerms({...source(),serviceFeeAmount:Number.MAX_SAFE_INTEGER}));
});

test('V31 swap on clipped renewal restores original day independently of billing sequence',()=>{
 const result=calculateUpgradePricing({startDate:'2027-04-30',months:3,currentMonthlyFeeAmount:31000,targetMonthlyFeeAmount:62000,deliveryAt:'2027-05-01T10:00:00+08:00',serviceAnchor:{firstStartDay:'2027-01-31',anchorDay:31,ruleVersion:'V31'}});
 assert.deepEqual(result.periods.map(p=>[p.startDate,p.endDate,p.totalDays]),[['2027-04-30','2027-05-31',31],['2027-05-31','2027-06-30',30],['2027-06-30','2027-07-31',31]]);
 assert.equal(result.periods[0].differenceAmount,30000);
 assert.equal(result.endDate,'2027-07-31');
});

test('V31 swap rejects a forged stage start that does not belong to the original anchor',()=>{
 assert.throws(()=>calculateUpgradePricing({startDate:'2027-04-29',months:3,currentMonthlyFeeAmount:100,targetMonthlyFeeAmount:200,deliveryAt:'2027-05-01T10:00:00+08:00',serviceAnchor:{firstStartDay:'2027-01-31',anchorDay:31,ruleVersion:'V31'}}));
});

test('V31 original paid rent belongs to actual service months while signed planned dates remain immutable',()=>{
 const terms={startDate:'2027-01-29',months:3,monthlyFeeAmount:1000},before=structuredClone(terms);
 const bill={id:'bill',orderId:'order',customerId:'customer',type:'SUBSCRIPTION',sequence:1,amount:1000,status:'PAID',dueDate:new Date('2027-01-29'),payments:[{id:'payment',status:'SUCCEEDED',amount:1000,refunds:[]}]};
 const funds=serviceFundsRows(terms,[],[bill],undefined,{firstStartDay:'2027-01-31',anchorDay:31,ruleVersion:'V31'});
 assert.equal(funds.rows[0].startDate,'2027-01-31');
 assert.equal(funds.rows[1].endDate,'2027-03-31');
 assert.equal(funds.rows[0].netPaidAmount,1000);
 assert.deepEqual(funds.rows[0].sourceBillIds,['bill']);
 assert.deepEqual(funds.terms,before);
 assert.equal(funds.rows[0].dueDate,'2027-01-29');
});
