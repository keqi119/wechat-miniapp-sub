import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCoverage,policyDateTime} from '../src/insurance/coverage';
import {reminderCandidates} from '../src/insurance/reminders';
const at=new Date('2026-10-27T00:00:00+08:00');
const requirement={id:'req-v1',requirementId:'req',version:1,effectiveAt:new Date('2026-01-01'),items:[{code:'A',label:'平台约定保障A',description:'按正式业务配置核对'}]};
const version={id:'pv1',policyId:'p1',version:1,status:'APPROVED',changeKind:'ORIGINAL',effectiveAt:new Date('2026-01-01'),startAt:at,endAt:new Date('2027-10-27T00:00:00+08:00'),vehicleIds:['v1','v2'],fileIds:['f1'],coverageItems:[{code:'A',label:'约定A',amount:10000,deductible:'以原件为准',terms:'不推断赔付'}],requirementVersionIds:['req-v1'],reviewChecks:[{vehicleId:'v1',requirementVersionId:'req-v1',itemCode:'A',fileId:'f1',confirmed:true,note:'逐项人工核对'}]};
const evaluate=(versions:unknown[]= [version],requirements:unknown[]=[requirement],time=at)=>evaluateCoverage({vehicleId:'v1',modelDefinitionId:'m1',productVersionId:'prod-v1',requirements,versions},time);
test('保障按北京时间[startAt,endAt)检查，不要求年度保单覆盖整个长租租期',()=>{assert.equal(evaluate().ready,true);assert.equal(evaluate(undefined,undefined,new Date(at.getTime()-1)).ready,false);assert.equal(evaluate(undefined,undefined,version.endAt).ready,false);assert.deepEqual(evaluate().policyVersionIds,['pv1']);assert.deepEqual(evaluate().requirementIds,[]);});
test('配置退役不等于免保险：没有真实已审保单仍fail closed',()=>{assert.equal(evaluate([],[]).blockers.some(b=>b.code==='INSURANCE_POLICY_MISSING'),true);assert.equal(evaluate([version],[]).ready,true);});
test('历史车型与产品要求不再成为当前保单额外门槛',()=>{const extra={...requirement,id:'product-req',items:[{code:'B',label:'产品约定保障B',description:'正式配置'}]};const p2={...version,id:'pv2',policyId:'p2',coverageItems:[{...version.coverageItems[0],code:'B'}],requirementVersionIds:['product-req'],reviewChecks:[{...version.reviewChecks[0],requirementVersionId:'product-req',itemCode:'B'}]};assert.equal(evaluate([version],[requirement,extra]).ready,true);assert.equal(evaluate([version,p2],[requirement,extra]).ready,true);});
test('一单多车的核验不得跨车辆借用，历史要求改版不改原审核事实',()=>{assert.equal(evaluate([{...version,reviewChecks:version.reviewChecks.map(c=>({...c,vehicleId:'v2'}))}]).ready,false);assert.equal(evaluate([version],[{...requirement,id:'req-v2',version:2}]).ready,true);});
test('未审核、过期和生效退保分别返回准确blocker；未来退保不提前阻断',()=>{for(const [value,code] of [[{...version,status:'SUBMITTED'},'INSURANCE_POLICY_UNREVIEWED'],[{...version,endAt:at},'INSURANCE_POLICY_EXPIRED'],[{...version,id:'cancel',version:2,changeKind:'CANCELLATION'},'INSURANCE_POLICY_CANCELLED']] as const)assert.equal(evaluate([value]).blockers.some(b=>b.code===code),true);const cancellation={...version,id:'cancel',version:2,changeKind:'CANCELLATION',effectiveAt:new Date(at.getTime()+1000)};assert.equal(evaluate([version,cancellation]).ready,true);assert.equal(evaluate([version,cancellation],undefined,cancellation.effectiveAt).ready,false);});
test('续保一天缺口不可被另一张保单未来生效覆盖',()=>{const renewal={...version,id:'renewal',policyId:'new',startAt:new Date('2027-10-28T00:00:00+08:00'),effectiveAt:new Date('2027-10-28T00:00:00+08:00')};assert.equal(evaluate([version,renewal],undefined,version.endAt).ready,false);});
test('仅日期的截止日转次日北京时间零点，明确时刻原样保留',()=>{assert.equal(policyDateTime('2026-10-27',true).toISOString(),'2026-10-27T16:00:00.000Z');assert.equal(policyDateTime('2026-10-27',false).toISOString(),'2026-10-26T16:00:00.000Z');assert.equal(policyDateTime('2026-10-27T10:15:00+08:00',true).toISOString(),'2026-10-27T02:15:00.000Z');assert.throws(()=>policyDateTime('2026-02-30',true));});
test('30/7/0天续保待办按车辆、版本、阈值确定持久去重键',()=>{const end=new Date('2026-11-26T16:00:00Z');const row={...version,endAt:end};const candidates=reminderCandidates([row],new Date('2026-10-27T16:00:00Z'));assert.equal(candidates.length,2);assert.deepEqual(candidates.map(c=>[c.vehicleId,c.policyVersionId,c.thresholdDays]),[['v1','pv1',30],['v2','pv1',30]]);assert.equal(reminderCandidates([row],end).length,6);});

test('已退役的配置额度不再控制当前保障，原保单额度不修改',()=>{const result=evaluate([version],[{...requirement,items:[{...requirement.items[0],minAmount:20000}]}]);assert.equal(result.ready,true);assert.equal(version.coverageItems[0].amount,10000);});

test('历史要求待办候选函数保持旧事实解释（管理接口已停用，不再生成）',async()=>{
 const {coverageReviewCandidates}=await import('../src/insurance/reminders');
 const candidates=coverageReviewCandidates([{...version,requirementVersionIds:['req-v1']}],['v1'],'req-v2',at);
 assert.deepEqual(candidates.map(c=>[c.vehicleId,c.policyVersionId,c.requirementVersionId]),[['v1','pv1','req-v2']]);
 assert.equal(coverageReviewCandidates([{...version,requirementVersionIds:['req-v2']}],['v1'],'req-v2',at).length,0);
});

test('长租超过年度保单时提前生成未来续保待办，交付当日保障仍可通过',async()=>{
 const {leaseRenewalCandidates}=await import('../src/insurance/reminders');
 assert.equal(evaluate().ready,true);const candidates=leaseRenewalCandidates([version],'v1',new Date('2028-10-27T00:00:00+08:00'),at);
 assert.equal(candidates.length,1);assert.equal(candidates[0].thresholdDays,30);assert.equal(candidates[0].dueAt>at,true);
 assert.equal(leaseRenewalCandidates([version],'v1',new Date('2027-10-26T00:00:00+08:00'),at).length,0);
});
