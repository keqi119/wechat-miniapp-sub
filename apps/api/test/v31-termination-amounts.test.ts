import test from 'node:test';
import assert from 'node:assert/strict';
import {terminationAmounts} from '../src/orders/termination-source';
test('termination exact fractional final month and personal cap never infer breach penalty',()=>{
 const pin={monthlyFeeAmount:2800,periods:[{sequence:1,startDate:'2027-01-31',endDate:'2027-02-28',amount:2800}]};
 const personal=terminationAmounts(pin,new Date('2027-02-15T12:00:00+08:00'),'PERSONAL');assert.equal(personal.remainingRentAmount,1250);assert.equal(personal.compensationAmount,1250);
 assert.equal(terminationAmounts(pin,new Date('2027-02-15T12:00:00+08:00'),'OWNER_BREACH').compensationAmount,0);
 const expired=terminationAmounts(pin,new Date('2027-03-01T12:00:00+08:00'),'NO_FAULT');assert.equal(expired.remainingRentAmount,0);assert.equal(expired.stopAt,'2027-02-27T16:00:00.000Z');assert.equal(expired.postExpiryOccupancyClaimRequired,true);
});


test('effective termination amounts reject a different current legal source before reading money',async()=>{
 const {exitAmountSource}=await import('../src/orders/termination-amount-source');await assert.rejects(exitAmountSource({}, {pin:{scope:'NEVER_DELIVERED'},sourceHash:'changed'}, {record:{sourceHash:'original'},facts:[{kind:'EFFECTIVE'}]},null,{}),(e:any)=>e.getResponse?.().error?.code==='TERMINATION_SOURCE_CHANGED');
});
