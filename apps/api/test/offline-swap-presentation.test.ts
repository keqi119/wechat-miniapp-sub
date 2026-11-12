import {test} from 'node:test';
import assert from 'node:assert/strict';
import {creditView} from '../src/vehicle-changes/credits';
import {swapAccountView} from '../src/vehicle-changes/account';

const now=new Date('2026-10-27T12:00:00+08:00');
const startedOn=new Date('2026-10-01T00:00:00Z');
const expiresAt=new Date('2027-10-01T00:00:00+08:00');

async function flags(mvp:string|undefined,work:()=>Promise<void>){
 const prior={MVP_V2_ENABLED:process.env.MVP_V2_ENABLED,SWAP_CREDIT_PURCHASE_ENABLED:process.env.SWAP_CREDIT_PURCHASE_ENABLED};
 if(mvp===undefined)delete process.env.MVP_V2_ENABLED;else process.env.MVP_V2_ENABLED=mvp;
 process.env.SWAP_CREDIT_PURCHASE_ENABLED='true';
 try{await work();}finally{for(const[key,value]of Object.entries(prior))if(value===undefined)delete process.env[key];else process.env[key]=value;}
}

/** Pure transaction-shaped fixture; no Db, HTTP, providers, filesystem or ORM client. */
function fixture(contractMode:string|undefined,{freeConsumed=false,reserved=false,paid=false}={}){
 const order={id:'order',customerId:'customer',contractMode,status:'ACTIVE',currentAssignmentId:'assignment',finalPlanSnapshot:{months:12}};
 const account={id:'usage',orderId:order.id,customerId:order.customerId,startedOn,returnedOn:null};
 const assignment={id:'assignment',orderId:order.id,vehicleId:'vehicle',status:'ACTIVE',startAt:startedOn,startReadingKm:1000,vehicle:{title:'合成车辆'}};
 const free=freeConsumed||reserved?{id:'free',orderId:order.id,source:'FREE',cycleSequence:1,consumedChangeId:freeConsumed?'old-free-change':null}:null;
 const paidCredit={id:'paid-credit',orderId:order.id,source:'PAID',sourcePaymentId:'paid-payment',status:'ACTIVE',consumedChangeId:null};
 const reservations=reserved?[{id:'reserved',creditId:'free',changeId:'old-reservation',status:'RESERVED',credit:free}]:[];
 const ledger=[...(freeConsumed?[{id:'free-ledger',creditId:'free',type:'CONSUME',source:'FREE',cycleSequence:1,changeId:'old-free-change',actualAt:startedOn,recordedAt:startedOn}]:[]),...(paid?[{id:'paid-ledger',creditId:paidCredit.id,purchaseId:'paid-purchase',type:'GRANT',source:'PAID',cycleSequence:null,recordedAt:startedOn}]:[])];
 const purchase={id:'paid-purchase',quantity:1,amount:80000,currency:'CNY',orderId:order.id,customerId:order.customerId,billId:'paid-bill',creditId:paidCredit.id,paymentId:paidCredit.sourcePaymentId,status:'ACTIVE',expiresAt,acceptedAt:startedOn,createdAt:startedOn,paidAt:startedOn,termsSnapshot:{version:'SWAP_CREDIT_V1',documentId:'legacy-terms',documentVersion:1,hash:'a'.repeat(64)}};
 const tx:any={
  order:{findUnique:async()=>order,findFirst:async({where}:any)=>{assert.equal(where.id,order.id);assert.equal(where.customerId,order.customerId);return order;},findUniqueOrThrow:async()=>order},
  usageAccount:{findUnique:async()=>account,findUniqueOrThrow:async()=>account},
  vehicleAssignment:{count:async()=>1,findFirst:async()=>assignment,findMany:async()=>[assignment]},
  orderServiceStage:{findMany:async()=>[]},orderChange:{findFirst:async()=>null,findMany:async()=>[]},usagePeriod:{findFirstOrThrow:async()=>({endDate:new Date('2027-10-01T00:00:00Z')})},
  swapCredit:{findMany:async()=>[...(free?[free]:[]),...(paid?[paidCredit]:[])],findUnique:async({where}:any)=>where.id===paidCredit.id?paidCredit:free},
  swapReservation:{findMany:async()=>reservations,findFirst:async()=>null},
  swapLedger:{findMany:async()=>ledger},swapCreditPurchase:{findMany:async()=>paid?[purchase]:[]},
  legalDocument:{findFirst:async()=>({id:'terms',version:1,content:'已审定的历史换车说明'})},
  bill:{findUniqueOrThrow:async()=>({id:'paid-bill',orderId:order.id,customerId:order.customerId,type:'SWAP_CREDIT',amount:80000,paidAmount:80000,status:'PAID',payments:[{id:'paid-payment',billId:'paid-bill',customerId:order.customerId,status:'SUCCEEDED',amount:80000,providerTransactionId:'synthetic-provider-reference',refunds:[]}]})},
 };
 return {tx,order,account,ledger,reservations,purchase};
}

