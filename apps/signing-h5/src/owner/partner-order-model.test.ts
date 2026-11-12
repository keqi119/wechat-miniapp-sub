import test from 'node:test';
import assert from 'node:assert/strict';
import {partnerOrderFixture} from './partner-order-fixture.ts';
import {checkedPartnerOrder,checkedPartnerOrders} from './partner-order-model.ts';
import {companyRoute} from './simple-model.ts';
test('read-only partner renewal DTO keeps current and future separate, preserving zero and excluding unknown private keys',()=>{
 const f=partnerOrderFixture();const v=checkedPartnerOrder({...f,customerProfileSnapshot:'secret'},'owner',3,'order');assert.equal(v.currentPeriod?.monthlyFeeAmount,10000);assert.equal(v.futureRenewals[0].monthlyFeeAmount,20000);assert.equal(v.futureRenewals[0].baseAllowanceKm,0);assert.equal(v.futureRenewals[0].includedSwapCount,0);assert.equal(JSON.stringify(v).includes('secret'),false);
});
test('wrong owner/version/order, future status and unsafe archive identity fail before display',()=>{
 for(const patch of [{ownerId:'foreign'},{accessVersion:2},{orderId:'other'},{readOnly:false}])assert.throws(()=>checkedPartnerOrder({...partnerOrderFixture(),...patch},'owner',3,'order'));
 for(const mutate of [(f:any)=>f.futureRenewals[0].status='ACTIVE',(f:any)=>f.futureRenewals[0].archive.id='../private',(f:any)=>f.currentPeriod.monthlyFeeAmount=-1,(f:any)=>f.futureRenewals[0].endDate='2028-02-30']){const f=partnerOrderFixture();mutate(f);assert.throws(()=>checkedPartnerOrder(f,'owner',3));}
 assert.throws(()=>checkedPartnerOrders({items:[partnerOrderFixture()],page:1,pageSize:20,total:0},'owner',3));
});
test('actual company route reaches only same-owner order records',()=>{
 assert.deepEqual(companyRoute('#/owners/owner/orders/order','owner'),{tab:'orders',orderId:'order'});assert.deepEqual(companyRoute('#/owners/other/orders/order','owner'),{tab:'overview'});
});
