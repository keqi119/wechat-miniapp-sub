import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdminController} from '../src/operations/admin';
test('finance payment exception queue applies the same filter to records and total',async()=>{
 const calls:any[]=[];const db:any={payment:{findMany:async(args:any)=>{calls.push(args.where);return[];},count:async(args:any)=>{calls.push(args.where);return 2;}}};
 const result=await new AdminController(db).list('payments',{reconciliationRequired:'true',page:1,pageSize:20},{admin:{role:'FINANCE'}});
 assert.deepEqual(calls,[{reconciliationRequired:true},{reconciliationRequired:true}]);assert.equal(result.total,2);
});
test('dashboard reports a complete payment exception count only for money-reading roles',async()=>{
 let reads=0;const count={count:async()=>0,findMany:async()=>[]};const db:any={application:count,contract:count,bill:count,handover:count,serviceRequest:count,refund:count,auditLog:{findMany:async()=>[]},payment:{count:async(args:any)=>{reads++;assert.deepEqual(args.where,{reconciliationRequired:true});return 7;}}};
 for(const name of ['partnerRevenueRuleVersion','partnerAccountVersion','partnerSettlement'])db[name]=count;const api=new AdminController(db);assert.equal((await api.dashboard({admin:{role:'FINANCE'}})).counts.paymentExceptions,7);
 assert.equal((await api.dashboard({admin:{role:'SUPPORT'}})).counts.paymentExceptions,0);assert.equal(reads,2);
});
