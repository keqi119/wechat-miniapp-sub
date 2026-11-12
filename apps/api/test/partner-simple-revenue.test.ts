import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, generateKeyPairSync, createSign} from 'node:crypto';
import {Db} from '../src/common/db';
import {BillingService} from '../src/billing/billing';
import {PaymentReconciliationService} from '../src/billing/reconciliation';
import {WechatPaymentGateway} from '../src/integrations/wechat-payment';
import {recordSimpleRevenuePayment, recordSimpleRevenueRefund, readSimpleRevenue} from '../src/partners/simple-revenue';

const error=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
const period={from:'2026-10-01',to:'2026-11-30'};
async function fixture(db:Db,rate=3333,amount=101){
 const seed=randomUUID(),owner=await db.vehicleOwner.create({data:{name:'合成收入公司',address:'',createdBy:'synthetic'}});
 const vehicle=await db.vehicle.create({data:{brand:'Synthetic',model:'Revenue',title:'合成统计车',year:2026,city:'上海',mileageKm:0,plateNumber:'合成'+seed.slice(0,5)}});
 const customer=await db.customer.create({data:{mobile:'revenue-'+seed}}),plan=await db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'合成',months:1,monthlyFeeAmount:amount,mileagePerMonthKm:100,excessMileagePriceAmount:1,energyDescription:'合成',benefits:[],conditions:'合成'}});
 const application=await db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:{},idempotencyKey:seed,requestHash:seed}});
 const agreement=await db.partnerAgreement.create({data:{ownerId:owner.id,status:'ACTIVE',createdBy:'synthetic'}}),version=await db.partnerAgreementVersion.create({data:{agreementId:agreement.id,ownerId:owner.id,version:1,status:'ACTIVE',title:'合成原协议',fileIds:['synthetic-file'],vehicleIds:[vehicle.id],partnerRateBps:rate,contentHash:'a'.repeat(64),createdBy:'synthetic'}});
 const revenueRuleSnapshot={mode:'SIMPLE_AGREEMENT',ownerId:owner.id,agreementId:agreement.id,agreementVersionId:version.id,versionId:version.id,contentHash:version.contentHash,title:version.title,partnerRateBps:rate,vehicleId:vehicle.id,modelId:'synthetic-model-'+seed,modelName:'冻结车型',plateNumber:vehicle.plateNumber,validFrom:null,validUntil:null};
 const order=await db.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:vehicle.id,status:'ACTIVE',finalPlanSnapshot:{lessorSnapshot:{ownerId:owner.id},revenueRuleSnapshot},confirmedMileageKm:0}});
 const bill=await db.bill.create({data:{orderId:order.id,customerId:customer.id,type:'SUBSCRIPTION',sequence:1,amount,status:'PENDING',dueDate:new Date('2026-10-01')}}),payment=await db.payment.create({data:{billId:bill.id,customerId:customer.id,amount,idempotencyKey:seed,status:'PENDING'}});
 const billing=new BillingService(db,{} as any,()=>new Date('2026-11-20T05:00:00Z'));
 return{owner,vehicle,customer,agreement,version,order,bill,payment,billing,revenueRuleSnapshot};
}
async function refund(db:Db,f:Awaited<ReturnType<typeof fixture>>,amount:number,at:string){
 const row=await db.refund.create({data:{paymentId:f.payment.id,customerId:f.customer.id,amount,reason:'合成退款',requestedBy:'synthetic-maker',approvedBy:'synthetic-reviewer',status:'PROCESSING'}});
 await f.billing.settleRefund(row.id,{status:'SUCCEEDED',providerRefundId:'verified-'+row.id,paymentId:f.payment.id,amount,totalAmount:f.payment.amount,succeededAt:at} as any);return row;
}
async function withDb(run:(db:Db)=>Promise<void>){
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.port==='55432'&&url.pathname==='/chundian_test');
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});try{await run(db);}finally{await db.$disconnect();}
}
const dbTest={skip:process.env.NODE_ENV!=='test'};

