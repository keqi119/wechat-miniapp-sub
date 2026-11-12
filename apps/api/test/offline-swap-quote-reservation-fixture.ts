import {offlineSwapFixture,swapV2Input,swapOps} from './offline-swap-quotes-fixture';
import {termSwapFixture} from './term-swap-fixture';
import {hash} from '../src/common/data';
import {freezeSwapPricing} from '../src/swap-purchases/policy';
import {grantSwapCredit} from '../src/swap-purchases/ledger';
export {swapV2Input,swapOps};

export async function offlineSwapReservationFixture(includedCount=2,paid=false){
 const f=offlineSwapFixture(),store=termSwapFixture(includedCount,50000),tx=f.tx;
 (f.initial as any).productSnapshot.swapPolicy.includedCount=includedCount;f.change.priorTerms=structuredClone(f.initial);f.change.priorTermsHash=hash(f.initial);
 for(const key of ['swapCredit','swapReservation','swapLedger','swapCreditPurchase'])tx[key]=store.tx[key];
 const originalPaymentMany=tx.payment.findMany;tx.payment={...store.tx.payment,findMany:originalPaymentMany};
 tx.usageAccount.update=async()=>f.account;
 if(paid){
  const bill={id:'paid-bill',orderId:f.order.id,customerId:f.order.customerId,type:'SWAP_CREDIT',sequence:1,amount:50000,paidAmount:50000,status:'PAID'},payment={id:'paid-payment',billId:bill.id,customerId:f.order.customerId,status:'SUCCEEDED',amount:50000,providerTransactionId:'synthetic-paid-source',refunds:[]};
  store.bills.push(bill);store.payments.push(payment);store.purchases.push({id:'paid-purchase',orderId:f.order.id,customerId:f.order.customerId,billId:bill.id,quantity:1,amount:50000,currency:'CNY',status:'PENDING_PAYMENT',pricingSnapshot:freezeSwapPricing(f.order),termsSnapshot:{version:'SWAP_CREDIT_V2'},expiresAt:new Date('2027-01-01T00:00:00+08:00')});
  await grantSwapCredit(tx,bill,payment.id,new Date('2026-10-31T00:00:00Z'));
 }
 return{...f,tx,store,db:{...tx,serial:async(fn:any)=>fn(tx)}};
}
