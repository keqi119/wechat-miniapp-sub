import test from 'node:test';
import assert from 'node:assert/strict';
import { handoverProposal, prefillHandoverTerms } from './handover-location.ts';
import { creditPlanInitial } from './credit.ts';
const entity = {id:'a1',profile:{handoverLocation:{name:'测试停车场',address:'测试路100号',source:'MAP'}}};
test('customer location is a proposal, not an already approved handover fact',()=>{
  assert.match(handoverProposal(entity),/建议/);assert.match(handoverProposal(entity),/测试停车场/);assert.match(handoverProposal(entity),/测试路100号/);assert.equal(handoverProposal({id:'a2'}),'');
  const initial=creditPlanInitial(entity);assert.match((initial.commercialTerms as any).handoverArrangement,/待确认/);
});
test('draft prefill preserves existing handover terms and every other commercial term',()=>{
  const terms={handoverArrangement:'双方已确认的地点和时间',customerAddress:'合成通讯地址'};
  assert.deepEqual(prefillHandoverTerms(entity,terms),terms);
  const empty={customerAddress:'合成通讯地址',handoverArrangement:'  '};const result=prefillHandoverTerms(entity,empty);assert.equal(result.customerAddress,empty.customerAddress);assert.match(String(result.handoverArrangement),/待确认/);assert.equal(empty.handoverArrangement,'  ');
  assert.equal((creditPlanInitial({...entity,finalPlan:{commercialTerms:terms}}).commercialTerms as any).handoverArrangement,terms.handoverArrangement);
});
