import '../src/common/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {changeService} from '../src/entitlements/service-workflow';
import {offlineOrder} from './offline-fixtures';
test('service completion and count consumption are one transaction and retry once',async()=>{
 const db=new Db();try{const f=await offlineOrder(db),suffix=randomUUID();await db.order.update({where:{id:f.order.id},data:{status:'ACTIVE'}});
 const staff=await db.adminUser.create({data:{username:`workflow-${suffix}`,name:'合成运营',role:'OPERATIONS',passwordHash:'unused'}}),support=await db.adminUser.create({data:{username:`support-${suffix}`,name:'合成客服',role:'SUPPORT',passwordHash:'unused'}});
 const right=await db.entitlement.create({data:{orderId:f.order.id,customerId:f.customer.id,title:'一次服务',description:'合成',kind:'COUNT',unit:'次',totalQuantity:1,status:'ACTIVE'}});
 const service=await db.serviceRequest.create({data:{orderId:f.order.id,customerId:f.customer.id,entitlementId:right.id,type:'benefit',location:'合成',description:'合成服务',mobile:'13800000000',fileIds:[],idempotencyKey:suffix,requestHash:suffix}});
 const run=(actor:any,body:any,assign=false)=>db.serial(tx=>changeService(tx,actor,service.id,body,assign));
 await run(staff,{status:'ACCEPTED',note:'受理',revision:0,idempotencyKey:randomUUID()});
 assert.equal(await db.entitlementReservation.count({where:{serviceRequestId:service.id,status:'RESERVED'}}),1);
 await run(staff,{providerName:'合成服务商',contact:'合成联系人',note:'派单',revision:1,idempotencyKey:randomUUID()},true);
 await run(staff,{status:'IN_PROGRESS',note:'履约',revision:2,idempotencyKey:randomUUID()});
 const complete={status:'COMPLETED',note:'已核对履约事实',revision:3,idempotencyKey:randomUUID()};
 await assert.rejects(run(support,complete));assert.equal((await db.serviceRequest.findUniqueOrThrow({where:{id:service.id}})).status,'IN_PROGRESS');
 await run(staff,complete);await run(staff,complete);
 assert.equal(await db.entitlementLedger.count({where:{entitlementId:right.id,type:'CONSUME'}}),1);
 assert.equal((await db.entitlementReservation.findUniqueOrThrow({where:{serviceRequestId:service.id}})).status,'CONSUMED');
 }finally{await db.$disconnect();}
});
