import {confirmedStageSwapFixture} from './stage-offline-swap-fixture';
import {prepareFinance} from '../src/order-changes/finance';
import {BillingService} from '../src/billing/billing';
const renewalNow=new Date('2027-10-02T03:00:00Z');
export async function stageSwapPaymentFixture(){
 const f=await confirmedStageSwapFixture(),tx=f.tx;await prepareFinance(tx,f.change,{id:'finance'});
 const stage=f.stage,first=f.bills.find(b=>b.type==='SWAP_ADJUSTMENT')!,second=f.bills.filter(b=>b.type==='SWAP_ADJUSTMENT')[1]!;
 const pending:any[]=[];const counters={gateway:0,created:0,allocated:0};let providerEffect:()=>void=()=>{};
 const matches=(row:any,where:any={})=>Object.entries(where).every(([key,value]:any)=>value&&typeof value==='object'&&!Array.isArray(value)?value.in?value.in.includes(row[key]):value.notIn?!value.notIn.includes(row[key]):value.not!==undefined?row[key]!==value.not:row[key]===value:row[key]===value);
 tx.orderChange.findFirst=async({where}:any)=>f.changes.find(c=>matches(c,where))??null;
 tx.orderTermsVersion.findUnique=async({where}:any)=>f.terms.find(t=>t.id===where.id)??null;
 tx.order.findUniqueOrThrow=async()=>f.order;tx.order.update=async({data}:any)=>{if(data.revision?.increment)f.order.revision+=data.revision.increment;return f.order;};
 tx.bill.findFirst=async({where}:any)=>f.bills.find(b=>matches(b,where))??null;
 tx.bill.findUniqueOrThrow=async({where}:any)=>f.bills.find(b=>b.id===where.id);
 tx.bill.update=async({where,data}:any)=>Object.assign(f.bills.find(b=>b.id===where.id)!,data);
 const money=()=>[...pending,...f.bills.flatMap(b=>b.payments)];
 const hydrate=(p:any,include:any)=>p?include?.bill?{...p,bill:{...f.bills.find(b=>b.id===p.billId),...(include.bill?.include?.order?{order:f.order}:{})}}:p:null;
 tx.payment={
  findUnique:async({where,include}:any)=>hydrate(where.id?money().find(p=>p.id===where.id):money().find(p=>p.customerId===where.customerId_idempotencyKey.customerId&&p.idempotencyKey===where.customerId_idempotencyKey.idempotencyKey),include),
  findFirst:async({where,include}:any)=>hydrate(money().find(p=>matches(p,where)),include),
  findUniqueOrThrow:async({where}:any)=>money().find(p=>p.id===where.id),
  create:async({data}:any)=>{const p={id:'request-'+pending.length,status:'CREATING',createdAt:renewalNow,updatedAt:renewalNow,refunds:[],...data};pending.push(p);counters.created++;return p;},
  update:async({where,data}:any)=>Object.assign(money().find(p=>p.id===where.id)!,data),
  updateMany:async({where,data}:any)=>{const rows=money().filter(p=>matches(p,where));rows.forEach(p=>Object.assign(p,data));return{count:rows.length};},
 };
 tx.serviceObligation.findFirst=async({where}:any)=>f.obligations.find(o=>matches(o,where))??null;
 tx.serviceObligation.count=async({where}:any)=>f.obligations.filter(o=>matches(o,where)).length;
 tx.serviceObligation.findMany=async({where}:any={})=>f.obligations.filter(o=>matches(o,where));
 tx.paymentAllocation.findUnique=async({where}:any)=>f.allocations.find(a=>matches(a,where.paymentId_obligationId))??null;
 tx.paymentAllocation.findMany=async({where}:any={})=>f.allocations.filter(a=>matches({...a,releasedAt:a.releasedAt??null},where));
 tx.paymentAllocation.upsert=async({where,create}:any)=>{const old=f.allocations.find(a=>matches(a,where.paymentId_obligationId));if(old)return old;const row={id:'allocation-'+f.allocations.length,releasedAt:null,...create};f.allocations.push(row);counters.allocated++;return row;};
 tx.usageAccount.update=async()=>f.account;
 tx.documentArchive.findFirst=async({where}:any)=>f.archives.find(a=>matches(a,where))??null;
 tx.vehicleReceiptEvent={findFirst:async()=>null};tx.archiveFeedback={count:async()=>0};
 const revenueEvents:any[]=[];
 tx.notification={create:async()=>({})};
 tx.partnerRevenueEvent={findUnique:async({where}:any)=>revenueEvents.find(e=>matches(e,where.sourceType_sourceId))??null,findMany:async({where}:any)=>revenueEvents.filter(e=>matches(e,where)),create:async({data}:any)=>{const e={id:'revenue-'+revenueEvents.length,...data};revenueEvents.push(e);return e;}};
 tx.refund={...tx.refund,findMany:async({where}:any)=>money().flatMap(p=>p.refunds).filter(r=>matches(r,where))};
 const db:any={...tx,serial:async(fn:any)=>fn(tx)},gateway:any={create:async()=>{counters.gateway++;providerEffect();return{timeStamp:String(Math.floor(Date.now()/1000)),nonceStr:'synthetic'};}};
 const billing=new BillingService(db,gateway,()=>renewalNow);
 const late=(bill=first)=>{const p={id:'late-'+pending.length,billId:bill.id,customerId:f.customer.id,amount:bill.amount,status:'PENDING',reconciliationRequired:false,createdAt:renewalNow,updatedAt:renewalNow,refunds:[]};pending.push(p);return p;};
 return{...f,stage,first,second,tx,db,billing,pending,counters,late,revenueEvents,providerEffect:(fn:()=>void)=>providerEffect=fn,invalidate:()=>{f.paper.status='INVALIDATED';}};
}
