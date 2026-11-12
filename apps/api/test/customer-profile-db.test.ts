import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {CustomerController} from '../src/orders/customer';
import {AdminController} from '../src/operations/admin';
const enabled={skip:process.env.NODE_ENV!=='test'};
async function fixture(){
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.port==='55432'&&url.pathname==='/chundian_test');
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL}),suffix=randomUUID();
 const customer=await db.customer.create({data:{mobile:'profile-'+suffix,name:'合成客户',profile:{fileIds:[]}}});
 const files=await Promise.all(['人像面','国徽面','驾驶证'].map((name,i)=>db.storedFile.create({data:{customerId:customer.id,name:name+'.png',mimeType:'image/png',purpose:'identity',size:10,sha256:String(i+1).repeat(64),storagePath:'synthetic-never-read'}})));
 const ops=await db.adminUser.create({data:{username:'profile-ops-'+suffix,passwordHash:'fixture',name:'合成运营',role:'OPERATIONS'}});
 return{db,customer,files,actor:{id:ops.id,role:ops.role,authVersion:ops.authVersion}};
}
test('database profile commands serialize competing revisions and preserve exact idempotency',enabled,async()=>{
 const f=await fixture();try{const controller=new CustomerController(f.db),base={revision:0,name:'合成客户',drivingYears:3,identityFrontFileId:f.files[0].id},request={customer:f.customer},first={...base,idempotencyKey:randomUUID()};
 const all=await Promise.allSettled([controller.profile(first,request),controller.profile({...base,idempotencyKey:randomUUID(),name:'并发客户'},request)]);assert.equal(all.filter(r=>r.status==='fulfilled').length,1);assert.equal(all.filter(r=>r.status==='rejected').length,1);
 const current:any=await f.db.customer.findUniqueOrThrow({where:{id:f.customer.id}});assert.equal(current.profile.revision,1);
 const old=all[0];if(old.status==='fulfilled')assert.deepEqual(await controller.profile(first,request),old.value);
 const other=await f.db.customer.create({data:{mobile:randomUUID()}});await assert.rejects(controller.profile({revision:0,idempotencyKey:randomUUID(),name:'其他客户',drivingYears:0,identityFrontFileId:f.files[0].id},{customer:other}),(e:any)=>e.getResponse?.().error?.code==='PROFILE_FILE_INVALID');
 }finally{await f.db.$disconnect();}
});
test('database old application and order display only labelled current supplements without rewriting facts',enabled,async()=>{
 const f=await fixture();try{await f.db.customer.update({where:{id:f.customer.id},data:{profile:{fileIds:f.files.map(v=>v.id)}}});
 const vehicle=await f.db.vehicle.create({data:{title:'合成车辆',brand:'Synthetic',model:'Synthetic',year:2026,city:'上海',mileageKm:0}}),plan=await f.db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'合成套餐',months:12,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'合成',benefits:[],conditions:'合成'}});
 const application=await f.db.application.create({data:{customerId:f.customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{name:'旧申请',fileIds:[]},consents:[],requestHash:randomUUID(),idempotencyKey:randomUUID()}});
 const order=await f.db.order.create({data:{applicationId:application.id,customerId:f.customer.id,vehicleId:vehicle.id,confirmedMileageKm:0,finalPlanSnapshot:{legacyFact:'immutable'}}});
 const controller:any=new AdminController(f.db);assert.equal(typeof controller.customerProfile,'function');for(const [kind,id]of [['applications',application.id],['orders',order.id]]){const value=await controller.customerProfile(kind,id,{admin:f.actor});assert.equal(value.source,'CURRENT_SUPPLEMENT');assert.equal(value.snapshot,null);assert.equal(value.files.current.legacy.length,3);}
 assert.deepEqual((await f.db.application.findUniqueOrThrow({where:{id:application.id}})).profile,application.profile);assert.deepEqual((await f.db.order.findUniqueOrThrow({where:{id:order.id}})).finalPlanSnapshot,order.finalPlanSnapshot);
 const detail:any=await controller.detail('applications',application.id,{admin:f.actor});assert.equal(detail.customer.id,f.customer.id);assert.equal(detail.customer.name,'合成客户');
 }finally{await f.db.$disconnect();}
});
