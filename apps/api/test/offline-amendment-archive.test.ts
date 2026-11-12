import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/common/data';
import {createSchema} from '../src/offline-documents/schemas';
import {ArchiveContextService} from '../src/offline-documents/context';
import {buildOfflinePrintModel} from '../src/offline-documents/print';

test('paper amendment archive has its own immutable quote subject',()=>{
 assert.equal(createSchema.safeParse({kind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:'quote-1',templateId:'approved-template',revision:0,idempotencyKey:'create-paper-amendment'}).success,true);
});
const parties=[{role:'CUSTOMER',partyId:'customer',name:'合成客户'},{role:'OWNER',partyId:'owner',name:'合成出租方'},{role:'PLATFORM',partyId:'platform',name:'合成平台'}];
test('original rental context stays on its original commercial hash and vehicle after later terms',async()=>{
 const original={commercialHash:'a'.repeat(64),startDate:'2026-10-01',months:12,monthlyFeeAmount:10000,lessorSnapshot:{ownerId:'owner',vehicleId:'original-car'},partiesSnapshot:parties};
 const order={id:'order',customerId:'customer',vehicleId:'replacement-car',contractMode:'OFFLINE',effectiveTermsVersionId:'terms-1',finalPlanSnapshot:original};
 let termsReads=0;const tx:any={order:{findUnique:async()=>order},orderTermsVersion:{findUnique:async()=>{termsReads++;return{id:'terms-1',orderId:'order',hash:'b'.repeat(64),snapshot:{...original,monthlyFeeAmount:20000}};}}};
 const context=await new ArchiveContextService().resolve(tx,{kind:'RENTAL',subjectType:'ORDER',subjectId:'order'});
 assert.ok('businessSnapshot' in context);assert.equal(context.businessSnapshotHash,original.commercialHash);assert.deepEqual(context.businessSnapshot,original);assert.equal(context.scopeSnapshot.vehicleId,'original-car');assert.equal(termsReads,0);
});
function printFixture(){
 const body='双方确认本次交付延期及逐期费用，原合同其他条款继续有效。',template={id:'template',version:2,title:'线下补充协议',content:'已审定模板：{{customerName}}'},commercialHash='c'.repeat(64);
 return{archive:{id:'archive',kind:'ORDER_AMENDMENT'},version:{version:1,businessSnapshotHash:commercialHash,contractNumber:'AM-001'},template,context:{requiredSigners:['CUSTOMER','OWNER','PLATFORM'],partiesSnapshot:parties,scopeSnapshot:{quoteId:'quote'},businessSnapshot:{},amendmentContext:{changeId:'change',kind:'DELIVERY_DELAY',quoteId:'quote',quoteRevision:2,contractId:'amendment',originalContractId:'original-contract',originalContractNumber:'RENTAL-001',originalArchiveVersionId:'rental-version',commercialHash,body,bodyHash:hash(body),templateId:template.id,templateVersion:template.version,templateHash:hash(template.content),rows:[{label:'原起租日',value:'2026-10-01'},{label:'变更后起租日',value:'2026-11-01'}]}}};
}
test('paper amendment prints the exact confirmed body and frozen quote identifiers',()=>{
 const input=printFixture(),result=buildOfflinePrintModel(input as any);assert.equal(result.body,input.context.amendmentContext.body);assert.equal(result.snapshotHash,input.version.businessSnapshotHash);assert.ok(result.sections.some(section=>section.rows.some(row=>row.label==='变更后起租日'&&row.value==='2026-11-01')));assert.ok(result.sections.some(section=>section.rows.some(row=>row.label==='原合同编号'&&row.value==='RENTAL-001')));assert.equal(result.signers.length,3);
});
test('paper amendment rejects missing or changed template, body and business snapshot instead of generic output',()=>{
 for(const mutation of [(x:any)=>delete x.context.amendmentContext,(x:any)=>x.context.amendmentContext.body+='篡改',(x:any)=>x.template.content+='篡改',(x:any)=>x.version.businessSnapshotHash='d'.repeat(64),(x:any)=>x.context.amendmentContext.templateVersion++]){
  const input=printFixture();mutation(input);assert.throws(()=>buildOfflinePrintModel(input as any),(e:any)=>e?.getResponse?.().error.code==='AMENDMENT_DOCUMENT_MISMATCH');
 }
});
