import test from 'node:test';
import assert from 'node:assert/strict';
import {EnterpriseSealController} from '../src/esign/esign.controller';
import {BillingController} from '../src/billing/billing';
import {OrderActionsController} from '../src/orders/order-actions';
import {platformLegalEntity} from '../src/common/platform-legal-entity';
import {hash} from '../src/common/data';
const actor={id:'admin',role:'ADMIN',authVersion:1},request={admin:actor};
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
function persistence(purpose='evidence',bound=false){
 const rows:any[]=[],audits:any[]=[],notices:any[]=[],file={id:'proof',customerId:null,purpose};
 const tx:any={adminUser:{findUnique:async()=>({...actor,active:true})},vehicleInspectionFile:{count:async({where}:any)=>Number(bound&&where.fileId.in.includes(file.id))},storedFile:{count:async({where}:any)=>Number((where.id===file.id||where.id?.in?.includes(file.id))&&(!where.purpose||where.purpose===file.purpose))},auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},notification:{create:async({data}:any)=>{notices.push(data);return data;}},$queryRaw:async()=>[],serial:async(f:any)=>f(tx)};
 return{tx,rows,audits,notices,file};
}
async function enabled(action:()=>Promise<void>){const prior=process.env.ESIGN_NEW_REQUESTS_ENABLED;process.env.ESIGN_NEW_REQUESTS_ENABLED='true';try{await action();}finally{if(prior===undefined)delete process.env.ESIGN_NEW_REQUESTS_ENABLED;else process.env.ESIGN_NEW_REQUESTS_ENABLED=prior;}}
test('enterprise seal draft rejects inspection purpose or binding before creating a seal or audit',()=>enabled(async()=>{
 for(const[purpose,bound]of [['vehicle-inspection',false],['evidence',true]]as const){
  const f=persistence(purpose,bound);f.tx.enterpriseSeal={create:async({data}:any)=>{const row={id:'draft-seal',...data};f.rows.push(row);return row;}};
  const c=new EnterpriseSealController(f.tx,{}as any);
  await assert.rejects(c.create(request,{sealName:'合成章',organizationName:platformLegalEntity(),providerCustomerId:'synthetic',providerSignatureId:'synthetic',evidenceFileId:'proof'}),code('VEHICLE_INSPECTION_ROUTE_REQUIRED'));
  assert.equal(f.rows.length,0);assert.equal(f.audits.length,0);
 }
}));
test('ordinary seal evidence still creates only an unactivated draft',()=>enabled(async()=>{
 const f=persistence();f.tx.enterpriseSeal={create:async({data}:any)=>{const row={id:'draft-seal',...data};f.rows.push(row);return row;}};
 const row=await new EnterpriseSealController(f.tx,{}as any).create(request,{sealName:'合成章',organizationName:platformLegalEntity(),providerCustomerId:'synthetic',providerSignatureId:'synthetic',evidenceFileId:'proof'});
 assert.equal(row.status,'DRAFT');assert.equal(f.rows.length,1);assert.equal(f.audits.length,1);
}));
const billInput={orderId:'order',type:'EXTRA_FEE',amount:100,dueDate:'2026-11-03',description:'合成本地费用',fileIds:['proof'],idempotencyKey:'synthetic-bill-key'};
function billing(bound:boolean,old=false){const f=persistence('evidence',bound);const receipt={id:'bill',...billInput,dueDate:new Date('2026-11-03T00:00:00Z'),evidenceFileIds:['proof']};f.tx.order={findUnique:async()=>({id:'order',customerId:'customer',status:'ACTIVE'})};f.tx.bill={findUnique:async()=>old?receipt:null,aggregate:async()=>({_max:{sequence:0}}),create:async({data}:any)=>{const row={id:'bill',status:'DRAFT',...data};f.rows.push(row);return row;}};return{...f,receipt,c:new BillingController(f.tx,{}as any,{}as any)};}
test('fee creation and same-key replay reject a bound inspection even if its purpose says evidence',async()=>{
 for(const old of [false,true]){const f=billing(true,old);await assert.rejects(f.c.createBill(billInput,request),code('VEHICLE_INSPECTION_ROUTE_REQUIRED'));assert.equal(f.rows.length,0);assert.equal(f.audits.length,0);}
 const historical=billing(true,true);await assert.rejects(historical.c.createBill({...billInput,fileIds:[]},request),code('VEHICLE_INSPECTION_ROUTE_REQUIRED'));
});
test('ordinary evidence creates a draft fee and replays the matching receipt',async()=>{
 const fresh=billing(false),row=await fresh.c.createBill(billInput,request);assert.equal(row.status,'DRAFT');assert.equal(row.evidenceFileIds[0],'proof');
 const old=billing(false,true);assert.deepEqual(await old.c.createBill(billInput,request),old.receipt);assert.equal(old.rows.length,0);
});
function cancellation(bound:boolean){
 const f=persistence('vehicle-inspection',bound),order:any={id:'order',vehicleId:'car',customerId:'customer',contractMode:'ESIGN',status:'AWAITING_PAYMENT',revision:0,contracts:[],bills:[],handovers:[]};
 f.tx.order={findUnique:async()=>order,update:async({data}:any)=>{f.rows.push(data);return{...order,...data};}};
 f.tx.vehicle={findUnique:async()=>({id:'car',status:'RESERVED',reservedOrderId:'order'}),update:async()=>{f.rows.push('vehicle-release');return{};}};
 for(const name of ['orderChange','fadadaTask','fieldHandoverTask','returnSettlement'])f.tx[name]={findMany:async()=>[]};
 for(const name of ['bill','entitlement','handover'])f.tx[name]={updateMany:async()=>({count:0})};
 return{...f,order,c:new OrderActionsController(f.tx)};
}
test('pre-signature cancellation rejects an optional inspection attachment without releasing the vehicle',async()=>{
 const f=cancellation(true);await assert.rejects(f.c.cancel('order',{reason:'合成取消',terminationFileId:'proof'},request),code('VEHICLE_INSPECTION_ROUTE_REQUIRED'));assert.equal(f.rows.length,0);assert.equal(f.audits.length,0);assert.equal(f.notices.length,0);
});
test('offline cancellation replay rechecks the returned termination attachment',async()=>{
 const f=cancellation(true),input={reason:'合成取消',revision:0,idempotencyKey:'cancel-replay-key'};
 Object.assign(f.order,{contractMode:'OFFLINE',status:'CANCELLED'});f.tx.archiveCommand={findUnique:async()=>({requestHash:hash(input),resultSnapshot:{id:'order',status:'CANCELLED',terminationFileId:'proof'}})};
 await assert.rejects(f.c.cancel('order',input,request),code('VEHICLE_INSPECTION_ROUTE_REQUIRED'));assert.equal(f.rows.length,0);
});
test('unattached pre-signature cancellation retains its existing business transition',async()=>{
 const f=cancellation(false),row=await f.c.cancel('order',{reason:'合成取消'},request);assert.equal(row.status,'CANCELLED');assert.equal(f.rows[0],'vehicle-release');assert.equal(f.audits.length,1);assert.equal(f.notices.length,1);
});
