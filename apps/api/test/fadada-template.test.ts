import {ContractPdfRendererService} from '../src/contract/contract-pdf-renderer.service';
import {resolveDelayTemplate} from '../src/contract/delay-template';
import {hash} from '../src/common/data';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot } from '../src/common/config';
import { commercialTermKeys, resolveSubscriptionTemplate, resolveHandoverTemplate } from '../src/contract/contract-template';
import { ContractPdfArtifactWriterService } from '../src/contract/contract-pdf-artifact-writer.service';
import { encryptIdentity } from '../src/esign/fadada/fadada-safety';
import { finalPlanPricing } from '../src/applications/acceptance-pricing';
const source=(name:string)=>readFileSync(resolve(projectRoot,'docs/legal',name),'utf8');
const terms=Object.fromEntries(commercialTermKeys.map(key=>[key,`已确认${key}规则`]));
const snapshot={commercialTerms:terms,revision:2,commercialHash:'a'.repeat(64),monthlyFeeAmount:0,depositAmount:100,months:2,mileagePerMonthKm:1000,excessMileagePriceAmount:80,energyDescription:'充电自付',benefits:['道路救援'],conditions:'仅限约定驾驶人',startDate:'2026-01-31',firstDueDate:'2026-01-25'};
const resource={id:'contract-1',orderId:'order-1',customerId:'customer-1',order:{applicationId:'application-1',customer:{mobile:'13800000000'},finalPlanSnapshot:snapshot}};
const identity={name:'合成客户',idCardNo:'110101199001010000'};
const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;

test('one-fen acceptance contract shows twelve exact rents and the agreed deposit after scope is disabled',()=>{
 const saved=process.env.ORDER_ACCEPTANCE_SCOPE_JSON;
 try{
  const app={id:resource.order.applicationId,customerId:resource.customerId,vehicleId:'synthetic-car'};
  process.env.ORDER_ACCEPTANCE_SCOPE_JSON=JSON.stringify({applicationId:app.id,customerId:app.customerId,vehicleId:app.vehicleId,startDate:'2026-10-17',firstDueDate:'2026-10-17',reference:'local-contract-verification'});
  const input={...snapshot,pricingMode:'V1_ONE_FEN',monthlyFeeAmount:1,depositAmount:1,months:12,startDate:'2026-10-17',firstDueDate:'2026-10-17'};
  const final={...input,...finalPlanPricing(app,input,0,{id:'synthetic-admin',role:'ADMIN'})};
  delete process.env.ORDER_ACCEPTANCE_SCOPE_JSON;
  const text=resolveSubscriptionTemplate(source('subscription-contract.md')+'\n\n'+source('commercial-schedule.md'),{...resource,order:{...resource.order,finalPlanSnapshot:final}},identity,1);
  assert.equal((text.match(/第\d+期：¥0\.01/g)||[]).length,12);
  assert.ok(text.includes('2026-10-17至2027-10-16'));assert.ok(text.includes('押金¥0.01'));
  assert.match(text,/12期租金各0\.01元（合计0\.12元）/);assert.ok(text.includes('信用核验档位不变'));
  assert.ok(!text.includes('{{'));assert.ok(!text.includes('¥4899.00'));
 }finally{if(saved===undefined)delete process.env.ORDER_ACCEPTANCE_SCOPE_JSON;else process.env.ORDER_ACCEPTANCE_SCOPE_JSON=saved;}
});
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