test('verified provider success time survives signed payment and refund query decoding',async()=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048}),privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();const now=Date.parse('2026-11-20T05:00:00Z');
 let data:any={appid:'app',mchid:'merchant',out_trade_no:'payment',trade_state:'SUCCESS',transaction_id:'verified',amount:{total:101,currency:'CNY'},success_time:'2026-10-31T23:59:59+08:00'};
 const gateway=new WechatPaymentGateway({enabled:true,appId:'app',merchantId:'merchant',serial:'serial',privateKey,apiV3Key:'a'.repeat(32),notifyUrl:'https://example.test/pay',refundNotifyUrl:'https://example.test/refund',verifier:()=>publicKey},async()=>{const body=JSON.stringify(data),timestamp=String(now/1000),nonce='synthetic';const signature=createSign('RSA-SHA256').update(`${timestamp}\n${nonce}\n${body}\n`).sign(privateKey,'base64');return new Response(body,{headers:{'wechatpay-timestamp':timestamp,'wechatpay-nonce':nonce,'wechatpay-serial':'serial','wechatpay-signature':signature}});},()=>now);
 assert.equal((await gateway.query('payment') as any).succeededAt,'2026-10-31T15:59:59.000Z');
 data={out_refund_no:'refund',out_trade_no:'payment',refund_id:'verified-refund',status:'SUCCESS',success_time:'2026-11-01T00:00:00+08:00',amount:{refund:1,total:101,currency:'CNY'}};
 assert.equal((await gateway.queryRefund('refund') as any).succeededAt,'2026-10-31T16:00:00.000Z');
 data.success_time='2026-02-31T00:00:00+08:00';assert.equal((await gateway.queryRefund('refund') as any).succeededAt,undefined);
});

test('subscription receipts and cumulative cross-month refunds are immutable, idempotent and fully reverse to zero',dbTest,()=>withDb(async db=>{
 const f=await fixture(db),event={status:'SUCCEEDED',amount:101,transactionId:'verified-'+randomUUID(),succeededAt:'2026-10-31T15:59:59Z'} as any;
 await f.billing.settle(f.payment.id,event);await f.billing.settle(f.payment.id,{...event,succeededAt:'2026-11-20T05:00:00Z'});
 assert.equal((await db.payment.findUniqueOrThrow({where:{id:f.payment.id}})).succeededAt?.toISOString(),'2026-10-31T15:59:59.000Z');
 await refund(db,f,1,'2026-10-31T16:00:00Z');await refund(db,f,1,'2026-11-02T00:00:00Z');await refund(db,f,99,'2026-11-03T00:00:00Z');
 const all=await db.serial(tx=>readSimpleRevenue(tx,f.owner.id,{...period,groupBy:'month'}));
 assert.deepEqual(all.totals,{receivedAmount:101,refundedAmount:101,netAmount:0,partnerAmount:0,platformAmount:0});assert.equal(all.total,4);assert.equal(all.incompleteCount,0);
 assert.deepEqual(all.groups.map((g:any)=>[g.key,g.netAmount,g.partnerAmount]),[['2026-10',101,34],['2026-11',-101,-34]]);
 const october=await db.serial(tx=>readSimpleRevenue(tx,f.owner.id,{from:'2026-10-31',to:'2026-10-31'}));assert.equal(october.totals.netAmount,101);
 const november=await db.serial(tx=>readSimpleRevenue(tx,f.owner.id,{from:'2026-11-01',to:'2026-11-30',page:'2',pageSize:'1'}));assert.equal(november.totals.partnerAmount,-34);assert.equal(november.items.length,1);assert.equal(november.total,3);
 assert.equal(JSON.stringify(all).includes(f.customer.id),false);assert.equal(JSON.stringify(all).includes(f.order.id),false);
}));

