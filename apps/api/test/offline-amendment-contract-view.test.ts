import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OrderChangesService} from '../src/order-changes/service';
import {offlineDelayFixture} from './offline-delivery-delay-fixture';

test('amendment view returns only the real contract quote and nullable paper archive references',async()=>{
 const f=offlineDelayFixture(true),actor={id:'ops',role:'OPERATIONS',authVersion:1},service=new OrderChangesService(f.db as any,()=>new Date());
 f.contract.offlineArchiveId=f.archive.id;
 const first=await service.view(f.tx,f.change.id,actor);assert.equal(first.contract!.delayQuoteId,f.quote.id);assert.equal(first.contract!.offlineArchiveId,f.archive.id);
 f.contract.offlineArchiveId=null;const second=await service.view(f.tx,f.change.id,actor);assert.equal(second.contract!.offlineArchiveId,null);assert.equal(second.contract!.delayQuoteId,f.quote.id);
});

test('amendment view rejects a mismatched contract quote rather than exposing its archive reference',async()=>{
 const f=offlineDelayFixture(true),find=f.tx.orderChange.findFirst;
 f.tx.orderChange.findFirst=async(args:any)=>{const c=await find(args);if(c?.quotes)c.quotes=c.quotes.map((q:any)=>({...q,contract:{...q.contract,delayQuoteId:'another-quote',offlineArchiveId:'unrelated-archive'}}));return c;};
 await assert.rejects(new OrderChangesService(f.db as any,()=>new Date()).view(f.tx,f.change.id,{id:'ops',role:'OPERATIONS',authVersion:1}),(error:any)=>error.getResponse?.().error?.code==='DOCUMENT_MISMATCH');
});