for(const vehicleChange of [false,true])test(`${vehicleChange?'vehicle change':'delay'} amendment resolves approved slots to one immutable readable body and renders four independent signature slots`,{skip:!font},async()=>{
 const legal={id:'delay-legal',type:vehicleChange?'vehicle-change-amendment':'delivery-delay-amendment',status:'PUBLISHED',confirmedBy:'synthetic-reviewer',confirmedAt:new Date(),version:1,title:'合成延期模板',content:source(vehicleChange?'versions/vehicle-change/vehicle-change-amendment-v1.md':'drafts/delivery-delay-amendment-v1.md')};
 const change={kind:vehicleChange?'VEHICLE_CHANGE':'DELIVERY_DELAY',id:'change-1',activeQuoteId:'quote-1',originalContractId:'original-1',priorTermsHash:'e'.repeat(64),priorTerms:snapshot};
 const quote={id:'quote-1',status:'CONFIRMED',revision:1,commercialHash:'b'.repeat(64),change,snapshot:{oldVehicleIdentification:'合成旧车VIN-A',targetVehicleIdentification:'合成新车VIN-B',plannedReturnAt:'2026-02-28T09:00:00+08:00',plannedDeliveryAt:'2026-02-28T10:00:00+08:00',newMonthlyFeeAmount:100,depositAmount:0,depositNetPaidAmount:0,depositChargeAmount:0,depositRefundAmount:0,depositBasis:'明确免押',handoverFeeAmount:0,handoverFeeBasis:'明确免收',insuranceResponsibility:'逐车保险责任',downtimeArrangement:'真实无车期间一小时，协商费用已列各期',newStartDate:'2026-02-28',newEndDate:'2026-04-27',reason:'双方确认交付延期',settlementExplanation:'第一期净收款按本期沿用',handoverArrangement:'上海门店双方验车',cancellationTerms:'继续延期需另行确认',document:{id:legal.id,templateHash:hash(legal.content)},periods:[{sequence:1,startDate:'2026-02-28',endDate:'2026-03-28',dueDate:'2026-02-28',amount:100,netPaidAmount:100,carryAmount:100,chargeAmount:0,refundAmount:0,calculationBasis:'双方明确本期一元'}]}};
 const amendment:any={...resource,id:'amendment-1',kind:'AMENDMENT',status:'DRAFT',createdAt:new Date(),documentId:legal.id,documentHash:quote.commercialHash,delayQuote:quote,originalContractHash:'c'.repeat(64)};
 amendment.body=resolveDelayTemplate(legal.content,amendment,identity);(quote.snapshot.document as any).bodyHash=hash(amendment.body);
 assert.equal(amendment.body.includes('{{'),false);assert.ok(amendment.body.includes('2026-02-28（含）至2026-03-28（不含）'));assert.ok(amendment.body.includes('c'.repeat(64)));
 const encryptionKey=Buffer.alloc(32,8).toString('base64');let saved:any,bytes:Buffer|undefined;
 const db:any={eSignAccount:{findUnique:async()=>({identityCiphertext:encryptIdentity(identity,resource.customerId,encryptionKey)})},legalDocument:{findUnique:async()=>legal},contract:{findUnique:async()=>({id:'original-1',kind:'SUBSCRIPTION',status:'SIGNED',orderId:resource.orderId,signedFileId:'main-archive'})},storedFile:{findUnique:async()=>({id:'main-archive',customerId:resource.customerId,sha256:'c'.repeat(64)})},serial:async(fn:any)=>fn({contract:{findUniqueOrThrow:async()=>amendment,update:async(value:any)=>{saved=value.data;return saved;}}})};
 const renderer=new ContractPdfRendererService();const writer=new ContractPdfArtifactWriterService(db,{render:async(model:any,options:any)=>{assert.equal(model.agreementKind,vehicleChange?'VEHICLE_SWAP_SUPPLEMENT':'DELIVERY_DELAY_AMENDMENT');return renderer.render(model,options);}}as any);writer.resource=async()=>amendment;writer.readVerified=async()=>Buffer.from('%PDF-main');writer.persistPdf=async(buffer:Buffer)=>{bytes=buffer;return{id:'delay-pdf',sha256:'d'.repeat(64)}as any;};
 const result=await writer.prepare('AMENDMENT',amendment.id,{identityEncryptionKey:encryptionKey,cjkFontPath:font}as any);assert.equal(bytes?.subarray(0,5).toString(),'%PDF-');assert.equal(result.slotCoordinates.length,4);assert.equal(saved.body,amendment.body);
 amendment.delayQuote.snapshot.periods[0].amount=200;await assert.rejects(()=>writer.prepare('AMENDMENT',amendment.id,{identityEncryptionKey:encryptionKey,cjkFontPath:font}as any),code('DOCUMENT_BODY_MISMATCH'));
});
