import {test} from 'node:test';
import assert from 'node:assert/strict';
import {offlineDelayFixture} from './offline-delivery-delay-fixture';
import {publish} from '../src/order-changes/quotes';
import {hash} from '../src/common/data';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {projectRoot} from '../src/common/config';
import {offlineSwapLifecycleFixture} from './offline-swap-lifecycle-fixture';

const common='三方线下订单补充协议。客户{{customerName}}，出租方{{lessorName}}，平台{{platformName}}。\n{{changeFacts}}\n{{periodSchedule}}\n{{financialSchedule}}';
test('the common amendment template renders complete frozen delay facts without identity or signing calls',async()=>{
 const f=offlineDelayFixture();f.legal.content=common;await publish(f.tx,f.change);const body=f.contracts.at(-1)!.body;
 for(const fact of [f.change.id,f.quote.snapshot.newStartDate,f.quote.snapshot.newEndDate,f.quote.snapshot.reason,f.quote.snapshot.settlementExplanation,f.quote.snapshot.handoverArrangement,f.quote.snapshot.cancellationTerms])assert.ok(body.includes(fact),fact);
 assert.match(body,/押金/);assert.match(body,/未交付延期/);assert.match(body,/充换电.*自付/);assert.equal(body.includes('{{'),false);assert.equal(f.quote.snapshot.document.templateHash,hash(common));assert.equal(f.contracts.at(-1)!.status,'DRAFT');
});
test('new publication rejects an approved template missing commercial fact groups before any write',async()=>{
 for(const template of ['仅客户{{customerName}}','{{changeFacts}}\n{{periodSchedule}}','{{changeFacts}}\n{{financialSchedule}}','{{periodSchedule}}\n{{financialSchedule}}']){
  const f=offlineDelayFixture();f.legal.content=template;await assert.rejects(publish(f.tx,f.change),(e:any)=>e.getResponse?.().error?.code==='LEGAL_PLACEHOLDERS',template);assert.equal(f.writes.length,0);
 }
});
test('the same review-draft body renders both delay and swap from their own frozen facts',async()=>{
 const draft=readFileSync(resolve(projectRoot,'docs/legal/drafts/offline-order-amendment-v1.md'),'utf8');
 for(const kind of ['delay','swap']){const f=kind==='delay'?offlineDelayFixture():await offlineSwapLifecycleFixture();f.legal.content=draft;await publish(f.tx,f.change);const contract=f.contracts.at(-1)!;assert.equal(contract.executionMode,'OFFLINE');assert.ok(contract.body.includes(f.rental.versions[0].contractNumber));assert.equal(/\{\{|\}\}/.test(contract.body),false);assert.ok(contract.body.includes(kind==='delay'?'未交付延期':'换入车'));}
});
