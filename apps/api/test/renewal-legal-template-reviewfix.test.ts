import test from 'node:test';
import assert from 'node:assert/strict';
import {activateLegalTemplate,legalContentHash} from '../src/operations/legal-template';
import {publishOfflineDelay} from '../src/order-changes/offline-publish';
import {publishOfflineSwap} from '../src/vehicle-changes/offline-publish';
import {OrderRenewalsService} from '../src/order-renewals/service';
import {offlineDelayFixture} from './offline-delivery-delay-fixture';
import {offlineSwapLifecycleFixture} from './offline-swap-lifecycle-fixture';
import {renewalFixture,renewalPreviewInput,renewalNow,renewalOps,renewalFinance} from './order-renewals-fixture';

const common=['contractNo','orderNo','applicationId','originalContractNo','originalArchiveVersionId','originalArchiveHash','priorTermsVersionId','priorTermsHash','changeId','quoteRevision','commercialHash','customerName','customerPartyId','customerMobile','customerAddress','lessorName','lessorPartyId','lessorCreditCode','lessorAddress','lessorPhone','platformName','platformPartyId','changeFacts','periodSchedule','financialSchedule'];
const required='{{changeFacts}}\n{{periodSchedule}}\n{{financialSchedule}}';
const commonBody=common.map(key=>`${key}: {{${key}}}`).join('\n');
const code=(e:any)=>e.getResponse?.().error?.code==='LEGAL_PLACEHOLDERS';

async function activate(content:string){
 const document:any={id:'common-shared-template',type:'OFFLINE_ORDER_AMENDMENT',version:2,title:'三流程合成共用模板',content,status:'DRAFT'},staff={...renewalOps,active:true},commands:any[]=[];
 const tx:any={$executeRaw:async()=>0,$queryRaw:async()=>[],adminUser:{findUnique:async()=>staff},legalDocument:{findUnique:async()=>document,updateMany:async()=>({count:0}),update:async({data}:any)=>Object.assign(document,data)},archiveCommand:{findUnique:async()=>null,create:async({data}:any)=>{commands.push(data);return data;}},auditLog:{create:async({data}:any)=>data}};
 await activateLegalTemplate(tx,document.id,{confirmed:true,expectedVersion:2,expectedContentHash:legalContentHash(document),idempotencyKey:'activate-common-template'},renewalOps);
 assert.equal(document.status,'PUBLISHED');assert.equal(commands.length,1);return document;
}
async function publishRenewalWith(legal:any){
 const f=renewalFixture();Object.assign(f.legal,legal);const service=new OrderRenewalsService(f.db as any,()=>renewalNow),raw=renewalPreviewInput(f),p=await service.preview(f.order.id,raw,renewalOps);
 const created=await service.create(f.order.id,{...raw,previewHash:p.previewHash,idempotencyKey:'template-create'},renewalOps),next=renewalPreviewInput(f),preview=await service.preview(f.order.id,next,renewalOps,created.id);
 await service.act(created.id,'quotes',{...next,previewHash:preview.previewHash,revision:created.revision,idempotencyKey:'template-quote'},renewalOps);
 const change=f.changes[0];await service.act(change.id,'review',{revision:change.revision,idempotencyKey:'template-review',decision:'APPROVED',note:'真实冻结商品及逐期金额核对'},renewalFinance);
 await service.act(change.id,'publish',{revision:change.revision,idempotencyKey:'template-publish'},renewalOps);return f.quotes[0];
}

test('new shared activation rejects every delay-only field before it can break renewal or swap publication',async()=>{
 for(const key of ['vehicleIdentification','months','originalStartDate','originalEndDate','newStartDate','newEndDate','depositText','changeReason','settlementExplanation','handoverArrangement','cancellationTerms'])await assert.rejects(activate(`${required}\n{{${key}}}`),code,key);
});
test('one real activated common template renders every accepted token through actual delay, swap and renewal publishers',async()=>{
 const legal=await activate(commonBody),delay=offlineDelayFixture();Object.assign(delay.legal,legal);await publishOfflineDelay(delay.tx,delay.order,delay.change,delay.quote);
 const swap=await offlineSwapLifecycleFixture();Object.assign(swap.legal,legal);await publishOfflineSwap(swap.tx,swap.order,swap.change,swap.q);
 const renewal=await publishRenewalWith(legal);
 for(const q of [delay.quote,swap.q,renewal]){assert.equal(q.status,'PUBLISHED');assert.equal(q.snapshot.document.id,legal.id);assert.equal(q.snapshot.document.version,legal.version);assert.doesNotMatch(q.snapshot.document.content,/\{\{|\}\}/);assert.ok(q.snapshot.document.bodyHash);}
 assert.match(delay.quote.snapshot.document.content,/未交付延期/);assert.match(swap.q.snapshot.document.content,/换入车/);assert.match(renewal.snapshot.document.content,/续期阶段赠送/);
});
test('old already published delay-specific templates keep their existing renderer compatibility',async()=>{
 const f=offlineDelayFixture();f.legal.content=`历史延期模板 ${required}\n延期后起租日{{newStartDate}}，共{{months}}个月，车辆{{vehicleIdentification}}`;
 await publishOfflineDelay(f.tx,f.order,f.change,f.quote);assert.match(f.quote.snapshot.document.content,/延期后起租日2026-11-01/);assert.match(f.quote.snapshot.document.content,/共3个月/);
});
test('common activation still requires all three factual groups and rejects foreign cancellation tokens',async()=>{
 for(const missing of ['changeFacts','periodSchedule','financialSchedule'])await assert.rejects(activate(required.replace(`{{${missing}}}`,'')),code);
 await assert.rejects(activate(required+' {{cancellationFacts}}'),code);await assert.rejects(activate(required+' {{swapFacts}}'),code);
});
