import {test} from 'node:test';
import assert from 'node:assert/strict';
import {subjectInput,fenAmount,revenueRuleInput,moduleIds} from '../src/mvp-domain-types';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {projectRoot} from '../src/common/config';
test('individual and enterprise admissions have distinct required identity fields',()=>{
 assert.equal(subjectInput.safeParse({subjectType:'INDIVIDUAL',name:'合成人员',address:'上海',contactPhone:'13800000001'}).success,true);
 assert.equal(subjectInput.safeParse({subjectType:'ENTERPRISE',name:'合成企业',address:'上海',contactPhone:'13800000001'}).success,false);
 assert.equal(subjectInput.safeParse({subjectType:'INDIVIDUAL',name:'合成人员',address:'上海',contactPhone:'13800000001',creditCode:'not-a-company'}).success,false);
});
test('published synthetic role fixtures preserve privacy and honest offline/finance states',()=>{
 const fixture=(name:string)=>JSON.parse(readFileSync(resolve(projectRoot,'docs/fixtures/seven-module-mvp',name+'.json'),'utf8'));
 for(const name of ['enterprise','individual'])assert.equal(subjectInput.safeParse(fixture(name).subject).success,true);
 const customer=fixture('customer');assert.equal(customer.synthetic,true);assert.deepEqual(customer.amountExamples,[0,1,10000]);assert.equal(customer.contract.canSign,false);assert.equal(customer.coverage.ready,false);
 for(const hidden of ['rateBps','creditBand','riskSnapshot','revenueRuleSnapshot','storagePath'])assert.equal(JSON.stringify(customer).includes(hidden),false);
 assert.equal(fixture('field').globalSearch,false);assert.equal(fixture('finance').payment.reconciliationRequired,true);assert.equal(fixture('finance').automaticPayout,false);
});
test('amounts are bounded integer cents and revenue rules carry an explicit basis',()=>{
 assert.equal(fenAmount.parse(0),0);assert.equal(fenAmount.parse(1),1);
 assert.equal(fenAmount.safeParse(0.01).success,false);
 assert.equal(revenueRuleInput.safeParse({method:'RATE',rateBps:10001,basis:'实收租金',refundRule:'次期调整',settlementCycle:'MONTHLY'}).success,false);
 assert.equal(revenueRuleInput.safeParse({method:'RATE',rateBps:1000,refundRule:'次期调整',settlementCycle:'MONTHLY'}).success,false);
 assert.equal(moduleIds.length,7);
});
