import test from 'node:test';
import assert from 'node:assert/strict';
import {BaasService} from '../src/vehicle-baas/service';

const actor={id:'baas-summary-local',role:'OPERATIONS',authVersion:2};
const contract={id:'baas-local',vehicleId:'vehicle-local',revision:0,status:'ACTIVE',provider:'本地合成出租方',contractNumber:'BAAS-LOCAL',supplierContractNumber:'',batterySerialNumber:'',graceDays:0,invoiceRequired:false,currency:'CNY',notes:'',vehicle:{id:'vehicle-local',title:'本地合成车辆'}};
function fixture(plans:any[]){
 let reads=0;let active=true;
 const tx:any={adminUser:{findUnique:async()=>({...actor,active})},vehicle:{findUnique:async()=>contract.vehicle},vehicleAssetProfile:{findUnique:async()=>null},
 vehicleBaasContract:{findMany:async()=>[contract],findUnique:async()=>contract,count:async()=>1},assetPrivateFile:{findMany:async()=>[]},
 assetCostPlan:{findMany:async()=>{reads++;return plans;}}};
 return{tx,get reads(){return reads;},revoke:()=>{active=false;}};
}
const entry=(id:string,paid=false,reversed=false)=>({id,vehicleId:'vehicle-local',amount:72600,category:'BAAS_RENT',effect:'COST',reversedBy:reversed?{id:'reverse-'+id}:null,payments:paid?[{status:'RECORDED',amount:72600}]:[{status:'VOIDED',amount:72600}]});
const plan=(id:string,status:string,due:string,entries:any[]=[])=>({id,baasContractId:contract.id,vehicleId:contract.vehicleId,sourceKind:'BAAS',status,dueDate:new Date(due+'T00:00:00Z'),amount:72600,entries});
test('BaaS summary uses actual scheduled and unpaid costs, excludes paid/voided/reversed facts',async()=>{
 const f=fixture([plan('waiting','SCHEDULED','2026-12-01'),plan('unpaid','CONFIRMED','2026-10-01',[entry('unpaid')]),plan('paid','CONFIRMED','2026-09-01',[entry('paid',true)]),plan('reversed','CONFIRMED','2026-08-01',[entry('reversed',false,true)])]);
 const row=(await new BaasService().list(f.tx,actor,{})).items[0];
 assert.equal(row.nextDueDate,'2026-10-01');assert.equal(row.unpaidCostCount,1);assert.equal(row.scheduledCostCount,1);assert.equal(row.costPlanCount,4);assert.equal(f.reads,1);
});
test('no generated costs stay distinct from a paid plan and never predict a payment date',async()=>{
 const f=fixture([]),row=(await new BaasService().list(f.tx,actor,{})).items[0];
 assert.equal(row.nextDueDate,null);assert.equal(row.costPlanCount,0);assert.equal(row.unpaidCostCount,0);
 const paid=fixture([plan('paid','CONFIRMED','2026-09-01',[entry('paid',true)])]);
 assert.equal((await new BaasService().list(paid.tx,actor,{})).items[0].nextDueDate,null);
});
test('revoked personnel cannot load cost summaries',async()=>{
 const f=fixture([]);f.revoke();await assert.rejects(new BaasService().list(f.tx,actor,{}));assert.equal(f.reads,0);
});
