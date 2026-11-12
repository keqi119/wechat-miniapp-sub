import test from 'node:test';
import assert from 'node:assert/strict';
import {AdminController} from '../src/operations/admin';
import {applicationView} from '../src/applications/applications';

const record={id:'application-progress-fixture',customerId:'customer-fixture',status:'NEEDS_INFO',revision:2,note:'请补充清晰的驾驶证副页。\n证件有效期需完整显示。',finalPlans:[],customer:{id:'customer-fixture',name:'合成客户'}};
const controller=(status=record.status)=>new AdminController({application:{findUnique:async()=>({...record,status})}} as any);
test('admin application detail exposes the current processing reason to operations and admin',async()=>{
 for(const role of ['ADMIN','OPERATIONS'])for(const status of ['NEEDS_INFO','REJECTED','CANCELLED']){
  const result=await controller(status).detail('applications',record.id,{admin:{role}});
  assert.equal(result.note,record.note);assert.equal(result.status,status);
 }
});
test('processing note is not added to other-role detail or the customer application projection',async()=>{
 for(const role of ['SUPPORT','FINANCE','FIELD']){
  const result=await controller().detail('applications',record.id,{admin:{role}});
  assert.equal(Object.hasOwn(result,'note'),false);
 }
 assert.equal(Object.hasOwn(applicationView(record),'note'),false);
});
