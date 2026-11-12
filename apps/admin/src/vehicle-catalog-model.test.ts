import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from './core.ts';
import {catalogAccess,checkedCatalogReadiness,VehicleCatalogCommand} from './vehicle-catalog-model.ts';
const receipt=(revision=5,catalogPublished=true)=>({id:'car',vehicleId:'car',revision,status:'PUBLISHED',catalogPublished});
test('catalog commands require both current write permissions and preserve reserved blockers',()=>{
 assert.equal(catalogAccess('OPERATIONS',['vehicles.read','vehicles.write']).write,false);assert.equal(catalogAccess('OPERATIONS',['vehicles.read','goods.write']).write,false);assert.equal(catalogAccess('OPERATIONS',['vehicles.read','vehicles.write','goods.write']).write,true);assert.equal(catalogAccess('FINANCE',['*']).write,false);
 const base={vehicleId:'car',vehicleRevision:4,ready:false,catalogPublished:false,vehicleActivated:true,publishedPlanCount:1,checks:Array.from({length:6},()=>({passed:true,required:true})),blockers:[{code:'VEHICLE_RESERVED',message:'车辆已被占用'}]};assert.equal(checkedCatalogReadiness(base,'car'),base);assert.throws(()=>checkedCatalogReadiness({...base,ready:true},'car'),/不一致/);
});
test('unknown parent action retains exact operation revision key and payload then known commit only reads',async()=>{
 const command=new VehicleCatalogCommand(()=> 'stable-key'),writes:{path:string;body:Readonly<Record<string,unknown>>}[]=[];let writeFailure=true,readFailure=true,reads=0;
 const request=async(path:string,body:Readonly<Record<string,unknown>>)=>{writes.push({path,body});if(writeFailure){writeFailure=false;throw new ApiError('unknown',503);}return receipt();};
 const read=async()=>{reads++;if(readFailure){readFailure=false;throw new ApiError('read failed',503);}return receipt();};
 await assert.rejects(command.execute('car','publish',4,' 原说明 ',request,read,()=>{}));assert.equal(command.phase,'unknown');
 await assert.rejects(command.execute('other','withdraw',99,'changed',request,read,()=>{}));assert.equal(command.phase,'readback');assert.equal(writes[0].body,writes[1].body);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].body.revision,4);assert.equal(writes[0].body.reason,'原说明');assert.equal(writes[0].body.idempotencyKey,'stable-key');
 await command.execute('other','withdraw',99,'changed',request,read,()=>{});assert.equal(writes.length,2);assert.equal(reads,2);assert.equal(command.phase,'idle');assert.equal(command.hasPending,false);
});
test('a malformed 2xx receipt cannot repeat POST and a later authoritative state may reflect another operation',async()=>{
 const command=new VehicleCatalogCommand();let writes=0,reads=0;const request=async()=>{writes++;throw new ApiError('invalid json',200,'INVALID_RESPONSE');};
 await assert.rejects(command.execute('car','publish',4,'',request,async()=>{reads++;return receipt(6,false);},()=>{}));assert.equal(command.phase,'readback');let current=false;
 await command.execute('car','publish',4,'',request,async()=>{reads++;return receipt(6,false);},value=>{current=!value.catalogPublished;});assert.equal(writes,1);assert.equal(reads,1);assert.equal(current,true);
});
test('a version conflict does not retain or silently rebase the rejected parent command',async()=>{
 const command=new VehicleCatalogCommand();let writes=0;const request=async()=>{writes++;throw new ApiError('revision',409,'REVISION_CONFLICT');};
 await assert.rejects(command.execute('car','publish',4,'',request,async()=>receipt(),()=>{}));assert.equal(command.phase,'conflict');assert.equal(command.hasPending,false);await assert.rejects(command.execute('car','publish',8,'',request,async()=>receipt(),()=>{}));assert.equal(writes,1);
});
test('disposed session intent cannot repeat a pending catalog mutation',async()=>{
 const command=new VehicleCatalogCommand();let writes=0;const request=async()=>{writes++;throw new ApiError('unknown',503);};await assert.rejects(command.execute('car','publish',4,'',request,async()=>receipt(),()=>{}));command.dispose();await assert.rejects(command.execute('car','publish',4,'',request,async()=>receipt(),()=>{}),/登录/);assert.equal(writes,1);
});
