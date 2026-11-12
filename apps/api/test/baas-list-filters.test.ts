import test from 'node:test';
import assert from 'node:assert/strict';
import {BaasService} from '../src/vehicle-baas/service';
const actor={id:'operator',role:'OPERATIONS',authVersion:1};
function fixture(){const calls:any[]=[];const tx:any={adminUser:{findUnique:async()=>({...actor,active:true})},vehicleBaasContract:{findMany:async(q:any)=>{calls.push(q);return[];},count:async(q:any)=>{calls.push(q);return 0;}}};return{tx,calls};}
test('BaaS VIN/plate keyword and four true source fields compose globally with preserved vehicle scope',async()=>{
 const f=fixture();await new BaasService().list(f.tx,actor,{vehicleId:'car',keyword:'VIN77',provider:'出租',lesseeNameExact:'实际承租人',brandExact:'蔚来',model:'ET',page:'2',pageSize:'1'});
 assert.equal(f.calls[0].skip,undefined);assert.equal(f.calls[0].where.vehicleId,'car');assert.deepEqual(f.calls[0].where.provider,{contains:'出租',mode:'insensitive'});assert.deepEqual(f.calls[0].where.lesseeName,{equals:'实际承租人'});assert.deepEqual(f.calls[0].where.vehicle.is.brand,{equals:'蔚来'});assert.deepEqual(f.calls[0].where.vehicle.is.OR.map((q:any)=>Object.keys(q)[0]),['vin','plateNumber']);
});
test('BaaS strict filter validation rejects unknown keys, conflicting modes and duplicate-array inputs',async()=>{
 for(const q of [{registeredOwnerName:'不能当承租人'},{provider:'A',providerExact:'B'},{brand:'蔚',brandExact:'蔚来'},{model:['ET5','ET7']},{lesseeName:'\0'},{page:'0'}])await assert.rejects(new BaasService().list(fixture().tx,actor,q));
});
test('BaaS minimal options are read-scoped and do not query or return bank accounts',async()=>{
 const f=fixture();const out=await new BaasService().filterOptions(f.tx,actor,{vehicleId:'car',brandExact:'蔚来'});assert.deepEqual(out,{providers:[],brands:[],models:[],lessees:[]});assert(f.calls.every(q=>!JSON.stringify(q).includes('lessorCollectionAccountInfo')));
});
