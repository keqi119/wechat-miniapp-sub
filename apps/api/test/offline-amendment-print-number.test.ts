import test from 'node:test';
import assert from 'node:assert/strict';
import {agreementFixture} from './offline-change-agreement-fixture';
import {ArchiveContextService} from '../src/offline-documents/context';
import {buildOfflinePrintModel} from '../src/offline-documents/print';

function fixture(){
 const f=agreementFixture();for(const p of f.initial.partiesSnapshot)(p as any).name='冻结'+p.role;
 f.rental.versions[0].contractNumber='ND-REAL-RENTAL-2026';const c=f.addChange();
 const archive={id:c.archive.id,kind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:c.quote.id,orderId:f.order.id,quoteId:c.quote.id,ownerId:'owner'};
 const template={id:c.quote.snapshot.document.id,version:c.quote.snapshot.document.version,title:'合成补充协议',content:'template-text'};
 const read=()=>new ArchiveContextService().resolve(f.tx,archive);
 return{f,c,archive,template,read};
}
test('real archive context prints the verified paper contract number and the same amendment number as its heading',async()=>{
 const {f,c,archive,template,read}=fixture(),body=c.contract.body,before=JSON.stringify({order:f.order,changes:f.changes,archives:f.archives}),context=await read();
 const input={archive,version:{version:2,businessSnapshotHash:c.quote.commercialHash,contractNumber:'ND-AMENDMENT-0002'},template,context};
 const model=buildOfflinePrintModel(input),rows=model.sections.flatMap(s=>s.rows);
 assert.equal(rows.find(r=>r.label==='原合同编号')?.value,'ND-REAL-RENTAL-2026');
 assert.equal(rows.find(r=>r.label==='补充协议编号')?.value,model.number);assert.equal(model.number,'ND-AMENDMENT-0002');
 assert.notEqual(rows.find(r=>r.label==='原合同编号')?.value,f.original.id);assert.notEqual(rows.find(r=>r.label==='补充协议编号')?.value,c.contract.id);
 assert.equal(model.body,body);assert.equal(model.snapshotHash,c.quote.commercialHash);assert.equal(model.signers.length,3);assert.equal(JSON.stringify({order:f.order,changes:f.changes,archives:f.archives}),before);
 const fallback=buildOfflinePrintModel({...input,version:{...input.version,contractNumber:null}});assert.equal(fallback.number,archive.id);assert.equal(fallback.sections.flatMap(s=>s.rows).find(r=>r.label==='补充协议编号')?.value,archive.id);
});
test('print model rejects missing or blank original paper number instead of falling back to an internal ID',async()=>{
 const {c,archive,template,read}=fixture(),context=await read();
 for(const originalContractNumber of [undefined,'','   ','bad\0number'])assert.throws(()=>buildOfflinePrintModel({archive,version:{version:1,businessSnapshotHash:c.quote.commercialHash},template,context:{...context,amendmentContext:{...(context as any).amendmentContext,originalContractNumber}}} as any),(e:any)=>e.getStatus?.()===409);
});
test('number lookup rechecks the verified original archive parent and exact version, without trusting another row',async()=>{
 for(const mutate of [(a:any)=>a.id='other',(a:any)=>a.orderId='other',(a:any)=>a.ownerId='other',(a:any)=>a.subjectId='other',(a:any)=>a.kind='ORDER_AMENDMENT',(a:any)=>a.versions[0].id='other',(a:any)=>a.versions[0].archiveId='other',(a:any)=>a.versions[0].contractNumber='   ']){
  const {f,read}=fixture(),find=f.tx.documentArchive.findUnique;
  f.tx.documentArchive.findUnique=async(args:any)=>{const row=await find(args);if(args.where.id===f.rental.id&&args.include?.versions?.where?.id){const copy=structuredClone(row);mutate(copy);return copy;}return row;};
  await assert.rejects(read(),(e:any)=>e.getStatus?.()===409);
 }
});
