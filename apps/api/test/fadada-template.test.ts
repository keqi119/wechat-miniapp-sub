import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot } from '../src/common/config';
import { commercialTermKeys, resolveSubscriptionTemplate, resolveHandoverTemplate } from '../src/contract/contract-template';
import { ContractPdfArtifactWriterService } from '../src/contract/contract-pdf-artifact-writer.service';
import { encryptIdentity } from '../src/esign/fadada/fadada-safety';
const source=(name:string)=>readFileSync(resolve(projectRoot,'docs/legal',name),'utf8');
const terms=Object.fromEntries(commercialTermKeys.map(key=>[key,`已确认${key}规则`]));
const snapshot={commercialTerms:terms,revision:2,commercialHash:'a'.repeat(64),monthlyFeeAmount:0,depositAmount:100,months:2,mileagePerMonthKm:1000,excessMileagePriceAmount:80,energyDescription:'充电自付',benefits:['道路救援'],conditions:'仅限约定驾驶人',startDate:'2026-01-31',firstDueDate:'2026-01-25'};
const resource={id:'contract-1',orderId:'order-1',customerId:'customer-1',order:{applicationId:'application-1',customer:{mobile:'13800000000'},finalPlanSnapshot:snapshot}};
const identity={name:'合成客户',idCardNo:'110101199001010000'};
const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;
test('approved main contract plus commercial schedule resolves actual immutable values without losing clauses',()=>{
  const template=source('subscription-contract.md')+'\n\n'+source('commercial-schedule.md');
  const text=resolveSubscriptionTemplate(template,resource,identity,3);
  assert.equal(text.includes('{{'),false);
  assert.ok(text.includes('7 个工作日内'));assert.ok(text.includes('不自动续期'));assert.ok(text.includes('已确认insuranceDetails规则'));
  assert.ok(text.includes('¥0.00'));assert.ok(text.includes('¥1.00'));assert.ok(text.includes('¥0.80/公里'));
  assert.ok(text.includes('第2期：¥0.00，到期日2026-02-25，服务期间2026-02-28至2026-03-30'));
  assert.ok(text.includes('2026-01-31至2026-03-30'));assert.ok(text.includes('合成客户'));assert.ok(text.includes('application-1'));
});
test('missing commercial fields, unknown or nested placeholders and invalid canonical amounts fail closed',()=>{
  const template=source('commercial-schedule.md');
  for(const plan of [{...snapshot,commercialTerms:null},{...snapshot,commercialTerms:{...terms,insuranceDetails:''}},{...snapshot,commercialTerms:{...terms,otherFees:'另行通知'}},{...snapshot,depositAmount:0.5},{...snapshot,startDate:'2026-02-30'}])assert.throws(()=>resolveSubscriptionTemplate(template,{...resource,order:{...resource.order,finalPlanSnapshot:plan}},identity,1),code('COMMERCIAL_INCOMPLETE'));
  assert.throws(()=>resolveSubscriptionTemplate('{{unknown}}',resource,identity,1),code('LEGAL_PLACEHOLDERS'));
  assert.throws(()=>resolveSubscriptionTemplate('{{customerName}}',resource,{...identity,name:'{{other}}'},1),code('LEGAL_PLACEHOLDERS'));
});
test('serialized Prisma Date fields resolve the same date-only commercial text without timezone drift',()=>{
  const template=source('commercial-schedule.md');
  const serialized={...snapshot,startDate:'2026-01-31T00:00:00.000Z',firstDueDate:'2026-01-25T00:00:00.000Z'};
  assert.equal(resolveSubscriptionTemplate(template,{...resource,order:{...resource.order,finalPlanSnapshot:serialized}},identity,1),resolveSubscriptionTemplate(template,resource,identity,1));
});
test('handover fills only confirmed facts and hashes from current evidence; absent semantic checklist is rejected',()=>{
  const checklist=Object.fromEntries(['actualTimeAndPlace','batteryLevel','accessoriesChecklist','conditionChecklist','openItems','resolutionPlan','staffName'].map(key=>[key,`现场${key}`]));
  const handover={...resource,id:'handover-1',type:'DELIVERY',manifestHash:'b'.repeat(64),readingKm:0,customerResponse:'CONFIRM',checklist};
  const text=resolveHandoverTemplate(source('handover-record.md'),handover,identity,'contract-1',[{id:'file-1',name:'现场.jpg',sha256:'c'.repeat(64)}]);
  assert.equal(text.includes('{{'),false);assert.ok(text.includes('现场里程读数：0 公里'));assert.ok(text.includes('事实无异议'));assert.ok(text.includes('file-1'));assert.ok(text.includes('c'.repeat(64)));assert.ok(text.includes('不放弃对隐蔽瑕疵'));
  assert.throws(()=>resolveHandoverTemplate(source('handover-record.md'),{...handover,checklist:[]},identity,'contract-1',[]),code('HANDOVER_INCOMPLETE'));
  assert.throws(()=>resolveHandoverTemplate(source('handover-record.md'),{...handover,customerResponse:'OBJECT'},identity,'contract-1',[]),code('HANDOVER_INCOMPLETE'));
});
const font=[process.env.FADADA_CJK_FONT_PATH,'C:/Windows/Fonts/simhei.ttf','/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttf'].find(path=>path&&existsSync(path));
test('writer renders approved combined Chinese text to actual PDF and freezes resolved body and four source signing slots',{skip:!font},async()=>{
  const legal={id:'legal-approved',type:'subscription',status:'PUBLISHED',confirmedBy:'operator',confirmedAt:new Date(),version:1,title:'批准合同及费用附件',content:source('subscription-contract.md')+'\n\n'+source('commercial-schedule.md')};
  const encryptionKey=Buffer.alloc(32,7).toString('base64');
  const contract={...resource,status:'DRAFT',documentId:legal.id,documentHash:snapshot.commercialHash,createdAt:new Date(),body:legal.content};
  let saved:any,bytes:Buffer|undefined;
  const db:any={eSignAccount:{findUnique:async()=>({identityCiphertext:encryptIdentity(identity,resource.customerId,encryptionKey)})},legalDocument:{findUnique:async()=>legal},serial:async(fn:any)=>fn({contract:{findUniqueOrThrow:async()=>contract,update:async(value:any)=>{saved=value.data;return saved;}}})};
  const writer=new ContractPdfArtifactWriterService(db);
  writer.resource=async()=>contract;
  writer.persistPdf=async(buffer:Buffer)=>{bytes=buffer;return{id:'source-pdf',sha256:'f'.repeat(64)} as any;};
  const result=await writer.prepare('SUBSCRIPTION',contract.id,{identityEncryptionKey:encryptionKey,cjkFontPath:font} as any);
  assert.equal(bytes?.subarray(0,5).toString(),'%PDF-');assert.ok(bytes!.length>10000);
  assert.equal(result.slotCoordinates.length,4);assert.equal(saved.body.includes('{{'),false);assert.ok(saved.body.includes('已确认insuranceDetails规则'));assert.ok(saved.body.includes('7 个工作日内'));assert.equal(saved.sourceFileId,'source-pdf');
});
test('usage rules appendix remains exact in rendered contract and rejects changed signed policy',async()=>{
 const {fixtureUsagePolicy}=await import('./usage-fixtures');
 const current={...resource,order:{...resource.order,finalPlanSnapshot:{...snapshot,usagePolicyVersion:'USAGE_V1',usagePolicy:fixtureUsagePolicy}}};
 const text=resolveSubscriptionTemplate(source('commercial-schedule.md'),current,identity,1);assert.ok(text.includes(fixtureUsagePolicy.content));assert.ok(text.includes(fixtureUsagePolicy.hash));
 assert.throws(()=>resolveSubscriptionTemplate(source('commercial-schedule.md'),{...current,order:{...current.order,finalPlanSnapshot:{...current.order.finalPlanSnapshot,usagePolicy:{...fixtureUsagePolicy,baseAllowanceKm:999}}}},identity,1),code('USAGE_POLICY'));
});
