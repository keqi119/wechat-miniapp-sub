import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {FieldHandoverService} from '../src/field-handover/service';
import {offlineOrder} from './offline-fixtures';

let db:Db,service:FieldHandoverService,fieldId:string,managerId:string;
before(async()=>{db=new Db();service=new FieldHandoverService(db);const f=await db.adminUser.create({data:{username:randomUUID(),name:'合成现场人员',role:'FIELD',passwordHash:'synthetic-disabled-password'}});fieldId=f.id;managerId=(await db.adminUser.create({data:{username:randomUUID(),name:'合成运营人员',role:'OPERATIONS',passwordHash:'synthetic-disabled-password'}})).id;});
after(()=>db.$disconnect());
const input=(orderId:string,type='DELIVERY')=>({orderId,type,assigneeId:fieldId,note:'合成测试，不执行真实交接'});
function conflict(expected:RegExp){return(error:any)=>{assert.equal(error.getStatus(),409);const body=error.getResponse();assert.equal(body.error.code,'STATE_CONFLICT');assert.match(body.error.message,expected);return true;};}

test('unpaid first rent gives actionable delivery guidance and cannot create a task or advance the order',async()=>{
 const f=await offlineOrder(db);const before=await db.order.update({where:{id:f.order.id},data:{status:'AWAITING_PAYMENT'}});
 await db.bill.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'PAYMENT_TEST',sequence:1,amount:1,paidAmount:1,dueDate:new Date(),status:'PAID',description:'合成测试款'}});
 await assert.rejects(service.create(input(f.order.id),managerId),conflict(/待支付.*首期租金.*待交付/));
 assert.equal(await db.fieldHandoverTask.count({where:{orderId:f.order.id}}),0);
 assert.equal(await db.handover.count({where:{orderId:f.order.id}}),0);
 assert.deepEqual(await db.order.findUniqueOrThrow({where:{id:f.order.id}}),before);
 assert.equal((await db.bill.findUniqueOrThrow({where:{id:f.bill.id}})).paidAmount,0);
});
test('return on an undelivered order explains that delivery must exist',async()=>{
 const f=await offlineOrder(db);
 await assert.rejects(service.create(input(f.order.id,'RETURN'),managerId),conflict(/尚未.*交车.*还车/));
 assert.equal(await db.fieldHandoverTask.count({where:{orderId:f.order.id}}),0);
});
test('an active order rejects duplicate delivery with a return-task hint',async()=>{
 const f=await offlineOrder(db);await db.order.update({where:{id:f.order.id},data:{status:'ACTIVE'}});
 await assert.rejects(service.create(input(f.order.id),managerId),conflict(/用车中.*重复交车.*还车/));
});
test('an eligible awaiting-handover order still supports assignment without completing delivery',async()=>{
 const f=await offlineOrder(db);await db.order.update({where:{id:f.order.id},data:{status:'AWAITING_HANDOVER'}});
 await db.vehicle.update({where:{id:f.order.vehicleId},data:{status:'RESERVED',reservedOrderId:f.order.id}});
 const result=await service.create(input(f.order.id),managerId);
 assert.equal(result.status,'ASSIGNED');assert.equal(result.assignee.id,fieldId);
 assert.equal((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).status,'AWAITING_HANDOVER');
 assert.equal(await db.handover.count({where:{orderId:f.order.id}}),0);
});
