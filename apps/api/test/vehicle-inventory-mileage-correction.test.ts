import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {VehicleAssetsService} from '../src/vehicle-assets/service';
import {VehicleAssetsController} from '../src/vehicle-assets/controller';
import * as assetTypes from '../src/vehicle-assets/types';
import {validateVehicleIdentity} from '../src/vehicles/commands';
import {assetActor,assetAdmin,assetError,assetFixture,financeActor} from './asset-ledger-fixture';

const sourceReference={fileSha256:'a'.repeat(64),sheetName:'合成车辆清单',cellReference:'AR4'};
const input=()=>({vehicleRevision:3,previousMileageKm:12000,mileageKm:33000,reason:'按合成清单核对库存初始登记误填',sourceReference:{...sourceReference},expectedReservedOrderId:null as string|null,expectedOrderStatus:null as string|null,idempotencyKey:randomUUID()});
function matches(row:any,where:any):boolean{
 return Object.entries(where||{}).every(([key,value]:any)=>{
  if(key==='OR')return value.some((part:any)=>matches(row,part));
  if(key==='AND')return(Array.isArray(value)?value:[value]).every((part:any)=>matches(row,part));
  if(value&&typeof value==='object')return Object.entries(value).every(([op,wanted]:any)=>op==='in'?wanted.includes(row[key]):op==='notIn'?!wanted.includes(row[key]):op==='not'?row[key]!==wanted:op==='equals'?row[key]===wanted:false);
  return row[key]===value;
 });
}
function setup(reserved=false){
 const f=assetFixture(),facts:Record<string,any[]>={order:[],vehicleAssignment:[],vehicleHold:[],handover:[],mileage:[]};
 Object.assign(f.rows('vehicle')[0],{status:reserved?'RESERVED':'PUBLISHED',mileageKm:12000,reservedOrderId:reserved?'reserved-order':null,holdId:null});
 if(reserved)facts.order.push({id:'reserved-order',vehicleId:'vehicle',status:'AWAITING_PAYMENT',currentAssignmentId:null,confirmedMileageKm:12000,revision:8,finalPlanSnapshot:{vehicle:{mileageKm:12000},monthlyFeeAmount:100000}});
 for(const [table,rows]of Object.entries(facts)){
  const findMany=async({where,select}:any={})=>rows.filter(row=>matches(row,where)).map(row=>select?Object.fromEntries(Object.keys(select).filter(field=>select[field]).map(field=>[field,row[field]])):structuredClone(row));
  f.tx[table]={findMany,findFirst:async(args:any)=>(await findMany(args))[0]??null,findUnique:async(args:any)=>(await findMany(args))[0]??null,count:async({where}:any={})=>rows.filter(row=>matches(row,where)).length};
 }
 const body=input();if(reserved){body.expectedReservedOrderId='reserved-order';body.expectedOrderStatus='AWAITING_PAYMENT';}
 return{...f,facts,body,service:new VehicleAssetsService()};
}
const correct=(f:ReturnType<typeof setup>,body:any=f.body,actor:any=assetAdmin)=>f.serial(tx=>f.service.correctMileage(tx,actor,'vehicle',body));

test('administrator correction changes only vehicle mileage and revision, with bound source audit and stable replay',async()=>{
 const f=setup(),before=structuredClone(f.rows('vehicle')[0]),result=await correct(f);
 assert.equal(result.vehicleId,'vehicle');assert.equal(result.vehicleRevision,4);assert.equal(result.previousMileageKm,12000);assert.equal(result.mileageKm,33000);
 assert.deepEqual(f.rows('vehicle')[0],{...before,mileageKm:33000,revision:4});
 const audits=f.rows('auditLog');assert.equal(audits.length,1);assert.equal(audits[0].action,'CORRECT_INVENTORY_MILEAGE');assert.equal(audits[0].resourceType,'vehicle-assets');assert.equal(audits[0].data.before.mileageKm,12000);assert.equal(audits[0].data.after.mileageKm,33000);assert.deepEqual(audits[0].data.sourceReference,sourceReference);assert.equal(audits[0].data.reason,f.body.reason);
 assert.deepEqual(await correct(f),result);assert.equal(f.rows('auditLog').length,1);assert.equal(f.rows('vehicle')[0].revision,4);
 assert.deepEqual([...new Set(f.writes.map(write=>write.table))].sort(),['archiveCommand','auditLog','vehicle']);
 await assert.rejects(correct(f,{...f.body,mileageKm:34000}),assetError('IDEMPOTENCY_CONFLICT'));
});

test('explicit awaiting-payment reservation is preserved with order-before-vehicle locks and no order snapshot mutation',async()=>{
 const f=setup(true),orderBefore=structuredClone(f.facts.order),vehicleBefore=structuredClone(f.rows('vehicle')[0]);
 const result=await correct(f);assert.equal(result.mileageKm,33000);assert.deepEqual(f.facts.order,orderBefore);assert.deepEqual(f.rows('vehicle')[0],{...vehicleBefore,mileageKm:33000,revision:4});
 const orderLock=f.locks.findIndex(sql=>sql.includes('"Order"')&&sql.includes('FOR UPDATE')),vehicleLock=f.locks.findIndex(sql=>sql.includes('"Vehicle"')&&sql.includes('FOR UPDATE'));assert.ok(orderLock>=0&&vehicleLock>orderLock);
 assert.deepEqual(f.rows('auditLog')[0].data.reservation,{orderId:'reserved-order',orderStatus:'AWAITING_PAYMENT'});
 assert.throws(()=>validateVehicleIdentity(vehicleBefore,{mileageKm:33000}),assetError('VEHICLE_RESERVED'));
});

