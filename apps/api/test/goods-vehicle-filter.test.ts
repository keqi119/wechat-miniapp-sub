import test from 'node:test';
import assert from 'node:assert/strict';
import {GoodsService} from '../src/goods/service';

const actor={id:'operator',role:'OPERATIONS',authVersion:1};
function fixture(){
 const reads:any[]=[];
 const tx:any={adminUser:{findUnique:async()=>({...actor,active:true})},vehicleListing:{findMany:async(args:any)=>{reads.push({kind:'rows',...args});return[];},count:async(args:any)=>{reads.push({kind:'count',...args});return 21;}}};
 return {tx,reads};
}
test('per-vehicle goods pages and total use the same exact vehicle scope alongside status and keyword',async()=>{
 const f=fixture(),page=await new GoodsService().list(f.tx,actor,{vehicleId:'vehicle-21',page:'2',pageSize:'20',status:'DRAFT',keyword:'城市'});
 assert.equal(page.total,21);assert.equal(f.reads.length,2);
 assert.equal(f.reads[0].where.vehicleId,'vehicle-21');assert.deepEqual(f.reads[0].where,f.reads[1].where);
 assert.equal(f.reads[0].where.status,'DRAFT');assert.ok(f.reads[0].where.OR.length>0);assert.equal(f.reads[0].skip,20);assert.equal(f.reads[0].take,20);
});
test('malformed vehicle scope never silently falls back to the global goods list',async()=>{
 for(const vehicleId of ['',[],['one','two'],'bad\u0000id']){const f=fixture();await assert.rejects(()=>new GoodsService().list(f.tx,actor,{vehicleId}));assert.equal(f.reads.length,0);}
});
test('current staff authorization precedes per-vehicle queries',async()=>{
 const f=fixture();f.tx.adminUser.findUnique=async()=>({...actor,active:false});
 await assert.rejects(()=>new GoodsService().list(f.tx,actor,{vehicleId:'vehicle-21'}));assert.equal(f.reads.length,0);
});
