import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {AdminController} from '../src/operations/admin';
import {addPublicationFacts} from './publish-readiness-fixture';
import {versionSnapshot} from '../src/products/snapshot';
import {canonicalHash} from '../src/customers/types';

function fixture(overrides:any={}){
 const row:any={id:'synthetic-car',vin:'LNDTEST0000000001',revision:1,status:'DRAFT',reservedOrderId:null,holdId:null,conditionDisclosure:'Synthetic inspected condition.',...overrides};
 const actor:any={id:'synthetic-operator',role:'OPERATIONS',authVersion:0,active:true},saved=new Map<string,any>(),audits:any[]=[];
 const version={id:'version',productId:'product',version:1,status:'PUBLISHED',name:'合成方案',months:12,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',conditions:'合成约定',vehicleIds:[row.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]};
 let plans:any[]=[{id:'synthetic-plan',vehicleId:row.id,productVersionId:version.id,active:false,productVersion:version}],writes=0;
 const tx:any={
  adminUser:{findUnique:async()=>({...actor})},$queryRaw:async()=>[],
  archiveCommand:{findUnique:async({where}:any)=>saved.get(where.actorId_resourceId_action_key.key),create:async({data}:any)=>{saved.set(data.key,data);return data;}},
  vehicle:{findUnique:async()=>({...row}),update:async({data}:any)=>{writes++;row.status=data.status;row.revision+=data.revision.increment;return {...row};}},
  subscriptionPlan:{findMany:async()=>plans},auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},
  vehicleListing:{findMany:async()=>plans.map(p=>({id:'goods',vehicleId:row.id,productVersionId:p.productVersion?.id,subscriptionPlanId:p.id,status:'DRAFT',revision:0,source:'EXPLICIT',productSourceHash:canonicalHash(versionSnapshot(p.productVersion)),snapshot:versionSnapshot(p.productVersion),productVersion:p.productVersion,subscriptionPlan:p})),updateMany:async()=>({count:0})},
 };
 const facts=addPublicationFacts(tx,row);
 const controller=new AdminController({serial:async(work:any)=>work(tx)} as any),request={admin:actor};
 return {row,actor,saved,audits,request,controller,...facts,setPlans:(value:any[])=>{plans=value;},writes:()=>writes,publish:(input:any={revision:row.revision,idempotencyKey:'synthetic-publish-command'})=>controller.publishVehicle(row.id,request,input)};
}
async function guarded(work:()=>Promise<void>){
 const old=process.env.MVP_V2_ENABLED;process.env.MVP_V2_ENABLED='true';
 try{await work();}finally{if(old===undefined)delete process.env.MVP_V2_ENABLED;else process.env.MVP_V2_ENABLED=old;}
}
const errorCode=(code:string)=>(error:any)=>error.getResponse?.().error?.code===code;
const requirement=(key:string)=>(error:any)=>{assert.equal(error.getStatus(),409);assert.equal(error.getResponse().error.code,'PUBLISH_REQUIREMENTS');assert.equal(error.getResponse().error.readiness.checks.find((c:any)=>c.key===key).passed,false);return true;};

test('vehicle activation does not require condition facts or a detailed narrative',()=>guarded(async()=>{
 for(const field of ['fireDamage','floodDamage','structuralDamage']){
  const f=fixture({conditionDisclosure:''});f.condition[field]=null;
  await f.publish();
  assert.equal(f.writes(),1);assert.equal(f.row.status,'PUBLISHED');assert.equal(f.row.revision,2);assert.equal(f.saved.size,1);assert.equal(f.audits.length,1);
 }
}));

test('vehicle activation can precede product scheme configuration',()=>guarded(async()=>{
 const f=fixture();f.setPlans([]);
 await f.publish();
 assert.equal(f.writes(),1);assert.equal(f.row.conditionDisclosure,'Synthetic inspected condition.');assert.equal(f.saved.size,1);
}));

