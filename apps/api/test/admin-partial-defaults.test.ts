import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdminController} from '../src/operations/admin';

const request={admin:{id:'operator',role:'OPERATIONS',authVersion:0}};
const existingVehicle={
 id:'vehicle-1',revision:4,status:'DRAFT',brand:'蔚来',model:'ET5T',title:'原车辆标题',
 vin:'LNDTEST0000000001',plateNumber:'沪TEST01',year:2025,city:'待核实',mileageKm:12000,
 description:'原有完整车辆介绍',conditionDisclosure:'原有事故及保险披露',
 coverFileId:'photo-1',mediaFileIds:['photo-1','photo-2','photo-3','photo-4'],
 modelDefinitionId:null,batteryHealthPercent:null,reservedOrderId:null,holdId:null,
};

// Only persistence is replaced: schema parsing, controller mutations, staff checks,
// vehicle commands, file-purpose validation and audit payloads run unchanged.
function memoryAdmin(resource:'vehicles'|'model-definitions',initial:Record<string,any>|null){
 let row=initial?structuredClone(initial):null;
 const writes:any[]=[],audits:any[]=[],commands=new Map<string,any>();
 const model={
  findUnique:async()=>row?structuredClone(row):null,
  update:async({where,data}:any)=>{
   assert.equal(where.id,row?.id);writes.push(structuredClone(data));
   const {revision,...fields}=data;
   row={...row,...fields,...(revision?{revision:row!.revision+revision.increment}:{})};
   return structuredClone(row);
  },
  create:async({data}:any)=>{
   writes.push(structuredClone(data));row={id:'new-record',revision:0,status:'DRAFT',...data};
   return structuredClone(row);
  },
 };
 const tx:any={
  [resource==='vehicles'?'vehicle':'modelDefinition']:model,
  adminUser:{findUnique:async()=>({...request.admin,active:true})},
  $queryRaw:async()=>[],
  $executeRaw:async()=>0,
  storedFile:{count:async({where}:any)=>new Set(where.id.in.filter((id:string)=>['photo-1','photo-2','photo-3','photo-4'].includes(id))).size},
  productVersion:{findMany:async()=>[]},
  auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},
  archiveCommand:{
   findUnique:async({where}:any)=>commands.get(JSON.stringify(where.actorId_resourceId_action_key)),
   create:async({data}:any)=>{const {actorId,resourceId,action,key}=data;commands.set(JSON.stringify({actorId,resourceId,action,key}),data);return data;},
  },
 };
 return {controller:new AdminController({serial:async(operation:any)=>operation(tx)} as any),writes,audits,tx,read:()=>structuredClone(row)};
}

