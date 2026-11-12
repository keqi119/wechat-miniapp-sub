import test from 'node:test';
import assert from 'node:assert/strict';
import {ApplicationsController} from '../src/applications/applications';
import {hash} from '../src/common/data';
const code=(c:string)=>(e:any)=>e.getResponse?.().error?.code===c;
test('parent withdrawal rejects a fresh application under the same Vehicle lock but preserves the successful original customer key',async()=>{
 const body={vehicleId:'vehicle',subscriptionPlanId:'plan',profile:{name:'合成客户',fileIds:[],handoverLocation:null},consents:[{documentId:'application',version:1}],idempotencyKey:'prior-success'},existing:any={id:'application',customerId:'customer',vehicleId:'vehicle',subscriptionPlanId:'plan',profile:body.profile,consents:body.consents,status:'SUBMITTED',idempotencyKey:body.idempotencyKey,requestHash:hash(body),createdAt:new Date(),finalPlans:[]};let locks=0,reads=0,writes=0;
 const tx:any={application:{findUnique:async({where}:any)=>where.customerId_idempotencyKey.idempotencyKey===body.idempotencyKey?existing:null,create:async()=>{writes++;throw Error('must not write');}},$queryRaw:async()=>{locks++;return[];},vehicle:{findUnique:async()=>{reads++;return{id:'vehicle',status:'PUBLISHED',catalogPublished:false};}}},controller=new ApplicationsController({serial:async(fn:any)=>fn(tx)} as any),request={customer:{id:'customer'}};
 const replay=await controller.submit(body,request);assert.equal(replay.id,'application');assert.equal(locks,0);assert.equal(reads,0);assert.equal(writes,0);
 await assert.rejects(controller.submit({...body,idempotencyKey:'new-after-withdraw'},request),code('VEHICLE_UNAVAILABLE'));assert.equal(locks,1);assert.equal(reads,1);assert.equal(writes,0);
 await assert.rejects(controller.submit({...body,profile:{...body.profile,name:'不同内容'}},request),code('IDEMPOTENCY_CONFLICT'));assert.equal(writes,0);
});