for(const mvp of [undefined,'false','true'])test(`OFFLINE account without authoritative paper source cannot advertise new free, request or purchase capacity with MVP=${mvp}`,async()=>flags(mvp,async()=>{
 const f=fixture('OFFLINE');const view=await swapAccountView(f.tx,f.order.id,now,f.order.customerId);assert('cycle' in view);
 assert.equal(view.contractMode,'OFFLINE');assert.equal(view.cycle.freeAvailable,0);
 assert.equal(view.canRequest,false);assert.equal(view.canPurchase,false);
 assert.ok(view.blockers.includes('AGREEMENT_INITIAL_TERMS_MISSING'));
 assert.ok(view.purchaseBlockers.includes('AGREEMENT_INITIAL_TERMS_MISSING'));
 assert.deepEqual(view.purchases,[]);assert.deepEqual(view.ledger,[]);
}));

test('OFFLINE credit projection itself returns no implicit free grant',async()=>{
 const f=fixture('OFFLINE');const view=await creditView(f.tx,f.order,f.account,now);assert('cycle' in view);
 assert.equal(view.cycle.freeAvailable,0);assert.equal(view.cycle.freeConsumed,0);assert.equal(view.cycle.freeReserved,0);
});

test('OFFLINE presentation retains existing consumption, paid purchase and ledger facts',async()=>flags('true',async()=>{
 const f=fixture('OFFLINE',{freeConsumed:true,paid:true});const before=JSON.stringify({ledger:f.ledger,purchase:f.purchase});
 const view=await swapAccountView(f.tx,f.order.id,now,f.order.customerId);assert('cycle' in view);
 assert.equal(view.cycle.freeAvailable,0);assert.equal(view.cycle.freeConsumed,1);
 assert.equal(view.paidAvailable,1);assert.equal(view.purchases.length,1);
 assert.equal(view.purchases[0].id,'paid-purchase');assert.equal(view.purchases[0].paymentId,'paid-payment');assert.equal(view.purchases[0].status,'ACTIVE');assert.equal(view.purchases[0].bill.paidAmount,80000);
 assert.equal(view.ledger.length,2);assert.equal(view.ledger[0].changeId,'old-free-change');assert.equal(view.ledger[1].purchaseId,'paid-purchase');
 assert.equal(view.canRequest,false);assert.equal(view.canPurchase,false);
 assert.equal(JSON.stringify({ledger:f.ledger,purchase:f.purchase}),before);
}));

test('OFFLINE existing reservation stays visible when new capabilities close',async()=>flags('true',async()=>{
 const f=fixture('OFFLINE',{reserved:true});const view=await swapAccountView(f.tx,f.order.id,now,f.order.customerId);assert('cycle' in view);
 assert.equal(view.cycle.freeAvailable,0);assert.equal(view.cycle.freeReserved,1);
 assert.deepEqual(view.reservations,[{id:'reserved',changeId:'old-reservation',source:'FREE',cycleSequence:1,status:'RESERVED',serviceStageId:null}]);assert.equal(view.canRequest,false);
}));

for(const contractMode of ['ESIGN',undefined])test(`legacy ${contractMode} query keeps its original entitlement facts when MVP is off`,async()=>flags('false',async()=>{
 const f=fixture(contractMode);const view=await swapAccountView(f.tx,f.order.id,now,f.order.customerId);assert('cycle' in view);
 assert.equal(view.contractMode,'ESIGN');assert.equal(view.cycle.freeAvailable,1);assert.equal(view.canRequest,true);assert.equal(view.canPurchase,true);
}));

test('MVP closes new ESIGN actions while retaining historical free and paid facts',async()=>flags('true',async()=>{
 const f=fixture('ESIGN',{paid:true});const view=await swapAccountView(f.tx,f.order.id,now,f.order.customerId);assert('cycle' in view);
 assert.equal(view.contractMode,'ESIGN');assert.equal(view.cycle.freeAvailable,1);assert.equal(view.paidAvailable,1);assert.equal(view.purchases[0].paymentId,'paid-payment');
 assert.equal(view.canRequest,false);assert.equal(view.canPurchase,false);
}));