test('editing a vehicle never creates an implicit plan from an otherwise applicable product',async()=>{
 const db=memoryAdmin('vehicles',existingVehicle),implicitPlans:any[]=[];
 db.tx.productVersion.findMany=async()=>[{id:'version',productId:'product',version:1,name:'适配产品',months:12,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',conditions:'适用条件',vehicleIds:[existingVehicle.id],modelDefinitionIds:[],items:[]}];
 db.tx.subscriptionPlan={findFirst:async()=>null,create:async({data}:any)=>{implicitPlans.push(data);return{id:'implicit-plan',...data};}};
 await db.controller.patch('vehicles',existingVehicle.id,{title:'更新车辆说明',revision:4,idempotencyKey:'explicit-goods-only'},request);
 assert.equal(implicitPlans.length,0,'Only an explicit goods command may create a new compatibility plan');
});

test('disclosure-only vehicle PATCH preserves omitted description, cover and all media',async()=>{
 const db=memoryAdmin('vehicles',existingVehicle);
 const value=await db.controller.patch('vehicles','vehicle-1',{conditionDisclosure:'已补充历史里程披露',revision:4,idempotencyKey:'disclosure-only-1'},request);
 assert.deepEqual(value,{...existingVehicle,conditionDisclosure:'已补充历史里程披露',revision:5});
 assert.deepEqual(db.writes,[{conditionDisclosure:'已补充历史里程披露',revision:{increment:1}}]);
 assert.deepEqual(db.audits[0].data,{conditionDisclosure:'已补充历史里程披露'});
});

test('title-only vehicle PATCH preserves omitted condition disclosure and create-default fields',async()=>{
 const db=memoryAdmin('vehicles',existingVehicle);
 const value=await db.controller.patch('vehicles','vehicle-1',{title:'  新车辆标题  ',revision:4,idempotencyKey:'title-only-update'},request);
 assert.deepEqual(value,{...existingVehicle,title:'新车辆标题',revision:5});
});

test('explicit empty strings, empty media and null cover still clear the supplied vehicle fields',async()=>{
 const db=memoryAdmin('vehicles',existingVehicle);
 const cleared={description:'',conditionDisclosure:'',mediaFileIds:[],coverFileId:null};
 const value=await db.controller.patch('vehicles','vehicle-1',{...cleared,revision:4,idempotencyKey:'clear-fields-update'},request);
 assert.deepEqual(value,{...existingVehicle,...cleared,revision:5});
});

test('supplied vehicle values still receive validation and VIN normalization',async()=>{
 const db=memoryAdmin('vehicles',existingVehicle);
 const value=await db.controller.patch('vehicles','vehicle-1',{vin:' lndtest0000000001 ',mileageKm:0,revision:4,idempotencyKey:'normalized-patch-1'},request);
 assert.deepEqual(value,{...existingVehicle,vin:'LNDTEST0000000001',mileageKm:0,revision:5});
});

test('model-definition PATCH preserves omitted body type and description defaults',async()=>{
 const before={id:'model-1',revision:0,brand:'蔚来',name:'ET5T',bodyType:'旅行车',description:'已核实的车型说明'};
 const db=memoryAdmin('model-definitions',before);
 const value=await db.controller.patch('model-definitions','model-1',{name:'  ET5T 2024款  ',revision:0,idempotencyKey:'model-name-defaults'},request);
 assert.deepEqual(value,{...before,name:'ET5T 2024款',revision:1});
 assert.deepEqual(db.writes,[{name:'ET5T 2024款',revision:{increment:1}}]);
});

test('vehicle CREATE still supplies omitted description, disclosure and media defaults',async()=>{
 const db=memoryAdmin('vehicles',null);
 const input={brand:'蔚来',model:'ET5',title:'待核实车辆',vin:'LNDTEST0000000001',year:2022,city:'待核实',mileageKm:66685};
 const value=await db.controller.create('vehicles',{...input,revision:0,idempotencyKey:'new-vehicle-defaults'},request);
 assert.equal(value.description,'');assert.equal(value.conditionDisclosure,'');assert.deepEqual(value.mediaFileIds,[]);
 assert.deepEqual(db.writes,[{...input,description:'',conditionDisclosure:'',mediaFileIds:[]}]);
});

test('model-definition CREATE still supplies omitted body type and description defaults',async()=>{
 const db=memoryAdmin('model-definitions',null);
 await db.controller.create('model-definitions',{brand:'蔚来',name:'ET5',revision:0,idempotencyKey:'new-model-defaults'},request);
 assert.deepEqual(db.writes,[{brand:'蔚来',name:'ET5',bodyType:'',description:''}]);
});

test('PATCH still rejects unknown properties and invalid supplied fields before writing',async()=>{
 const db=memoryAdmin('vehicles',existingVehicle);
 for(const fields of [{unexpected:'reject'},{description:null},{mediaFileIds:'photo-1'},{title:''}]){
  await assert.rejects(db.controller.patch('vehicles','vehicle-1',{...fields,revision:4,idempotencyKey:'invalid-patch-value'},request),(error:any)=>error.name==='ZodError');
 }
 assert.equal(db.writes.length,0);assert.deepEqual(db.read(),existingVehicle);
});

test('PATCH still rejects a supplied media file without the vehicle purpose',async()=>{
 const db=memoryAdmin('vehicles',existingVehicle);
 await assert.rejects(db.controller.patch('vehicles','vehicle-1',{mediaFileIds:['private-document'],revision:4,idempotencyKey:'wrong-purpose-file'},request),(error:any)=>error.getResponse?.().error?.code==='FILE_PURPOSE');
 assert.equal(db.writes.length,0);assert.deepEqual(db.read(),existingVehicle);
});