test('whitelist excludes deposits and fees; frozen owner and rate survive later agreement changes',dbTest,()=>withDb(async db=>{
 const f=await fixture(db,7500,10000);await f.billing.settle(f.payment.id,{status:'SUCCEEDED',amount:10000,transactionId:'verified-'+randomUUID(),succeededAt:'2026-10-10T00:00:00Z'} as any);
 for(const type of ['DEPOSIT','DEPOSIT_ADJUSTMENT','EXTRA_FEE','MILEAGE_PACK','RETURN_SETTLEMENT']){const bill=await db.bill.create({data:{orderId:f.order.id,customerId:f.customer.id,type,sequence:1,amount:300,status:'PAID',paidAmount:300,dueDate:new Date('2026-10-01')}}),p=await db.payment.create({data:{billId:bill.id,customerId:f.customer.id,status:'SUCCEEDED',amount:300,succeededAt:new Date('2026-10-10'),providerTransactionId:randomUUID(),idempotencyKey:randomUUID()}});await db.serial(tx=>recordSimpleRevenuePayment(tx,p.id));}
 await db.partnerAgreementVersion.create({data:{agreementId:f.agreement.id,ownerId:f.owner.id,version:2,title:'变更比例协议',partnerRateBps:1000,contentHash:'b'.repeat(64),createdBy:'synthetic'}});await db.vehicle.update({where:{id:f.vehicle.id},data:{model:'变更车型',plateNumber:'变更车牌'}});
 await refund(db,f,2000,'2026-11-01T00:00:00Z');const result=await db.serial(tx=>readSimpleRevenue(tx,f.owner.id,{...period,agreementId:f.agreement.id,modelId:f.revenueRuleSnapshot.modelId,vehicleId:f.vehicle.id,groupBy:'agreement'}));
 assert.deepEqual(result.totals,{receivedAmount:10000,refundedAmount:2000,netAmount:8000,partnerAmount:6000,platformAmount:2000});assert.equal(result.total,2);assert.equal(result.groups[0].label,'合成原协议');assert.ok(result.items.every((i:any)=>i.partnerRateBps===7500&&i.modelName==='冻结车型'&&i.plateNumber===f.vehicle.plateNumber));
 const other=await fixture(db,0);await assert.rejects(db.serial(tx=>readSimpleRevenue(tx,f.owner.id,{...period,agreementId:other.agreement.id})),error('NOT_FOUND'));
 const emptyPeriod=await db.serial(tx=>readSimpleRevenue(tx,f.owner.id,{from:'2027-01-01',to:'2027-01-31'}));
 assert.deepEqual(emptyPeriod.filters,{agreements:[{id:f.agreement.id,title:'合成原协议'}],models:[{id:f.revenueRuleSnapshot.modelId,name:'冻结车型'}],vehicles:[{id:f.vehicle.id,plateNumber:f.vehicle.plateNumber,modelId:f.revenueRuleSnapshot.modelId,agreementId:f.agreement.id}]});
 assert.equal(emptyPeriod.total,0);assert.equal(JSON.stringify(emptyPeriod.filters).includes(other.vehicle.id),false);
}));

test('anomaly resolution includes original verified dates once and returns read-only unknown historical counts',dbTest,()=>withDb(async db=>{
 const f=await fixture(db,5000,101);await db.order.update({where:{id:f.order.id},data:{status:'CANCELLED'}});await f.billing.settle(f.payment.id,{status:'SUCCEEDED',amount:101,transactionId:'verified-'+randomUUID(),succeededAt:'2026-10-10T00:00:00Z'} as any);
 assert.equal((await db.serial(tx=>readSimpleRevenue(tx,f.owner.id,period))).total,0);await refund(db,f,101,'2026-11-01T00:00:00Z');
 const maker=await db.adminUser.create({data:{username:'revenue-maker-'+randomUUID(),name:'合成财务',passwordHash:'synthetic',role:'FINANCE'}}),reviewer=await db.adminUser.create({data:{username:'revenue-reviewer-'+randomUUID(),name:'合成复核',passwordHash:'synthetic',role:'FINANCE'}}),proof=await db.storedFile.create({data:{adminId:maker.id,name:'合成.pdf',purpose:'evidence',mimeType:'application/pdf',size:10,sha256:'a'.repeat(64),storagePath:'synthetic'}});
 const actor=(u:any)=>({id:u.id,role:u.role,authVersion:u.authVersion}),service=new PaymentReconciliationService(),record=await db.serial(tx=>service.submit(tx,actor(maker),f.payment.id,{revision:0,idempotencyKey:randomUUID(),resolution:'REFUNDED',note:'合成全额退款核对',evidenceFileIds:[proof.id]}));
 await db.serial(tx=>service.review(tx,actor(reviewer),f.payment.id,record.id,{revision:record.paymentRevision,idempotencyKey:randomUUID(),decision:'APPROVED',note:'合成独立核对'}));
 let result=await db.serial(tx=>readSimpleRevenue(tx,f.owner.id,{...period,groupBy:'month'}));assert.equal(result.total,2);assert.deepEqual(result.groups.map((g:any)=>[g.key,g.netAmount]),[['2026-10',101],['2026-11',-101]]);
 const legacy=await fixture(db);await db.order.update({where:{id:legacy.order.id},data:{finalPlanSnapshot:{lessorSnapshot:{ownerId:f.owner.id}}}});await db.payment.update({where:{id:legacy.payment.id},data:{status:'SUCCEEDED',providerTransactionId:randomUUID(),updatedAt:new Date('2026-10-10')}});
 const before=await db.partnerRevenueEvent.count({where:{ownerId:f.owner.id}});result=await db.serial(tx=>readSimpleRevenue(tx,f.owner.id,period));assert.equal(result.incompleteCount,1);assert.equal(await db.partnerRevenueEvent.count({where:{ownerId:f.owner.id}}),before);assert.equal(result.total,2);
 await db.serial(tx=>recordSimpleRevenuePayment(tx,f.payment.id));assert.equal(await db.partnerRevenueEvent.count({where:{ownerId:f.owner.id}}),2);
}));

