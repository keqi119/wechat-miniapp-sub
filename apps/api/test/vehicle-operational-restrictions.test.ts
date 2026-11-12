import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hasVehicleRestriction,requireVehicleUnrestricted} from '../src/vehicles/operational-restrictions';
import {applicationCooperationEligible} from '../src/vehicles/application-eligibility';
import {availableVehicle} from '../src/vehicle-changes/assignments';
import {guardHandoverOrder} from '../src/operations/handover-records';
import {readDeliveryBusinessReady,deliveryBusinessReady} from '../src/orders/business-gates';
import {swapQuote} from '../src/vehicle-changes/quotes';

const denied=(code:string)=>(e:any)=>e.getStatus?.()===409&&e.getResponse?.().error?.code===code;
function fixture(){
 const rows:any[]=[],events:string[]=[];
 const vehicle:any={id:'vehicle',status:'PUBLISHED',reservedOrderId:null,holdId:null,mileageKm:100};
 const order:any={id:'order',vehicleId:vehicle.id,status:'AWAITING_HANDOVER',confirmedMileageKm:100,contractMode:'ESIGN'};
 const tx:any={
  vehicleOperationalRestriction:{count:async({where}:any)=>{events.push('read:'+where.scopes.has);return rows.filter(r=>r.vehicleId===where.vehicleId&&r.status===where.status&&r.scopes.includes(where.scopes.has)).length;}},
  $queryRaw:async(strings:TemplateStringsArray,...values:any[])=>{events.push('lock:'+strings.join('?')+':'+values.join(','));return[];},
  vehicle:{findUnique:async()=>vehicle},order:{findUnique:async()=>order,update:async()=>order},
  orderChange:{count:async()=>0},vehicleAssignment:{count:async()=>0},usagePeriod:{aggregate:async()=>({_max:{endReadingKm:null}})},
 };
 return{tx,rows,events,vehicle,order};
}
test('restriction reads match actual vehicle, ACTIVE and requested scope; no data failures become permission',async()=>{
 const f=fixture();f.rows.push({vehicleId:'other',status:'ACTIVE',scopes:['ALLOCATION']},{vehicleId:'vehicle',status:'RELEASED',scopes:['ALLOCATION']},{vehicleId:'vehicle',status:'ACTIVE',scopes:['DELIVERY'],reason:'内部事故及财务资料'});
 assert.equal(await hasVehicleRestriction(f.tx,'vehicle','ALLOCATION'),false);
 assert.equal(await hasVehicleRestriction(f.tx,'vehicle','DELIVERY'),true);
 await assert.rejects(requireVehicleUnrestricted(f.tx,'vehicle','DELIVERY'),e=>denied('VEHICLE_DELIVERY_RESTRICTED')(e)&&!JSON.stringify((e as any).getResponse()).includes('事故'));
 f.tx.vehicleOperationalRestriction.count=async()=>{throw new Error('database unavailable');};
 await assert.rejects(hasVehicleRestriction(f.tx,'vehicle','ALLOCATION'),/database unavailable/);
});
test('catalog eligibility and actual target availability reject allocation restrictions even in legacy contract mode',async()=>{
 const previous=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='ESIGN';
 try{const f=fixture();f.rows.push({vehicleId:'vehicle',status:'ACTIVE',scopes:['ALLOCATION']});assert.equal(await applicationCooperationEligible(f.tx,'vehicle',12),false);await assert.rejects(availableVehicle(f.tx,'vehicle'),denied('VEHICLE_ALLOCATION_RESTRICTED'));}
 finally{if(previous===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=previous;}
});
test('physical delivery uses the vehicle lock and refuses a restriction while safe return still passes',async()=>{
 const f=fixture();f.rows.push({vehicleId:'vehicle',status:'ACTIVE',scopes:['DELIVERY','ALLOCATION']});Object.assign(f.vehicle,{status:'RESERVED',reservedOrderId:f.order.id});
 await assert.rejects(guardHandoverOrder(f.tx,f.order,'DELIVERY',100),denied('VEHICLE_DELIVERY_RESTRICTED'));
 assert.ok(f.events.findIndex(x=>x.startsWith('lock:')&&x.includes('Vehicle'))<f.events.indexOf('read:DELIVERY'));
 f.events.length=0;f.order.status='ACTIVE';f.vehicle.status='IN_USE';await guardHandoverOrder(f.tx,f.order,'RETURN',100);assert.equal(f.events.some(x=>x.startsWith('read:')),false);
});
test('read-only readiness shows restriction without locks; command readiness locks before checking it',async()=>{
 const f=fixture();f.rows.push({vehicleId:'vehicle',status:'ACTIVE',scopes:['DELIVERY']});
 const read=await readDeliveryBusinessReady(f.tx,'order');assert.equal(read.ready,false);assert.equal(read.blockers[0].code,'VEHICLE_DELIVERY_RESTRICTED');assert.equal(f.events.some(x=>x.startsWith('lock:')),false);
 f.events.length=0;assert.equal((await deliveryBusinessReady(f.tx,'order')).ready,false);assert.ok(f.events.findIndex(x=>x.startsWith('lock:')&&x.includes('Vehicle'))<f.events.indexOf('read:DELIVERY'));
 f.rows.length=0;assert.equal((await readDeliveryBusinessReady(f.tx,'order')).ready,true);
});
test('a fresh swap quote and its recovery cannot begin for an allocation-restricted target',async()=>{
 const f=fixture();f.rows.push({vehicleId:'vehicle',status:'ACTIVE',scopes:['ALLOCATION']});
 for(const status of ['DRAFT','AWAITING_FINANCE','SWAP_RETURNED'])await assert.rejects(swapQuote(f.tx,{id:'change',status,activeQuoteId:'quote'},{targetVehicleId:'vehicle',externalCompensationRequired:false},{id:'operator'}),denied('VEHICLE_ALLOCATION_RESTRICTED'));
});
