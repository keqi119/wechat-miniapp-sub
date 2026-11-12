import test from 'node:test';
import assert from 'node:assert/strict';
import {workCreatePayload} from './work-order-model.ts';
import {workSourceScope,workSourceAccess,readWorkSourceDetail} from './work-order-source-model.ts';
const vehicle={id:'v',revision:2},values={kind:'REPAIR',priority:'NORMAL',title:'实际维修',description:'处理说明',occurredAt:'2026-10-30T10:00',costConfirmationRequired:true};
const detail={id:'s',revision:3,type:'repair',status:'SUBMITTED',description:'来源说明',createdAt:'2026-10-30T03:00:00Z',orderId:'o',location:'地点',sourceHash:'a'.repeat(64),assignment:{vehicleId:'v',assignmentId:'a',eventAt:'2026-10-30T02:00:00Z',startAt:'2026-01-01T00:00:00Z',endAt:null}};
test('source binding requires a verified same-vehicle event detail while independent shape stays unchanged',()=>{
 assert.equal(workCreatePayload(values,vehicle).sourceServiceRequestId,null);
 assert.deepEqual(workSourceScope(values,vehicle),{vehicleId:'v',eventAt:'2026-10-30T10:00:00+08:00'});
 const parsed=readWorkSourceDetail(detail,'s',workSourceScope(values,vehicle)!);const bound=workCreatePayload({...values,sourceMode:'CUSTOMER_SERVICE'},vehicle,{...parsed,confirmed:true});assert.equal(bound.sourceServiceRequestId,'s');assert.equal(bound.sourceServiceRequestRevision,3);assert.equal(bound.sourceServiceRequestHash,'a'.repeat(64));
 assert.throws(()=>workCreatePayload({...values,sourceMode:'CUSTOMER_SERVICE'},vehicle,{...parsed,confirmed:false}));assert.throws(()=>workCreatePayload({...values,sourceMode:'CUSTOMER_SERVICE',occurredAt:'2026-10-30T11:00'},vehicle,{...parsed,confirmed:true}));
 for(const bad of [{...detail,status:'CANCELLED'},{...detail,revision:-1},{...detail,sourceHash:'bad'},{...detail,assignment:{...detail.assignment,vehicleId:'other'}}])assert.throws(()=>readWorkSourceDetail(bad,'s',workSourceScope(values,vehicle)!));
 assert.equal(workSourceScope({...values,kind:'ACCIDENT_REPAIR',accidentAt:'2026-09-30T09:00'},vehicle)?.eventAt,'2026-09-30T09:00:00+08:00');
});
test('source selector requires current operational role and both read permissions',()=>{
 for(const role of ['ADMIN','OPERATIONS'])assert.equal(workSourceAccess(role,['services.read','asset-work-orders.read']),true);
 for(const role of ['FINANCE','FIELD','SUPPORT'])assert.equal(workSourceAccess(role,['*']),false);
 assert.equal(workSourceAccess('OPERATIONS',['asset-work-orders.read']),false);
});