test('missing or invalid dates use first confirmation only for a new success and never invent historical times',dbTest,()=>withDb(async db=>{
 const f=await fixture(db,0);await f.billing.settle(f.payment.id,{status:'SUCCEEDED',amount:101,transactionId:'verified-'+randomUUID(),succeededAt:'invalid'} as any);assert.equal((await db.payment.findUniqueOrThrow({where:{id:f.payment.id}})).succeededAt?.toISOString(),'2026-11-20T05:00:00.000Z');
 const historical=await fixture(db);await db.payment.update({where:{id:historical.payment.id},data:{status:'SUCCEEDED',providerTransactionId:'history-'+historical.payment.id,succeededAt:null}});await historical.billing.settle(historical.payment.id,{status:'SUCCEEDED',amount:101,transactionId:'history-'+historical.payment.id});assert.equal((await db.payment.findUniqueOrThrow({where:{id:historical.payment.id}})).succeededAt,null);
 const result=await db.serial(tx=>readSimpleRevenue(tx,f.owner.id,period));assert.equal(result.totals.partnerAmount,0);assert.equal(result.incompleteCount,0);
 const unknown=await db.serial(tx=>readSimpleRevenue(tx,historical.owner.id,period));assert.equal(unknown.incompleteCount,1);assert.equal(unknown.total,0);
 await assert.rejects(db.serial(tx=>readSimpleRevenue(tx,f.owner.id,{from:'2026-02-31',to:'2026-11-01'})));await assert.rejects(db.serial(tx=>readSimpleRevenue(tx,f.owner.id,{from:'2026-11-02',to:'2026-11-01'})));
}));

test('concurrent refund confirmations serialize cumulative rounding and cannot record twice',dbTest,()=>withDb(async db=>{
 const f=await fixture(db,3333,3);await f.billing.settle(f.payment.id,{status:'SUCCEEDED',amount:3,transactionId:'verified-'+randomUUID(),succeededAt:'2026-10-10T00:00:00Z'} as any);
 const refunds=await Promise.all([1,1,1].map(amount=>db.refund.create({data:{paymentId:f.payment.id,customerId:f.customer.id,amount,reason:'合成',requestedBy:'synthetic',approvedBy:'reviewer',status:'PROCESSING'}})));
 await Promise.all(refunds.flatMap(row=>[1,2].map(()=>f.billing.settleRefund(row.id,{status:'SUCCEEDED',providerRefundId:'verified-'+row.id,paymentId:f.payment.id,amount:1,totalAmount:3,succeededAt:'2026-11-01T00:00:00Z'} as any))));
 const result=await db.serial(tx=>readSimpleRevenue(tx,f.owner.id,period));assert.equal(result.total,4);assert.equal(result.totals.netAmount,0);assert.equal(result.totals.partnerAmount,0);
 await db.serial(tx=>recordSimpleRevenueRefund(tx,refunds[0].id));assert.equal(await db.partnerRevenueEvent.count({where:{paymentId:f.payment.id}}),4);
}));
