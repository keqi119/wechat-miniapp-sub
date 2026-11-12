import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdminController} from '../src/operations/admin';
const code=(expected:string)=>(error:any)=>error.getResponse?.().error?.code===expected;
const actor={id:'staff',role:'OPERATIONS',authVersion:1},command=(revision=0,idempotencyKey='model-command-01')=>({revision,idempotencyKey});
function fixture(){
 let current:any=null,staff:any={...actor,active:true},writes=0;const audits:any[]=[],commands=new Map<string,any>();
 const tx:any={$queryRaw:async()=>[],$executeRaw:async()=>0,adminUser:{findUnique:async()=>staff},archiveCommand:{findUnique:async({where}:any)=>commands.get(JSON.stringify(where)),create:async({data}:any)=>commands.set(JSON.stringify({actorId_resourceId_action_key:{actorId:data.actorId,resourceId:data.resourceId,action:data.action,key:data.key}}),data)},modelDefinition:{create:async({data}:any)=>{writes++;return current={id:'model',revision:0,modelYear:null,...data};},findUnique:async()=>current,findMany:async()=>current?[current]:[],count:async()=>current?1:0,update:async({data}:any)=>{writes++;const {revision,...fields}=data;return current={...current,...fields,revision:current.revision+(revision?.increment||0)};}},auditLog:{create:async({data}:any)=>audits.push(data)},vehicle:new Proxy({},{get(){throw Error('Model edits must not read registration year');}}),productVersion:new Proxy({},{get(){throw Error('Model edits must not rewrite product versions');}}),subscriptionPlan:new Proxy({},{get(){throw Error('Model edits must not create goods');}})};const controller=new AdminController({serial:async(operation:any)=>operation(tx),...tx} as any);
 return{controller,tx,audits,get current(){return current;},get writes(){return writes;},revoke:()=>staff={...staff,active:false}};
}
const req={admin:actor};
test('model create stores an explicit actual model year with mandatory revision and idempotency',async()=>{
 const f=fixture(),input={brand:'合成',name:'N11',modelYear:2024,...command()},created=await f.controller.create('model-definitions',input,req);assert.equal(created.modelYear,2024);assert.equal(created.revision,0);assert.deepEqual(await f.controller.create('model-definitions',input,req),created);assert.equal(f.writes,1);assert.equal(f.audits.length,1);
 await assert.rejects(f.controller.create('model-definitions',{...input,modelYear:2025},req),code('IDEMPOTENCY_CONFLICT'));
 f.revoke();await assert.rejects(f.controller.create('model-definitions',input,req),code('STAFF_SESSION_CHANGED'));
});
test('legacy null is readable and omitted PATCH fields preserve year, body type and description',async()=>{
 const f=fixture();await f.controller.create('model-definitions',{brand:'合成',name:'未登记',bodyType:'SUV',description:'原说明',...command()},req);
 assert.equal((await f.controller.detail('model-definitions','model',req)).modelYear,null);assert.equal((await f.controller.list('model-definitions',{},req)).items[0].modelYear,null);
 const set=await f.controller.patch('model-definitions','model',{modelYear:2024,...command(0,'model-year-set')},req);assert.equal(set.revision,1);
 const renamed=await f.controller.patch('model-definitions','model',{name:'更正车型名',...command(1,'model-name-set')},req);assert.equal(renamed.modelYear,2024);assert.equal(renamed.bodyType,'SUV');assert.equal(renamed.description,'原说明');assert.equal(renamed.revision,2);
 const cleared=await f.controller.patch('model-definitions','model',{modelYear:null,...command(2,'model-year-clear')},req);assert.equal(cleared.modelYear,null);assert.equal(cleared.revision,3);assert.equal(f.audits.at(-1).data.modelYearBefore,2024);assert.equal(f.audits.at(-1).data.modelYearAfter,null);
});
test('stale model writes, invalid years and unversioned requests cannot mutate or bypass the command',async()=>{
 const f=fixture();for(const body of [{brand:'合成',name:'不带命令'}, {brand:'合成',name:'不带键',revision:0}, {brand:'合成',name:'错初版',...command(1)}])await assert.rejects(f.controller.create('model-definitions',body,req));assert.equal(f.writes,0);
 for(const modelYear of [1899,2101,2024.5,'2024'])await assert.rejects(f.controller.create('model-definitions',{brand:'合成',name:'错年款',modelYear,...command()},req));assert.equal(f.writes,0);
 await f.controller.create('model-definitions',{brand:'合成',name:'正常',modelYear:1900,...command()},req);
 await f.controller.patch('model-definitions','model',{modelYear:2100,...command(0,'model-year-max')},req);
 await assert.rejects(f.controller.patch('model-definitions','model',{name:'过期',...command(0,'model-year-stale')},req),code('REVISION_CONFLICT'));assert.equal(f.current.name,'正常');assert.equal(f.current.modelYear,2100);assert.equal(f.writes,2);
 await assert.rejects(f.controller.patch('model-definitions','model',{modelYear:2026},req));assert.equal(f.writes,2);
});
test('current unauthorized roles cannot write models even with a forged model-year command',async()=>{
 const f=fixture();f.tx.adminUser.findUnique=async()=>({id:'finance',role:'FINANCE',active:true,authVersion:1});await assert.rejects(f.controller.create('model-definitions',{brand:'合成',name:'拒绝',modelYear:2024,...command()},{admin:{id:'finance',role:'FINANCE',authVersion:1}}),code('FORBIDDEN'));assert.equal(f.writes,0);assert.equal(f.audits.length,0);
});
test('the separate product-priced swap-credit legal type can be saved as an unapproved draft',async()=>{
 const f=fixture();f.tx.legalDocument={create:async({data}:any)=>({id:'doc',status:'DRAFT',...data})};const result=await f.controller.create('legal-documents',{type:'swap-credit-v2',version:1,title:'换车次数购买说明（产品价）',content:'仅合成草稿'},req);assert.equal(result.type,'swap-credit-v2');assert.equal(result.status,'DRAFT');
});
