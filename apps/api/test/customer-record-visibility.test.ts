import {test} from 'node:test';
import assert from 'node:assert/strict';
import {customerHiddenRecords,assertCustomerRecordVisible} from '../src/customers/record-visibility';
import {Access} from '../src/auth/access';
import {CustomerController} from '../src/orders/customer';
import {OfflineWorkspaceService} from '../src/offline-documents/workspace.service';

const marker=(customerId='customer')=>({action:'TEST_ORDER_CUSTOMER_CLEARED',resourceType:'orders',resourceId:'order-one',data:{customerId,records:{orders:['order-one'],bills:['bill-one'],applications:['app-one'],offlineArchives:['archive-one']}}});
const code=(e:any)=>e.getResponse?.().error?.code==='NOT_FOUND';
test('only valid exact-customer fixed-action audit manifests hide known record categories',async()=>{
 let query:any;const db:any={auditLog:{findMany:async(q:any)=>{query=q;return[marker(),marker('foreign'),{...marker(),action:'OTHER'},{...marker(),data:{customerId:'customer',records:{orders:['bad/id']}}}];}}};
 const hidden=await customerHiddenRecords(db,'customer');assert.deepEqual(hidden.orders,['order-one']);assert.deepEqual(hidden.bills,['bill-one']);assert.equal(hidden.customers,undefined);
 assert.equal(query.where.action,'TEST_ORDER_CUSTOMER_CLEARED');assert.equal(query.where.resourceType,'orders');assert.deepEqual(query.where.data,{path:['customerId'],equals:'customer'});
 for(const path of ['/customer/records/orders/order-one','/customer/orders/order%2Done/workspace','/customer/bills/bill-one/pay','/customer/offline-archives/archive-one'])await assert.rejects(assertCustomerRecordVisible(db,'customer',path),code);
 for(const path of ['/customer/orders/order-one-more','/customer/vehicles/order-one','/customer/profile','/customer/orders/other'])await assertCustomerRecordVisible(db,'customer',path);
});
test('Access applies hidden-path rejection after authenticated customer session',async()=>{
 let reads=0;const db:any={customerSession:{findUnique:async()=>({expiresAt:new Date(Date.now()+60000),customer:{id:'customer'}})},auditLog:{findMany:async()=>{reads++;return[marker()];}}};
 const access=new Access(db);const call=(authorization:string,path='/api/customer/orders/order-one')=>access.canActivate({switchToHttp:()=>({getRequest:()=>({path,method:'GET',headers:{authorization}}),getResponse:()=>({setHeader(){}})})} as any);
 await assert.rejects(call(''));assert.equal(reads,0);await assert.rejects(call('Bearer test'),code);assert.equal(await call('Bearer test','/api/customer/vehicles/order-one'),true);
});
test('record list excludes hidden IDs before both pagination and count',async()=>{
 const queries:any[]=[];const db:any={auditLog:{findMany:async()=>[marker()]},order:{findMany:async(q:any)=>{queries.push(q);return[];},count:async(q:any)=>{queries.push(q);return 0;}}};
 await new CustomerController(db).records('orders',{page:2,pageSize:10},{customer:{id:'customer'}});
 assert.deepEqual(queries[0].where,{customerId:'customer',id:{notIn:['order-one']}});assert.deepEqual(queries[1].where,queries[0].where);assert.equal(queries[0].skip,10);
});
test('customer workbench excludes hidden orders before pagination and count',async()=>{
 const queries:any[]=[];const db:any={auditLog:{findMany:async()=>[marker()]},order:{findMany:async(q:any)=>{queries.push(q);return[];},count:async(q:any)=>{queries.push(q);return 0;}}};
 await new OfflineWorkspaceService(db).workbench({page:2,pageSize:10},{role:'CUSTOMER',id:'customer'} as any);
 assert.deepEqual(queries[0].where,{customerId:'customer',id:{notIn:['order-one']}});assert.deepEqual(queries[1].where,queries[0].where);assert.equal(queries[0].skip,10);
});
test('home and dashboard exclude every explicitly hidden related record at the database query',async()=>{
 const m=marker();Object.assign(m.data.records,{services:['service-one'],entitlements:['entitlement-one'],handovers:['handover-one']});
 const seen:Record<string,any[]>={};const db:any={auditLog:{findMany:async()=>[m]},vehicle:{findMany:async()=>[]}};
 for(const [model,category] of Object.entries({order:'orders',application:'applications',bill:'bills',serviceRequest:'services',entitlement:'entitlements',handover:'handovers'})){
  seen[category]=[];const read=async(q:any)=>{seen[category].push(q.where);return ['bill','serviceRequest','entitlement'].includes(model)?[]:null;};db[model]={findFirst:read,findMany:read};
 }
 const controller=new CustomerController(db);controller.context=async()=>({}) as any;
 await controller.home({customer:{id:'customer'}});await controller.dashboard({customer:{id:'customer'}});
 for(const [category,queries] of Object.entries(seen))for(const where of queries)assert.deepEqual(where.id,{notIn:(m.data.records as any)[category]},category);
 assert.equal(seen.orders.length,2);assert.equal(seen.applications.length,2);assert.equal(seen.services.length,1);
});
test('other customers retain their lists and direct links and admin access never reads cleanup manifests',async()=>{
 const queries:any[]=[];const db:any={auditLog:{findMany:async()=>[marker()]},order:{findMany:async(q:any)=>{queries.push(q);return[];},count:async()=>0}};
 await new CustomerController(db).records('orders',{}, {customer:{id:'other-customer'}});assert.deepEqual(queries[0].where,{customerId:'other-customer'});
 await assertCustomerRecordVisible(db,'other-customer','/customer/orders/order-one');
 const adminDb:any={adminSession:{findUnique:async()=>({expiresAt:new Date(Date.now()+60000),authVersion:1,admin:{id:'admin',role:'ADMIN',active:true,authVersion:1}})},auditLog:{findMany:async()=>{assert.fail('admin must not read cleanup manifests');}}};
 assert.equal(await new Access(adminDb).canActivate({switchToHttp:()=>({getRequest:()=>({path:'/api/admin/orders/order-one',method:'GET',cookies:{admin_session:'test'},headers:{}}),getResponse:()=>({setHeader(){}})})} as any),true);
});
