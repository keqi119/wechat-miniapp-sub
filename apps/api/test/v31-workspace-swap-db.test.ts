import test from 'node:test';
import assert from 'node:assert/strict';
import {runSwapCommandJourney} from './v31-swap-command-journey';
import {readAdminOrders} from '../src/orders/admin-query';
test('real swap receipt gap is searchable before paging and broken assignment cannot fallback',ctx=>runSwapCommandJourney(ctx,'gap',{configureSources:async()=>{},partial:async(_ctx,db,{f,sub,change,receipt})=>{
 const query=async(keyword:string)=>db.serial((tx:any)=>readAdminOrders(tx,f.actor,{keyword,pageSize:1}));
 const car=await db.vehicle.findUniqueOrThrow({where:{id:f.vehicle.id}});
 const result=await query(car.vin);const row=result.items.find((r:any)=>r.id===sub.order.id);assert.ok(row);assert.equal(row.vehicleContext,'SWAP_RETURNED');assert.equal(row.vehicle.id,car.id);
 const assignment=await db.vehicleAssignment.findUniqueOrThrow({where:{id:receipt.assignmentId}});await db.vehicleAssignment.update({where:{id:assignment.id},data:{returnHandoverId:null}});
 const bad=await query(sub.order.id);assert.equal(bad.items[0].vehicle,null);assert.equal((await query(car.vin)).items.some((r:any)=>r.id===sub.order.id),false);
 await db.vehicleAssignment.update({where:{id:assignment.id},data:{returnHandoverId:assignment.returnHandoverId}});
}}));
