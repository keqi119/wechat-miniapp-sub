import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationFor,routeAllowed} from './modules/navigation.ts';
import {insuranceProcess} from './process-guide-model.ts';
test('coverage management is absent for every role and a wildcard grant cannot restore its retired route',()=>{
 for(const role of ['ADMIN','OPERATIONS','FINANCE','SUPPORT','FIELD']){
  assert.equal(navigationFor(role).some(m=>m.views.some(v=>v.key==='coverage-requirements')),false);
  assert.equal(routeAllowed('coverage-requirements',role,['*']),false);
 }
 assert.equal(routeAllowed('insurance','OPERATIONS',['*']),true);assert.equal(routeAllowed('insurance-renewals','OPERATIONS',['*']),true);
});
test('the insurance process describes genuine policy facts and keeps independent review and expiration guards',()=>{
 const row={id:'p',files:[],versions:[{id:'v',version:1,status:'APPROVED',fileIds:['f'],startAt:'2026-01-01',endAt:'2027-01-01',changeKind:'ORIGINAL'}]};
 const approved=insuranceProcess(row,'operator',true,new Date('2026-10-31'));
 assert.equal(/保障要求|逐项要求/.test(JSON.stringify(approved)),false);assert.equal(approved.currentStep,'result');
 const expired=insuranceProcess(row,'operator',true,new Date('2028-01-01'));assert(expired.attention.some(c=>c.code==='COVERAGE_ENDED'));
 const own=insuranceProcess({...row,versions:[{...row.versions[0],status:'SUBMITTED',createdBy:'operator'}]},'operator',true);assert.equal(own.primaryAction?.enabled,false);assert(own.blockers.some(c=>c.code==='INSURANCE_SELF_REVIEW'));
});
