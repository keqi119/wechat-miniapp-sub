import {test} from 'node:test';
import assert from 'node:assert/strict';
import {yuan,percent,inputFingerprint,referenceCurrent,PricingWriteCommand,frozenExport,defaultGroups} from './pricing-reference-model.ts';
import {ApiError} from './core.ts';

test('金额以分保存且拒绝隐性舍入；百分比输入转为比例',()=>{
 assert.equal(yuan('12.34'),1234);assert.equal(yuan('0'),0);assert.throws(()=>yuan('1.234'));assert.throws(()=>yuan(''));
 assert.equal(percent('85'),.85);assert.equal(percent('-5'),-.05);assert.throws(()=>percent('abc'));
});
test('修改任何测算输入使旧结果不可采用；历史回放仅导出冻结数据',()=>{
 const input={vehicleIds:['a','b'],prices:{base:10000},scenarioId:'s1'};const key=inputFingerprint(input);
 assert.equal(referenceCurrent(key,input),true);assert.equal(referenceCurrent(key,{...input,prices:{base:10001}}),false);
 const record={id:'r',snapshot:{v0:100}};const exported=frozenExport(record);record.snapshot.v0=200;assert.equal(JSON.parse(exported).snapshot.v0,100);
});
test('未知响应重试冻结路径、内容与幂等键，成功后保留结果',async()=>{
 const command=new PricingWriteCommand();const requests:unknown[]=[];let attempt=0;
 const request=async(path:string,options:any)=>{requests.push({path,...structuredClone(options)});if(++attempt===1)throw new ApiError('网络中断');return {productId:'p1'};};
 const body={revision:1,vehicleIds:['v1'],baseFeeAmount:100};
 await assert.rejects(command.execute('/first',body,'products.write',request));assert.equal(command.phase,'unknown');body.baseFeeAmount=999;
 const result=await command.execute('/changed',body,'products.write',request);assert.equal(result.productId,'p1');assert.deepEqual(requests[0],requests[1]);assert.equal(command.hasPending,false);
});
test('明确失败允许纠正，冲突保留可识别状态；销毁命令阻止迟到响应',async()=>{
 const c=new PricingWriteCommand();await assert.rejects(c.execute('/x',{revision:0},'p',async()=>{throw new ApiError('冲突',409);}));assert.equal(c.phase,'conflict');assert.equal(c.hasPending,false);
 let finish!:(value:any)=>void;const delayed=c.execute('/x',{revision:1},'p',()=>new Promise(resolve=>{finish=resolve;}));c.dispose();finish({id:'old'});await assert.rejects(delayed,/变化/);
});
test('默认分组保留全部明确车辆，不因同车型忽略年款和电池',()=>{
 const cars=[{id:'1',modelDefinitionId:'m',modelYear:2024,batteryOwnership:'OWNED',batteryCapacityKwh:'75'}, {id:'2',modelDefinitionId:'m',modelYear:2024,batteryOwnership:'OWNED',batteryCapacityKwh:'75.0'}, {id:'3',modelDefinitionId:'m',modelYear:2024,batteryOwnership:'BAAS',batteryCapacityKwh:'75'}];
 const groups=defaultGroups(cars);assert.equal(groups.length,2);assert.deepEqual(groups[0].vehicleIds,['1','2']);assert.deepEqual(groups[1].vehicleIds,['3']);
});
test('成功状态但响应缺少记录编号时保持未知，可按同一键恢复',async()=>{
 const c=new PricingWriteCommand();await assert.rejects(c.execute('/x',{revision:0},'p',async()=>({})),/编号/);assert.equal(c.phase,'unknown');assert.equal(c.hasPending,true);
 assert.equal((await c.execute('/x',{revision:0},'p',async()=>({id:'run1'}))).id,'run1');
});


import * as pricingModel from './pricing-reference-model.ts';
test('delayed history response cannot authorize adoption after an input edit or navigation',async()=>{
 const guard=(pricingModel as any).historyResponseCurrent;assert.equal(typeof guard,'function');
 let epoch=0,sequence=1,historical=false;const token=sequence,captured=epoch;
 let finish!:(value:any)=>void;
 const response=new Promise(resolve=>{finish=resolve;}).then(()=>{if(guard(token,captured,sequence,epoch))historical=true;});
 epoch++;finish({id:'old'});await response;assert.equal(historical,false);
 assert.equal(guard(1,1,1,1),true);assert.equal(guard(1,1,2,1),false);
});
test('pricing group builder freezes internal income basis outside clean customer draft',()=>{
 const build=(pricingModel as any).pricingGroupRequest;assert.equal(typeof build,'function');
 const group={groupKey:'g',vehicleIds:['v'],customerBaasIncomeTreatment:'BUSINESS_REVENUE',customerBaasIncomeBasisNotes:'Operator income'};
 const draft={name:'customer',customerBaas:{disposition:'SEPARATE',amount:100,period:'TERM'}};
 const result=build(group,draft);assert.equal(result.customerBaasIncomeTreatment,'BUSINESS_REVENUE');assert.equal(result.customerBaasIncomeBasisNotes,'Operator income');assert.deepEqual(result.draft,draft);assert.equal('customerBaasIncomeTreatment' in result.draft,false);
 assert.notEqual(inputFingerprint(result),inputFingerprint(build({...group,customerBaasIncomeBasisNotes:'Updated'},draft)));
 assert.equal(build({groupKey:'g',vehicleIds:['v']},{name:'included'}).customerBaasIncomeTreatment,undefined);
});
test('finance pricing fields exclude remote benefits while operations retains them',()=>{
 const filter=(pricingModel as any).pricingEditableFields;assert.equal(typeof filter,'function');
 const fields=[{key:'name'},{key:'benefitVersionIds'}];assert.deepEqual(filter(fields,'FINANCE'),[{key:'name'}]);assert.deepEqual(filter(fields,'OPERATIONS'),fields);
});
