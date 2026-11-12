import '../src/common/config';
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {BillingService} from '../src/billing/billing';
import {deliveryReady} from '../src/orders/readiness';
import {offlineOrder,approvedOfflineArchive} from './offline-fixtures';
let db:Db;
before(()=>{db=new Db();});after(async()=>{await db.$disconnect();});
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
function provider(){let creates=0;return{get creates(){return creates;},create:async()=>{creates++;return{timeStamp:String(Math.floor(Date.now()/1000)),nonceStr:'synthetic',package:'prepay_id=synthetic',signType:'RSA',paySign:'synthetic'};}};}

test('unarchived offline orders cannot create payments, and invalidation blocks cached parameters',async()=>{
 const f=await offlineOrder(db),gateway=provider(),service=new BillingService(db,gateway as any),key=randomUUID();
 await assert.rejects(service.pay(f.customer,f.bill.id,key),code('OFFLINE_ARCHIVE_REQUIRED'));assert.equal(gateway.creates,0);
 const {archive}=await approvedOfflineArchive(db,f.order.id);
 const paid=await service.pay(f.customer,f.bill.id,key);assert.ok(paid.paymentId);assert.equal(gateway.creates,1);
 await db.documentArchive.update({where:{id:archive.id},data:{currentApprovedVersionId:null}});
 await assert.rejects(service.pay(f.customer,f.bill.id,key),code('OFFLINE_ARCHIVE_REQUIRED'));assert.equal(gateway.creates,1);
});

test('a verified late receipt remains recorded after archive invalidation or bill cancellation',async()=>{
 const f=await offlineOrder(db),service=new BillingService(db,provider() as any);
 const payment=await db.payment.create({data:{billId:f.bill.id,customerId:f.customer.id,amount:100,idempotencyKey:randomUUID(),status:'PENDING',requestSnapshot:{amount:100}}});
 await db.bill.update({where:{id:f.bill.id},data:{status:'VOID'}});
 const event={status:'SUCCEEDED' as const,amount:100,transactionId:randomUUID()};
 const result=await service.settle(payment.id,event);
 assert.equal(result.status,'SUCCEEDED');assert.equal((result as any).reconciliationRequired,true);
 assert.equal((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).status,'AWAITING_CONTRACT_REVIEW');
 assert.equal((await service.settle(payment.id,event)).id,payment.id);
});

test('effective terms and money do not bypass the offline contract gate',async()=>{
 const tx:any={$queryRaw:async()=>[],orderChange:{count:async()=>0},order:{findUnique:async()=>({id:'order',contractMode:'OFFLINE',status:'AWAITING_PAYMENT',effectiveTermsVersionId:'terms'})},orderTermsVersion:{findUnique:async()=>({id:'terms',orderId:'order',hash:'a'.repeat(64)})},documentArchive:{findFirst:async()=>null},archiveFeedback:{count:async()=>0},serviceObligation:{findFirst:async()=>({amount:100,allocations:[{amount:100,payment:{status:'SUCCEEDED',amount:100,refunds:[]}}]})},bill:{findMany:async()=>[]}};
 assert.equal(await deliveryReady(tx,'order'),false);
});
