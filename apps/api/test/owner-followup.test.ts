import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {projectRoot} from '../src/common/config';
import {resolveHandoverTemplate} from '../src/contract/contract-template';
import {followupTemplateType,verifySwapOwner} from '../src/owner-signing/followup';
test('owner followups choose owner text, and replacement vehicles cannot silently change lessor',async()=>{
 const order={finalPlanSnapshot:{lessorSnapshot:{ownerId:'owner'}}};
 assert.equal(followupTemplateType(order,'DELIVERY_DELAY'),'owner-delivery-delay');assert.equal(followupTemplateType(order,'VEHICLE_CHANGE'),'owner-vehicle-change');assert.equal(followupTemplateType({finalPlanSnapshot:{}},'DELIVERY_DELAY'),'delivery-delay-amendment');
 const tx={ownerVehicle:{findUnique:async()=>({id:'binding',ownerId:'other',status:'APPROVED',revision:0,evidenceFileId:'evidence',reviewedAt:new Date(),reviewedBy:'operator'})},storedFile:{findUnique:async()=>({sha256:'a'.repeat(64),purpose:'evidence'})}};
 await assert.rejects(verifySwapOwner(tx,order,'target'));
 tx.ownerVehicle.findUnique=async()=>({id:'binding',ownerId:'owner',status:'APPROVED',revision:0,evidenceFileId:'evidence',reviewedAt:new Date(),reviewedBy:'operator'});
 const pin=await verifySwapOwner(tx,order,'target');assert.equal(pin?.ownerId,'owner');await assert.rejects(verifySwapOwner(tx,order,'target',{...pin,revision:1}));
});
test('owner vehicle handover names the actual lessor and Xiaolang as operational signer only',()=>{
 const template=readFileSync(resolve(projectRoot,'docs/legal/versions/owner-signing/owner-handover-v1.md'),'utf8');
 const resource={id:'handover',orderId:'order',type:'SWAP_DELIVERY',customerResponse:'CONFIRM',readingKm:12000,manifestHash:'hash',actualAt:'2026-10-17T10:00:00+08:00',checklist:Object.fromEntries(['actualTimeAndPlace','batteryLevel','accessoriesChecklist','conditionChecklist','openItems','resolutionPlan','staffName'].map(k=>[k,'合成现场记录'])),order:{finalPlanSnapshot:{lessorSnapshot:{name:'合成车主有限公司',creditCode:'SYNTHETIC'},commercialTerms:{vehicleIdentification:'合成车辆'}}}};
 const text=resolveHandoverTemplate(template,resource,{name:'合成客户'},'contract',[]);assert.ok(!text.includes('{{'));assert.match(text,/出租方（企业车主）：合成车主有限公司/);assert.match(text,/交接作业方：上海晓浪网络科技有限公司/);assert.match(text,/类型：交车/);
});
