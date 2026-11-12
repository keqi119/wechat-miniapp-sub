import test from 'node:test';
import assert from 'node:assert/strict';
import {workAccess,workInteger,workDate,workTimestamp,workCreatePayload,workEvidence} from './work-order-model.ts';
test('work order access respects both actual role and resource permission',()=>{
 assert.deepEqual(workAccess('asset-work-orders','FINANCE',['*']),{read:true,write:false});
 assert.deepEqual(workAccess('vehicle-maintenance','FINANCE',['*']),{read:false,write:false});
 for(const role of ['FIELD','SUPPORT',undefined])assert.equal(workAccess('asset-work-orders',role,['*']).read,false);
 assert.equal(workAccess('asset-work-orders','OPERATIONS',['asset-work-orders.read']).write,false);
});
test('work inputs keep true Shanghai dates, exact integer mileage and selected parent evidence',()=>{
 assert.equal(workInteger('0','里程'),0);assert.equal(workDate('2028-02-29','日期'),'2028-02-29');
 assert.equal(workTimestamp('2026-10-30T12:34','发生时间'),'2026-10-30T12:34:00+08:00');
 for(const value of ['-1','1.2','1e3','2147483648'])assert.throws(()=>workInteger(value,'里程'));
 for(const value of ['2026-02-30','10000-01-01','0000-01-01'])assert.throws(()=>workDate(value,'日期'));
 assert.throws(()=>workEvidence(['foreign'],[{id:'own'}]));assert.throws(()=>workEvidence([],[]));
});
test('creation is explicit and cannot invent source ownership, costs or accident facts',()=>{
 const values={title:'维修',description:'实际处理',kind:'REPAIR',priority:'NORMAL',occurredAt:'2026-10-30T12:34',costConfirmationRequired:true,noCostReason:''};
 const body=workCreatePayload(values,{id:'vehicle',title:'真实车辆',revision:7});assert.equal(body.vehicleRevision,7);assert.equal(body.sourceServiceRequestId,null);assert.equal(body.accident,null);assert.equal(body.noCostReason,null);
 assert.throws(()=>workCreatePayload({...values,costConfirmationRequired:false},{id:'vehicle',revision:7}));
 assert.throws(()=>workCreatePayload({...values,kind:'ACCIDENT_REPAIR'},{id:'vehicle',revision:7}));
 assert.throws(()=>workCreatePayload({...values,title:'x\0'},{id:'vehicle',revision:7}));
});
