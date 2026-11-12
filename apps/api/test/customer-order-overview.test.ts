import './legacy-esign-mode';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CustomerController,recordView} from '../src/orders/customer';
const matches=(value:string,rule:any)=>!rule||typeof rule==='string'?(!rule||value===rule):(!rule.notIn||!rule.notIn.includes(value))&&(!rule.in||rule.in.includes(value));
function fixture(){
 const customer={id:'customer',name:'合成客户',mobile:'13900000000',profile:{},drivingYears:3};
 const snapshot:any={monthlyFeeAmount:1,depositAmount:0,months:12,startDate:'2026-01-31T00:00:00.000Z',firstDueDate:'2026-01-31',mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'合成能源',benefits:['基础保养','道路救援'],conditions:'合成使用条件',commercialTerms:{vehicleIdentification:'原车合成标识',insuranceDetails:'合成保险',depositRefundRule:'合成押金退回条件',permittedUse:'合成个人用车'},lessorSnapshot:{name:'合成出租企业',creditCode:'SYNTHETICCODE',providerCustomerId:'SECRET_OWNER_PROVIDER',certificateSerialNo:'SECRET_CERT'},creditVerificationId:'SECRET_CREDIT',creditBand:'SECRET_BAND',providerSecret:'SECRET_PROVIDER'};
 const order:any={id:'order',customerId:customer.id,applicationId:'application',vehicleId:'vehicle',status:'AWAITING_SIGNATURE',createdAt:new Date('2026-10-25T16:01:00Z'),finalPlanSnapshot:snapshot,effectiveTermsVersionId:null,currentAssignmentId:null,vehicle:{id:'vehicle',title:'原订阅车型',coverFileId:'cover',plans:[{monthlyFeeAmount:999999}],providerSecret:'SECRET_VEHICLE'}};
 const contracts:any[]=[{id:'contract-draft',orderId:order.id,customerId:customer.id,kind:'SUBSCRIPTION',status:'DRAFT',createdAt:order.createdAt,sourceFileId:null,providerTaskId:null,providerSecret:'SECRET_TASK',order}];
 const bills:any[]=[{id:'bill-draft',orderId:order.id,customerId:customer.id,type:'SUBSCRIPTION',status:'DRAFT',amount:999,dueDate:new Date('2026-01-31'),createdAt:order.createdAt},{id:'bill-published',orderId:order.id,customerId:customer.id,type:'DEPOSIT',status:'PENDING',amount:0,paidAmount:0,dueDate:new Date('2026-01-31'),createdAt:order.createdAt}];
 const handovers:any[]=[{id:'handover-draft',orderId:order.id,customerId:customer.id,type:'DELIVERY',status:'DRAFT',signatureStatus:'DRAFT',createdAt:order.createdAt}];
 const assignments:any[]=[],versions:any[]=[],calls:any[]=[];
 const scope=(name:string,args:any)=>{calls.push([name,args]);assert.equal(args.where.orderId,order.id,name+' must bind order');assert.equal(args.where.customerId??args.where.order?.customerId,customer.id,name+' must bind customer');};
 const db:any={
  customer:{findUnique:async()=>customer},eSignAccount:{findUnique:async()=>null},
  order:{findFirst:async(args:any)=>{calls.push(['order',args]);return args.where.customerId===customer.id&&(!args.where.id||args.where.id===order.id)&&matches(order.status,args.where.status)?order:null;},findMany:async()=>[order],count:async()=>1},
  contract:{findMany:async(args:any)=>{scope('contract',args);return contracts.filter(c=>c.orderId===args.where.orderId&&c.customerId===args.where.customerId&&matches(c.status,args.where.status));}},
  bill:{findMany:async(args:any)=>{scope('bill',args);return bills.filter(b=>b.orderId===args.where.orderId&&b.customerId===args.where.customerId&&matches(b.status,args.where.status));}},
  handover:{findMany:async(args:any)=>{scope('handover',args);return handovers.filter(h=>h.orderId===args.where.orderId&&h.customerId===args.where.customerId&&matches(h.status,args.where.status));}},
  vehicleAssignment:{findFirst:async(args:any)=>{scope('assignment',args);return assignments.find(a=>a.id===args.where.id&&a.orderId===args.where.orderId&&a.customerId===args.where.customerId&&matches(a.status,args.where.status))||null;},count:async(args:any)=>{scope('assignment-count',args);return assignments.filter(a=>a.orderId===args.where.orderId&&a.customerId===args.where.customerId).length;}},
  orderTermsVersion:{findFirst:async(args:any)=>{scope('terms',args);return versions.find(v=>v.id===args.where.id&&v.orderId===args.where.orderId)||null;}},
  vehicle:{findMany:async()=>[]},customerConsent:{findMany:async()=>[]},application:{findFirst:async(args:any)=>{calls.push(['application',args]);return matches('FINAL_PLAN_CONFIRMED',args.where.status)?{id:'old-application',status:'FINAL_PLAN_CONFIRMED'}:null;}}
 };
 return{db,controller:new CustomerController(db),request:{customer},order,snapshot,contracts,bills,handovers,assignments,versions,calls};
}
test('home prioritizes every current order stage and never regresses to the confirmed application',async()=>{
 const f=fixture();for(const state of ['AWAITING_SIGNATURE','AWAITING_PAYMENT','AWAITING_HANDOVER','ACTIVE','SETTLING']){f.order.status=state;const result=await f.controller.home(f.request);assert.match(result.nextAction!.url,/type=orders&id=order/);if(state==='AWAITING_SIGNATURE'){assert.match(result.nextAction!.description,/准备/);assert.doesNotMatch(result.nextAction!.description,/立即签署/);}}
 f.order.status='COMPLETED';assert.equal((await f.controller.home(f.request)).nextAction,null);const query=f.calls.find(([name])=>name==='order')[1];assert.deepEqual(query.orderBy,{createdAt:'desc'});
});

