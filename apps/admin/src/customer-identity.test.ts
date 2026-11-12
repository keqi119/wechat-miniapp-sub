import test from 'node:test';
import assert from 'node:assert/strict';
import {resources,detailFor} from './resources.ts';
import {roleDetail} from './modules/navigation.ts';
import {customerIdentityDisplay,customerIdentityColumnVisible} from './customer-identity-model.ts';

test('customer lists expose a distinct real-name column and generic details do not render provider identity objects',()=>{
 const customer=resources.find(r=>r.key==='customers')!;
 assert(customer.columns.some(c=>c.key==='identity.status'));
 assert(!('identity' in detailFor('customers',{id:'customer',name:'填报姓名',identity:{status:'VERIFIED',verified:true,name:'认证姓名',rawId:'do-not-render'}})));
});
test('non-reviewer customer detail projections exclude real-name information even for unknown roles',()=>{
 for(const role of ['SUPPORT','FINANCE','FIELD','UNKNOWN',undefined])assert(!('identity' in roleDetail('customers',{id:'customer',identity:{status:'VERIFIED',name:'private-name'}},role)),String(role));
});
test('real-name status requires trusted verified state and never substitutes ordinary customer name',()=>{
 for(const [identity,expected] of [[undefined,'待核实'],[{},'待核实'],[{status:'UNKNOWN'},'待核实'],[{status:'NOT_STARTED',verified:false},'未实名'],[{status:'PENDING',verified:false},'认证中'],[{status:'FAILED',verified:false},'认证未通过'],[{status:'VERIFIED',verified:false},'待核实'],[{status:'PENDING',verified:true},'待核实'],[{status:'VERIFIED',verified:true},'已实名']] as const)assert.equal(customerIdentityDisplay(identity).status,expected);
 assert.equal(customerIdentityDisplay({status:'FAILED',name:'不可信姓名',maskedIdCardNo:'110***********1234',verifiedAt:'2026-11-10T00:00:00Z'}).name,'');
 const identity=customerIdentityDisplay({status:'VERIFIED',verified:true,name:'合成认证姓名',maskedIdCardNo:'110***********1234',verifiedAt:'2026-11-10T00:00:00Z',rawId:'110101199001011234',providerAccountId:'not-public'});
 assert.deepEqual(identity,{verified:true,status:'已实名',name:'合成认证姓名',maskedIdCardNo:'110***********1234',verifiedAt:'2026-11-10T00:00:00Z'});
 assert.equal(customerIdentityDisplay({status:'VERIFIED',verified:true,maskedIdCardNo:'110101199001011234'}).maskedIdCardNo,'');
 for(const role of ['SUPPORT','FINANCE','FIELD',undefined])assert.equal(customerIdentityColumnVisible('identity.status',role),false);
});
