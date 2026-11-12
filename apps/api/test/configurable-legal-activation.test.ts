import test from 'node:test';
import assert from 'node:assert/strict';
import {activateLegalTemplate,legalContentHash} from '../src/operations/legal-template';
import {snapshotUsagePolicy,usagePolicyAppendix} from '../src/usage/policy';
import {renderSwapTemplate} from '../src/swap-purchases/policy';

function fixture(type:string,content:string){
 const old:any={id:'old',type,version:1,title:'既有版本',content:'旧正文',status:'PUBLISHED'};
 const draft:any={id:'candidate',type,version:2,title:'候选版本',content,status:'DRAFT'};
 const documents=[old,draft],commands=new Map<string,any>(),events:any[]=[];
 const tx:any={$executeRaw:async()=>0,$queryRaw:async()=>[],adminUser:{findUnique:async()=>({id:'operator',role:'OPERATIONS',active:true,authVersion:1})},legalDocument:{
  findUnique:async({where}:any)=>documents.find(d=>d.id===where.id),
  findFirst:async({where}:any)=>documents.find(d=>d.type===where.type&&d.status==='PUBLISHED'),
  updateMany:async({where,data}:any)=>{for(const d of documents)if(d.type===where.type&&d.status===where.status)Object.assign(d,data);return{count:1};},
  update:async({where,data}:any)=>Object.assign(documents.find(d=>d.id===where.id)!,data)
 },archiveCommand:{findUnique:async({where}:any)=>commands.get(JSON.stringify(where.actorId_resourceId_action_key)),create:async({data}:any)=>{commands.set(JSON.stringify({actorId:data.actorId,resourceId:data.resourceId,action:data.action,key:data.key}),data);return data;}},auditLog:{create:async({data}:any)=>events.push(data)}};
 const activate=()=>activateLegalTemplate(tx,draft.id,{confirmed:true,expectedVersion:2,expectedContentHash:legalContentHash(draft),idempotencyKey:'configurable-template-enable'},{id:'operator',role:'OPERATIONS',authVersion:1} as any);
 return{tx,old,draft,events,activate};
}

test('approved configurable mileage template activates and renders frozen per-product integers',async()=>{
 const f=fixture('usage-policy-v2','每服务月 {{baseAllowanceKm}} 公里，超出每公里 {{excessPriceYuan}} 元（{{excessPriceAmount}} 分）。');
 await f.activate();assert.equal(f.old.status,'RETIRED');
 const policy=await snapshotUsagePolicy(f.tx,{configurationVersion:2,mileagePerMonthKm:2400,excessMileagePriceAmount:230});
 assert.match(usagePolicyAppendix(policy),/2400 公里，超出每公里 2\.30 元（230 分）/);
 assert.equal(policy.documentId,'candidate');assert.equal(f.events.length,1);
});

test('approved configurable swap template activates and renders exact current fee',async()=>{
 const f=fixture('swap-credit-v2','本次换车服务费 {{extraFeeYuan}} 元（{{extraFeeAmount}} 分），升级差价另计。');
 await f.activate();assert.equal(f.old.status,'RETIRED');
 assert.equal(renderSwapTemplate(f.draft.content,45678),'本次换车服务费 456.78 元（45678 分），升级差价另计。');
 assert.equal(f.events.length,1);
});

test('configurable activation refuses omitted price groups even when the body has no placeholders',async()=>{
 for(const [type,content] of [['usage-policy-v2','固定里程说明'],['usage-policy-v2','每月 {{baseAllowanceKm}} 公里'],['usage-policy-v2','每公里 {{excessPriceYuan}} 元'],['swap-credit-v2','固定费用说明'],['swap-credit-v2','{{extraFeeAmount}} 分']]){
  const f=fixture(type,content);await assert.rejects(f.activate,(error:any)=>error.getResponse?.().error?.code==='LEGAL_PLACEHOLDERS');
  assert.equal(f.draft.status,'DRAFT');assert.equal(f.old.status,'PUBLISHED');assert.equal(f.events.length,0);
 }
});

test('configurable variables stay scoped to their own type; malformed and foreign variables cannot publish',async()=>{
 for(const [type,content] of [['usage-policy-v2','{{baseAllowanceKm}} {{excessPriceYuan}} {{extraFeeYuan}}'],['swap-credit-v2','{{extraFeeYuan}} {{baseAllowanceKm}}'],['swap-credit-v2','{{extraFeeYuan}} {{broken'],['privacy','{{extraFeeYuan}}'],['OFFLINE_ORDER_AMENDMENT','{{changeFacts}} {{periodSchedule}} {{financialSchedule}} {{extraFeeYuan}}']]){
  const f=fixture(type,content);await assert.rejects(f.activate,(error:any)=>error.getResponse?.().error?.code==='LEGAL_PLACEHOLDERS');
  assert.equal(f.draft.status,'DRAFT');assert.equal(f.old.status,'PUBLISHED');assert.equal(f.events.length,0);
 }
});

test('configurable validation covers the entire raw content consumed by its renderer, including JSON-like text',async()=>{
 for(const [type,body] of [['usage-policy-v2','每期 {{baseAllowanceKm}}，每公里 {{excessPriceYuan}} 元'],['swap-credit-v2','每次 {{extraFeeYuan}} 元']]){
  const f=fixture(type,JSON.stringify({body,meta:'不受支持 {{unknown}}'}));
  await assert.rejects(f.activate,(error:any)=>error.getResponse?.().error?.code==='LEGAL_PLACEHOLDERS');
  assert.equal(f.draft.status,'DRAFT');assert.equal(f.old.status,'PUBLISHED');assert.equal(f.events.length,0);
 }
});
