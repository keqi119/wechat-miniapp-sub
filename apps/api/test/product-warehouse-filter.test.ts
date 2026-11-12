import test from 'node:test';
import assert from 'node:assert/strict';
import {ProductService} from '../src/products/service';
const actor={id:'warehouse-local',role:'OPERATIONS',authVersion:1};
function fixture(){
 const rows=[
 {id:'new-draft',name:'新版草稿',versions:[{version:2,status:'DRAFT'},{version:1,status:'PUBLISHED'}]},
 {id:'live-a',name:'已发布甲',versions:[{version:1,status:'PUBLISHED'}]},
 {id:'live-b',name:'已发布乙',versions:[{version:1,status:'PUBLISHED'}]},
 {id:'suspended',name:'暂停产品',versions:[{version:1,status:'SUSPENDED'}]},
 ];
 const matching=(row:any,where:any)=>!where?.name||row.name.includes(where.name.contains);
 const tx:any={adminUser:{findUnique:async()=>({...actor,active:true})},product:{findMany:async({where,skip=0,take}:any)=>rows.filter(r=>matching(r,where)).slice(skip,take===undefined?undefined:skip+take),count:async({where}:any={})=>rows.filter(r=>matching(r,where)).length}};
 return{tx};
}
test('warehouse status filters latest versions before pagination and counts the entire result',async()=>{
 const {tx}=fixture(),service=new ProductService();
 const result=await service.list(tx,actor,{latestStatus:'PUBLISHED',page:'2',pageSize:'1'});
 assert.equal(result.total,2);assert.equal(result.page,2);assert.equal(result.items.length,1);assert.equal(result.items[0].id,'live-b');
 const drafts=await service.list(tx,actor,{latestStatus:'DRAFT'});assert.deepEqual(drafts.items.map((r:any)=>r.id),['new-draft']);
});
test('warehouse search applies beyond the current page and unknown statuses are rejected',async()=>{
 const {tx}=fixture(),service=new ProductService();
 const result=await service.list(tx,actor,{keyword:'暂停',page:'1',pageSize:'1'});assert.equal(result.total,1);assert.equal(result.items[0].id,'suspended');
 await assert.rejects(service.list(tx,actor,{latestStatus:'FAKE'}));
});