test('current ADMIN is required on first apply and replay, including demotion and revoked sessions',async()=>{
 for(const actor of [assetActor,financeActor,{id:'support',role:'SUPPORT',authVersion:1},{id:'field',role:'FIELD',authVersion:1}]){
  const f=setup();await assert.rejects(correct(f,f.body,actor),assetError('FORBIDDEN'));assert.equal(f.writes.length,0);
 }
 const f=setup();await correct(f);f.rows('adminUser').find(row=>row.id===assetAdmin.id).role='OPERATIONS';await assert.rejects(correct(f,f.body,{...assetAdmin,role:'OPERATIONS'}),assetError('FORBIDDEN'));assert.equal(f.rows('auditLog').length,1);
 const revoked=setup();await correct(revoked);revoked.revoke(assetAdmin.id);await assert.rejects(correct(revoked),assetError('STAFF_SESSION_CHANGED'));assert.equal(revoked.rows('auditLog').length,1);
});

test('old revision, old odometer and changed reservation bindings cannot apply',async()=>{
 for(const change of [{vehicleRevision:2},{previousMileageKm:11000}]){const f=setup();await assert.rejects(correct(f,{...f.body,...change}),assetError('REVISION_CONFLICT'));assert.equal(f.writes.length,0);}
 const reserved=setup(true);await assert.rejects(correct(reserved,{...reserved.body,expectedReservedOrderId:'other-order'}),assetError('MILEAGE_CORRECTION_STATE'));assert.equal(reserved.writes.length,0);
 const unbound=setup(true);await assert.rejects(correct(unbound,input()),assetError('MILEAGE_CORRECTION_STATE'));assert.equal(unbound.writes.length,0);
 const unreserved=setup();await assert.rejects(correct(unreserved,{...unreserved.body,expectedReservedOrderId:'reserved-order',expectedOrderStatus:'AWAITING_PAYMENT'}),assetError('MILEAGE_CORRECTION_STATE'));
 const raced=setup();raced.tx.vehicle.updateMany=async()=>({count:0});await assert.rejects(correct(raced),assetError('REVISION_CONFLICT'));assert.equal(raced.rows('auditLog').length,0);
});

test('in-use vehicles, advanced orders, assignments and both pointer and ledger holds block inventory correction',async()=>{
 for(const status of ['IN_USE','RESERVED']){const f=setup();f.rows('vehicle')[0].status=status;await assert.rejects(correct(f),assetError('MILEAGE_CORRECTION_STATE'));}
 for(const status of ['ACTIVE','AWAITING_HANDOVER','AWAITING_SIGNATURE','CANCELLED','COMPLETED']){const f=setup(true);f.facts.order[0].status=status;await assert.rejects(correct(f),assetError('MILEAGE_CORRECTION_STATE'));}
 const assigned=setup(true);assigned.facts.order[0].currentAssignmentId='assignment';await assert.rejects(correct(assigned),assetError('MILEAGE_CORRECTION_STATE'));
 const otherOwner=setup(true);otherOwner.facts.order[0].vehicleId='other-vehicle';await assert.rejects(correct(otherOwner),assetError('MILEAGE_CORRECTION_STATE'));
 for(const status of ['ACTIVE','CLOSED']){const f=setup();f.facts.vehicleAssignment.push({id:'assignment',vehicleId:'vehicle',orderId:'old-order',status});await assert.rejects(correct(f),assetError('MILEAGE_CORRECTION_FACTS'));}
 const wrongCarAssignment=setup(true);wrongCarAssignment.facts.vehicleAssignment.push({id:'assignment',vehicleId:'other-vehicle',orderId:'reserved-order',status:'CLOSED'});await assert.rejects(correct(wrongCarAssignment),assetError('MILEAGE_CORRECTION_FACTS'));
 const pointer=setup();pointer.rows('vehicle')[0].holdId='held';await assert.rejects(correct(pointer),assetError('MILEAGE_CORRECTION_STATE'));
 const dangling=setup();dangling.facts.vehicleHold.push({id:'held',vehicleId:'vehicle',status:'HELD'});await assert.rejects(correct(dangling),assetError('MILEAGE_CORRECTION_STATE'));
 const activeOrder=setup();activeOrder.facts.order.push({id:'unlinked-active-order',vehicleId:'vehicle',status:'ACTIVE',currentAssignmentId:null});await assert.rejects(correct(activeOrder),assetError('MILEAGE_CORRECTION_STATE'));
});

