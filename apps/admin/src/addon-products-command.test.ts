import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from './core.ts';
import {AddonCommand} from './addon-products-command.ts';

test('unknown add-on create retains exact body/key/path and readback failure never repeats the committed write',async()=>{
 const command=new AddonCommand(),writes:any[]=[],reads:string[]=[];let fail=true,readFail=true;
 const request=async(path:string,options:any)=>{writes.push({path,...options});if(fail){fail=false;throw new ApiError('unknown',503);}return{id:'version',productId:'product'};};
 const read=async(id?:string)=>{reads.push(id!);if(readFail){readFail=false;throw Error('read failed');}};
 await assert.rejects(command.execute('/admin/addon-products','POST',{kind:'MILEAGE_PACK',name:'原价',revision:0},undefined,request,read));assert.equal(command.phase,'unknown');
 await assert.rejects(command.execute('/other','PATCH',{name:'不能替换'},'wrong',request,read));assert.equal(command.phase,'readback');assert.deepEqual(writes[1],writes[0]);assert.equal(writes[0].permission,'addon-products.write');
 await command.execute('/other','PATCH',undefined,undefined,request,read);assert.equal(writes.length,2);assert.deepEqual(reads,['product','product']);assert.equal(command.hasPending,false);
});
test('successful malformed create receipt reads list only and cannot be posted again or infer product id from version id',async()=>{
 for(const receipt of [{id:'version-only'},{productId:'../bad'},null]){const command=new AddonCommand();let writes=0;const reads:any[]=[];const request=async()=>{writes++;if(receipt===null)throw new ApiError('invalid JSON',200);return receipt;};
 await assert.rejects(command.execute('/admin/addon-products','POST',{revision:0},undefined,request,async id=>{reads.push(id);}));
 await assert.rejects(command.execute('/admin/addon-products','POST',undefined,undefined,request,async id=>{reads.push(id);}));assert.equal(writes,1);assert.deepEqual(reads,[undefined,undefined]);assert.equal(command.phase,'readback');}
});
test('revocation disposes late intent and known parent id cannot be substituted by another add-on response',async()=>{
 const command=new AddonCommand(),ids:any[]=[];await command.execute('/admin/addon-products/p/publish','POST',{revision:2},'p',async()=>({productId:'other'}),async id=>{ids.push(id);});assert.deepEqual(ids,['p']);
 let release!:(v:any)=>void;const pending=command.execute('/admin/addon-products','POST',{revision:0},undefined,()=>new Promise(r=>release=r),async id=>{ids.push(id||'<missing>');});command.dispose();release({productId:'late'});await assert.rejects(pending,/权限|登录/);assert.deepEqual(ids,['p']);assert.equal(command.hasPending,false);
});
test('409 blocks resubmission until a fresh command is explicitly created after a reread',async()=>{
 const command=new AddonCommand();let writes=0;const request=async()=>{writes++;throw new ApiError('conflict',409);};await assert.rejects(command.execute('/p','POST',{revision:1},'p',request,async()=>{}));assert.equal(command.phase,'conflict');await assert.rejects(command.execute('/p','POST',{revision:2},'p',request,async()=>{}));assert.equal(writes,1);
});
test('a gateway timeout keeps the original intent frozen for an identical retry',async()=>{
 const command=new AddonCommand(),writes:any[]=[];const request=async(path:string,options:any)=>{writes.push({path,...options});if(writes.length===1)throw new ApiError('timeout',408);return {productId:'p'};};
 await assert.rejects(command.execute('/create','POST',{name:'原价'},undefined,request,async()=>{}));assert.equal(command.phase,'unknown');await command.execute('/different','PATCH',{name:'新价'},'other',request,async()=>{});assert.deepEqual(writes[0],writes[1]);
});
