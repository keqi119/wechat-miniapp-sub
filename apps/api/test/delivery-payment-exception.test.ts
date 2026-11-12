import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliveryReady} from '../src/orders/readiness';
test('unreconciled true receipts cannot satisfy either ordinary or allocated delivery funds',async()=>{
 const payment={status:'SUCCEEDED',amount:100,refunds:[],reconciliationRequired:true};
 const tx:any={orderChange:{count:async()=>0},order:{findUnique:async()=>({contractMode:'ESIGN'})},contract:{count:async()=>1},bill:{findMany:async()=>[{type:'SUBSCRIPTION',status:'PAID',amount:100,paidAmount:100,payments:[payment]}]}};
 assert.equal(await deliveryReady(tx,'order'),false);payment.reconciliationRequired=false;assert.equal(await deliveryReady(tx,'order'),true);
 tx.order.findUnique=async()=>({contractMode:'ESIGN',effectiveTermsVersionId:'terms'});tx.bill.findMany=async()=>[];tx.serviceObligation={findFirst:async()=>({amount:100,allocations:[{amount:100,payment}]})};
 payment.reconciliationRequired=true;assert.equal(await deliveryReady(tx,'order'),false);payment.reconciliationRequired=false;assert.equal(await deliveryReady(tx,'order'),true);
});