test('vehicle activation rejects missing basic information while ignoring later catalog prerequisites',()=>guarded(async()=>{
 const f=fixture({conditionDisclosure:'',title:''});f.setPlans([]);f.condition.fireDamage=null;f.owner.contactPhone='';f.policies.length=0;f.row.coverFileId=null;f.row.mediaFileIds=[];f.row.title='';
 await assert.rejects(f.publish(),(error:any)=>{requirement('VEHICLE_INFO')(error);assert.deepEqual(error.getResponse().error.readiness.checks.map((c:any)=>c.key),['VEHICLE_INFO']);return true;});
 assert.equal(f.writes(),0);assert.equal(f.saved.size,0);
}));

test('complete requirements publish the physical vehicle once and replay the original response',()=>guarded(async()=>{
 const f=fixture(),input={revision:1,idempotencyKey:'synthetic-publish-once'};
 const published:any=await f.publish(input);assert.equal(published.status,'PUBLISHED');assert.equal(published.revision,2);
 assert.deepEqual(await f.publish(input),published);assert.equal(f.writes(),1);assert.equal(f.saved.size,1);assert.equal(f.audits.length,1);assert.equal(f.audits[0].action,'PUBLISH');
 await assert.rejects(f.publish({...input,revision:2}),errorCode('IDEMPOTENCY_CONFLICT'));assert.equal(f.writes(),1);
}));

test('activation retains staff, revision, reservation, VIN and basic vehicle guards',()=>guarded(async()=>{
 const stale=fixture();await assert.rejects(stale.publish({revision:0,idempotencyKey:'synthetic-stale-publish'}),errorCode('REVISION_CONFLICT'));assert.equal(stale.writes(),0);
 for(const occupied of [{reservedOrderId:'order'},{holdId:'hold'}]){const f=fixture(occupied);await assert.rejects(f.publish(),errorCode('VEHICLE_RESERVED'));assert.equal(f.writes(),0);}
 const invalid=fixture({vin:'invalid'});await assert.rejects(invalid.publish(),errorCode('VIN_INVALID'));assert.equal(invalid.writes(),0);
 const incomplete=fixture();incomplete.row.model='';await assert.rejects(incomplete.publish(),requirement('VEHICLE_INFO'));assert.equal(incomplete.writes(),0);
 const denied=fixture();denied.actor.role='FINANCE';await assert.rejects(denied.publish(),errorCode('FORBIDDEN'));assert.equal(denied.writes(),0);
 const inactive=fixture();inactive.actor.active=false;await assert.rejects(inactive.publish(),errorCode('STAFF_SESSION_CHANGED'));assert.equal(inactive.writes(),0);
}));

test('unpublication does not acquire publication requirements',()=>guarded(async()=>{
 const f=fixture({conditionDisclosure:'',status:'PUBLISHED'});f.setPlans([]);
 const result:any=await f.controller.unpublishVehicle(f.row.id,f.request,{revision:1,idempotencyKey:'synthetic-unpublish-command'});
 assert.equal(result.status,'UNPUBLISHED');assert.equal(result.revision,2);assert.equal(f.writes(),1);
}));

test('activation only admits draft or stopped vehicles and a successful original key replays after state changes',()=>guarded(async()=>{
 for(const status of ['PUBLISHED','IN_USE','RESERVED','UNKNOWN']){const f=fixture({status});await assert.rejects(f.publish(),errorCode('VEHICLE_STATE'));assert.equal(f.writes(),0);assert.equal(f.saved.size,0);}
 const f=fixture({status:'UNPUBLISHED'}),input={revision:1,idempotencyKey:'reactivate-and-recover'};const result=await f.publish(input);assert.equal(result.status,'PUBLISHED');assert.deepEqual(await f.publish(input),result);await assert.rejects(f.publish({revision:2,idempotencyKey:'new-key-repeat-activate'}),errorCode('VEHICLE_STATE'));assert.equal(f.writes(),1);
}));

test('deactivation only admits an activated parent-off unoccupied vehicle',()=>guarded(async()=>{
 for(const status of ['DRAFT','UNPUBLISHED','IN_USE','RESERVED']){const f=fixture({status,catalogPublished:false});await assert.rejects(f.controller.unpublishVehicle(f.row.id,f.request,{revision:1,idempotencyKey:'invalid-deactivate-'+status}),errorCode('VEHICLE_STATE'));assert.equal(f.writes(),0);}
}));