test('OFFLINE homepage retains a historical awaiting-signature order without advertising new signing',async()=>{
 const previous=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='OFFLINE';
 try{const f=fixture(),result=await f.controller.home(f.request);assert.match(result.nextAction!.url,/type=orders&id=order/);assert.match(result.nextAction!.description,/关闭新增电子签/);assert.doesNotMatch(result.nextAction!.description,/本人完成签署/);assert.equal(f.order.status,'AWAITING_SIGNATURE');}
 finally{if(previous===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=previous;}
});
test('order detail exposes snapshot amounts, safe terms and only published customer-owned related records',async()=>{
 const f=fixture();f.contracts.push({id:'foreign-contract',orderId:'other-order',customerId:'other-customer',status:'SIGNED'});f.bills.push({id:'foreign-bill',orderId:'other-order',customerId:'other-customer',status:'PENDING'});
 const result:any=await f.controller.record('orders','order',f.request),view=result.orderDetail;assert.ok(view,'order-specific detail must exist');assert.equal(view.vehicle.title,'原订阅车型');assert.ok(view.summaryRows.some((r:any)=>r.value==='¥0.01'));assert.ok(view.summaryRows.some((r:any)=>r.value==='¥0.00'));assert.equal(view.createdAtText,'2026-10-26 00:01（北京时间）');assert.ok(view.summaryRows.some((r:any)=>r.value.includes('2027-01-30')));
 assert.equal(view.contracts[0].canSign,false);assert.match(view.contracts[0].statusText,/准备/);assert.equal(view.contracts[0].url,'');assert.deepEqual(view.bills.map((b:any)=>b.id),['bill-published']);assert.deepEqual(view.handovers,[]);
 assert.doesNotMatch(JSON.stringify(result),/SECRET_|999999|creditVerification|finalPlanSnapshot|providerTaskId|certificate/);assert.deepEqual(result.details,[]);assert.deepEqual(result.actions,[]);
 const before=f.calls.length;await assert.rejects(f.controller.record('orders','order',{customer:{id:'other-customer'}}),(e:any)=>e.getStatus?.()===404);assert.equal(f.calls.length,before+1);
});
test('effective terms and active vehicle assignment override original terms without live pricing or stale vehicle fallback',async()=>{
 const f=fixture();f.order.effectiveTermsVersionId='current-version';f.order.currentAssignmentId='current-assignment';f.order.status='ACTIVE';
 f.versions.push({id:'current-version',orderId:f.order.id,version:2,effectiveAt:new Date('2026-10-25T16:00:00Z'),snapshot:{...f.snapshot,monthlyFeeAmount:2500,monthlyAmounts:[2500,2400],billingSchedule:[{sequence:1,amount:2500,dueDate:'2026-02-28'},{sequence:2,amount:2400,dueDate:'2026-03-31'}],startDate:'2026-02-28',commercialTerms:{...f.snapshot.commercialTerms,vehicleIdentification:'新车合成标识'}}});
 f.assignments.push({id:'current-assignment',orderId:'order',customerId:'customer',status:'ACTIVE',vehicle:{title:'当前替换车型',coverFileId:'current-cover'}});
 f.order.vehicle.title='更新后的当前车辆';
 const result:any=await f.controller.record('orders','order',f.request);assert.equal(result.orderDetail.vehicle.title,'当前替换车型');assert.equal(result.orderDetail.vehicle.originalTitle,'原车合成标识');assert.ok(result.orderDetail.sections.some((s:any)=>s.id==='original-terms'));assert.match(JSON.stringify(result.orderDetail.sections),/¥24.00/);assert.doesNotMatch(JSON.stringify(result),/SECRET_|更新后的当前车辆/);
 f.assignments[0].status='CLOSED';f.order.currentAssignmentId=null;const waiting:any=await f.controller.record('orders','order',f.request);assert.equal(waiting.orderDetail.vehicle.title,'当前暂无交付车辆');assert.equal(waiting.orderDetail.vehicle.imageUrl,'');
});
test('missing selected effective version fails closed and an order list never spreads snapshots',async()=>{
 const f=fixture();f.order.effectiveTermsVersionId='missing';await assert.rejects(f.controller.record('orders','order',f.request),(e:any)=>e.getResponse?.()?.error?.code==='TERMS_MISSING');
 const summary=recordView('orders',f.order);assert.doesNotMatch(JSON.stringify(summary),/SECRET_|finalPlanSnapshot|effectiveTermsVersionId|currentAssignmentId/);assert.equal(summary.id,'order');assert.equal(summary.type,'orders');assert.equal(summary.statusText,'待签约');assert.ok(summary.title);
});

test('home keeps awaiting-signature stage explicit for absent, unprepared and prepared contracts',async()=>{
 const f=fixture();f.contracts.length=0;
 assert.match((await f.controller.home(f.request)).nextAction!.title,/待签约.*(准备|核验)/);
 f.contracts.push({id:'pending',orderId:'order',customerId:'customer',kind:'SUBSCRIPTION',status:'PENDING',sourceFileId:'source',providerTaskId:null});
 assert.match((await f.controller.home(f.request)).nextAction!.title,/待签约.*(准备|核验)/);
 f.contracts[0].providerTaskId='SECRET_PROVIDER_TASK';const prepared=(await f.controller.home(f.request)).nextAction!;
 assert.match(prepared.title,/待签约/);assert.match(prepared.description,/核验/);assert.doesNotMatch(JSON.stringify(prepared),/SECRET_|立即签署/);
});

test('a new application cannot displace an open order and only unconfirmed applications are fallback candidates',async()=>{
 const f=fixture(),application={id:'new-application',status:'AWAITING_CONFIRMATION',revision:1};
 f.db.application.findFirst=async(args:any)=>matches(application.status,args.where.status)?application:null;
 assert.match((await f.controller.home(f.request)).nextAction!.url,/type=orders&id=order/);
 f.order.status='COMPLETED';assert.match((await f.controller.home(f.request)).nextAction!.url,/application-detail.*new-application/);
 for(const status of ['FINAL_PLAN_CONFIRMED','REJECTED','CANCELLED']){application.status=status;assert.equal((await f.controller.home(f.request)).nextAction,null);}
});

test('published related records expose read-only links while hidden, foreign and unsigned archives stay private',async()=>{
 const f=fixture();f.contracts.push({id:'signed',orderId:'order',customerId:'customer',kind:'SUBSCRIPTION',status:'SIGNED',createdAt:f.order.createdAt,sourceFileId:'source',signedFileId:'archive',providerTaskId:'SECRET_TASK'});
 f.bills.push(...['REVIEWED','VOID','PAID'].map(status=>({id:status,orderId:'order',customerId:'customer',type:'SUBSCRIPTION',sequence:2,status,amount:1,paidAmount:1,dueDate:new Date('2026-02-28')})));
 f.handovers.push(...['PUBLISHED','CUSTOMER_CONFIRMED','COMPLETED','SUPERSEDED'].map(status=>({id:status,orderId:'order',customerId:'customer',type:'SWAP_DELIVERY',status,signatureStatus:status==='COMPLETED'?'SIGNED':'PENDING',signedFileId:'handover-archive',actualAt:new Date('2026-10-25T16:01:00Z')})),{id:'foreign',orderId:'order',customerId:'other',status:'PUBLISHED'});
 const result:any=await f.controller.record('orders','order',f.request),view=result.orderDetail;
 assert.deepEqual(view.bills.map((b:any)=>b.id),['bill-published','PAID']);assert.deepEqual(view.handovers.map((h:any)=>h.id),['PUBLISHED','CUSTOMER_CONFIRMED','COMPLETED']);
 assert.deepEqual(view.contracts[1].documents,[]);assert.equal(view.contracts[1].statusText,'签署结果核验中');assert.equal(view.contracts[0].url,'');
 assert.equal(view.handovers[0].documents.length,0);assert.equal(view.handovers[2].documents[0].url,'/api/customer/files/handover-archive');
 assert.ok([...view.contracts,...view.bills,...view.handovers].every(item=>item.canSign===false&&item.canPay===false));assert.doesNotMatch(JSON.stringify(result),/SECRET_/);
});

test('closed and foreign assignments never impersonate current vehicles, with historical identity kept frozen',async()=>{
 const f=fixture();f.order.currentAssignmentId='foreign';f.assignments.push({id:'foreign',orderId:'order',customerId:'other',status:'ACTIVE',vehicle:{title:'不得展示的他人车辆'}});
 let result:any=await f.controller.record('orders','order',f.request);assert.equal(result.orderDetail.vehicle.currentState,'AWAITING_DELIVERY');assert.doesNotMatch(JSON.stringify(result),/不得展示的他人车辆/);
 f.order.status='COMPLETED';result=await f.controller.record('orders','order',f.request);assert.equal(result.orderDetail.vehicle.currentState,'RETURNED');assert.equal(result.orderDetail.vehicle.imageUrl,'');
 delete f.snapshot.commercialTerms.vehicleIdentification;result=await f.controller.record('orders','order',f.request);assert.equal(result.orderDetail.vehicle.originalTitle,'原始方案未记录车辆标识');
});

test('month-end and incomplete historical terms never invent price or overflow the rental end date',async()=>{
 const f=fixture();f.snapshot.startDate='2028-01-31';f.snapshot.months=1;f.snapshot.monthlyFeeAmount=0;f.snapshot.depositAmount=1;
 let result:any=await f.controller.record('orders','order',f.request);assert.deepEqual(result.orderDetail.summaryRows.map((r:any)=>r.value),['¥0.00','¥0.01','1 个月','2028-01-31 至 2028-02-28']);
 f.order.finalPlanSnapshot={};result=await f.controller.record('orders','order',f.request);assert.deepEqual(result.orderDetail.summaryRows.map((r:any)=>r.value),['未提供','未提供','未提供','未提供 至 未提供']);assert.equal(result.amount,null);
});

test('awaiting-payment guidance waits for publication when customer-visible bills are absent',async()=>{
 const f=fixture();f.order.status='AWAITING_PAYMENT';for(const status of ['DRAFT','REVIEWED','VOID']){f.bills.forEach(b=>b.status=status);const home:any=await f.controller.home(f.request),detail:any=await f.controller.record('orders','order',f.request);assert.match(home.nextAction.title,/账单待发布/);assert.match(home.nextAction.description,/等待.*核对.*发布/);assert.deepEqual(detail.orderDetail.guidance,{title:home.nextAction.title,description:home.nextAction.description});assert.deepEqual(detail.orderDetail.bills,[]);assert.deepEqual(detail.actions,[]);}
 f.bills.length=0;assert.match((await f.controller.home(f.request)).nextAction!.title,/账单待发布/);
});

test('published future one-fen bill keeps existing navigation and detail pay action without aggregate permissions',async()=>{
 const f=fixture();f.order.status='AWAITING_PAYMENT';f.bills.length=0;f.bills.push({id:'first-rent',orderId:'order',customerId:'customer',type:'SUBSCRIPTION',sequence:1,status:'PENDING',amount:1,paidAmount:0,dueDate:new Date('2027-10-25'),createdAt:f.order.createdAt});
 const home:any=await f.controller.home(f.request);assert.match(home.nextAction.description,/已发布账单.*支付/);const homeBillQuery=f.calls.find(([name])=>name==='bill');assert.ok(homeBillQuery,'home must derive guidance from scoped published bills');assert.equal(homeBillQuery[1].where.orderId,'order');assert.equal(homeBillQuery[1].where.customerId,'customer');
 const result:any=await f.controller.record('orders','order',f.request),row=result.orderDetail.bills[0];assert.equal(row.amountText,'¥0.01');assert.equal(row.url,'/pages/record/index?type=bills&id=first-rent');assert.equal(row.canPay,false);assert.equal(row.dateText,'应付日期 2027-10-25');assert.deepEqual(recordView('bills',f.bills[0]).actions,[{id:'pay',label:'立即支付'}]);assert.deepEqual(result.orderDetail.guidance,{title:home.nextAction.title,description:home.nextAction.description});assert.equal(f.calls.filter(([name])=>name==='bill').length,2,'order detail must reuse its existing bill read');
});

test('paid-only awaiting-payment order requests financial verification without asking for another payment or publication',async()=>{
 const f=fixture();f.order.status='AWAITING_PAYMENT';f.bills.forEach(b=>Object.assign(b,{status:'PAID',amount:1,paidAmount:1}));const home:any=await f.controller.home(f.request),detail:any=await f.controller.record('orders','order',f.request);assert.match(home.nextAction.title,/资金状态核对/);assert.doesNotMatch(home.nextAction.description,/完成支付|账单.*发布/);assert.deepEqual(detail.orderDetail.guidance,{title:home.nextAction.title,description:home.nextAction.description});assert.ok(detail.orderDetail.bills.every((b:any)=>b.canPay===false));
});

test('foreign customer or order pending bills never turn unpublished order guidance into a payment request',async()=>{
 const f=fixture();f.order.status='AWAITING_PAYMENT';f.bills.forEach(b=>b.status='DRAFT');f.bills.push({id:'different-order',orderId:'other',customerId:'customer',status:'PENDING',amount:1,paidAmount:0},{id:'different-customer',orderId:'order',customerId:'other',status:'PENDING',amount:1,paidAmount:0});const home:any=await f.controller.home(f.request),detail:any=await f.controller.record('orders','order',f.request);assert.match(home.nextAction.title,/账单待发布/);assert.deepEqual(detail.orderDetail.bills,[]);assert.deepEqual(detail.orderDetail.guidance,{title:home.nextAction.title,description:home.nextAction.description});assert.doesNotMatch(JSON.stringify(home),/different-order|different-customer/);
});

test('zero, fractional or partly-paid pending bills require verification rather than a payment instruction',async()=>{
 for(const data of [{amount:0,paidAmount:0},{amount:1.5,paidAmount:0},{amount:1,paidAmount:1},{amount:1,paidAmount:undefined}]){const f=fixture();f.order.status='AWAITING_PAYMENT';f.bills.length=0;f.bills.push({id:'invalid-pending',orderId:'order',customerId:'customer',type:'SUBSCRIPTION',sequence:1,status:'PENDING',dueDate:new Date('2027-10-25'),createdAt:f.order.createdAt,...data});const home:any=await f.controller.home(f.request),detail:any=await f.controller.record('orders','order',f.request);assert.match(home.nextAction.title,/资金状态核对/);assert.deepEqual(detail.orderDetail.guidance,{title:home.nextAction.title,description:home.nextAction.description});}
});

test('published pending bill takes payment guidance precedence over paid records and other home stages avoid bill reads',async()=>{
 const f=fixture();f.order.status='AWAITING_PAYMENT';Object.assign(f.bills[0],{status:'PAID',amount:1,paidAmount:1});Object.assign(f.bills[1],{status:'PENDING',amount:1,paidAmount:0});assert.match((await f.controller.home(f.request)).nextAction!.description,/已发布账单.*支付/);
 const paymentReads=f.calls.filter(([name])=>name==='bill').length;for(const status of ['AWAITING_SIGNATURE','AWAITING_HANDOVER','ACTIVE','SETTLING']){f.order.status=status;await f.controller.home(f.request);}assert.equal(f.calls.filter(([name])=>name==='bill').length,paymentReads,'only awaiting-payment home needs its own bill query');
});