test('delivery history and approved mileage are checked through vehicle and legacy order links',async()=>{
 for(const handover of [
  {vehicleId:'vehicle',orderId:'former-order',type:'DELIVERY',status:'COMPLETED',completedAt:new Date()},
  {vehicleId:null,orderId:'reserved-order',type:'DELIVERY',status:'COMPLETED',completedAt:new Date()},
  {vehicleId:'vehicle',orderId:'former-order',type:'SWAP_DELIVERY',status:'SUPERSEDED',completedAt:new Date()},
  {vehicleId:null,orderId:'reserved-order',type:'DELIVERY',status:'PUBLISHED',completedAt:null},
 ]){const f=setup(true);f.facts.handover.push(handover);await assert.rejects(correct(f),assetError('MILEAGE_CORRECTION_FACTS'));assert.equal(f.writes.length,0);}
 const approved=setup(true);approved.facts.mileage.push({orderId:'reserved-order',status:'APPROVED',readingKm:13000});await assert.rejects(correct(approved),assetError('MILEAGE_CORRECTION_FACTS'));
 const historic=setup();historic.facts.order.push({id:'old-order',vehicleId:'vehicle',status:'COMPLETED',currentAssignmentId:null});historic.facts.mileage.push({orderId:'old-order',status:'APPROVED',readingKm:13000});await assert.rejects(correct(historic),assetError('MILEAGE_CORRECTION_FACTS'));
});

test('unrelated historical facts do not block available inventory or overwrite asset initial mileage',async()=>{
 const f=setup();f.facts.order.push({id:'unrelated-order',vehicleId:'other-vehicle',status:'ACTIVE',currentAssignmentId:'other-assignment'});f.facts.vehicleAssignment.push({id:'other-assignment',vehicleId:'other-vehicle',orderId:'unrelated-order',status:'ACTIVE'});f.facts.vehicleHold.push({vehicleId:'other-vehicle',status:'HELD'});f.facts.handover.push({vehicleId:'other-vehicle',orderId:'unrelated-order',type:'DELIVERY',status:'COMPLETED'});f.facts.mileage.push({orderId:'unrelated-order',status:'APPROVED'});
 f.seed('vehicleAssetProfile',{vehicleId:'vehicle',revision:2,initialMileageKm:9000});await correct(f);assert.equal(f.rows('vehicleAssetProfile')[0].initialMileageKm,9000);assert.equal(f.rows('vehicleAssetProfile')[0].revision,2);
 for(const status of ['DRAFT','UNPUBLISHED']){const inventory=setup();inventory.rows('vehicle')[0].status=status;await correct(inventory);assert.equal(inventory.rows('vehicle')[0].status,status);}
});

test('known order odometer cannot regress and source controls cannot be hidden by trimming',async()=>{
 const f=setup(true);f.facts.order[0].confirmedMileageKm=40000;await assert.rejects(correct(f),assetError('MILEAGE_REGRESSION'));assert.equal(f.writes.length,0);
 for(const change of [{reason:'reason\n'},{reason:'\treason'},{sourceReference:{...sourceReference,sheetName:'\n合成清单'}},{sourceReference:{...sourceReference,cellReference:'AR4\n'}}])assert.equal(assetTypes.mileageCorrectionInput.safeParse({...input(),...change}).success,false);
});

test('mileage correction DTO binds both nullable reservation fields and strict source facts, rejecting arbitrary writes and regressions',()=>{
 const schema=assetTypes.mileageCorrectionInput;assert.ok(schema,'dedicated mileage correction schema is required');assert.equal(schema.safeParse(input()).success,true);
 for(const change of [{mileageKm:11999},{mileageKm:1.5},{mileageKm:2147483648},{previousMileageKm:-1},{vehicleRevision:-1},{reason:' '},{reason:'bad\u0000reason'},{expectedOrderStatus:'ACTIVE'},{expectedReservedOrderId:'order',expectedOrderStatus:null},{expectedReservedOrderId:null,expectedOrderStatus:'AWAITING_PAYMENT'},{reservedOrderId:null},{status:'PUBLISHED'},{confirmedMileageKm:33000},{revision:3}])assert.equal(schema.safeParse({...input(),...change}).success,false,JSON.stringify(change));
 for(const source of [{...sourceReference,fileSha256:'not-a-hash'},{...sourceReference,sheetName:'bad\nname'},{...sourceReference,cellReference:'bad\tcell'},{...sourceReference,cellReference:'AR0'},{...sourceReference,sheetName:'x'.repeat(201)},{...sourceReference,extra:'forged'}])assert.equal(schema.safeParse({...input(),sourceReference:source}).success,false);
 for(const field of ['vehicleRevision','previousMileageKm','mileageKm','reason','sourceReference','expectedReservedOrderId','expectedOrderStatus','idempotencyKey']){const body:any=input();delete body[field];assert.equal(schema.safeParse(body).success,false,field);}
});

test('dedicated mileage correction route is a POST under vehicle assets',()=>{
 const method=VehicleAssetsController.prototype.correctMileage;assert.equal(typeof method,'function');assert.equal(Reflect.getMetadata('path',method),':vehicleId/mileage-correction');assert.equal(Reflect.getMetadata('method',method),1);
});
