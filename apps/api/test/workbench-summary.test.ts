import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildWorkbenchSummary} from '../src/operations/workbench-summary';

const now=new Date('2026-10-27T04:00:00Z');
function database(){
 const calls:{model:string;method:string;query:any}[]=[];
 const data:Record<string,any[]>={partnerVerification:[{ownerId:'owner-private',status:'SUBMITTED'},{ownerId:'already-reviewed',status:'APPROVED'}],customerQualificationVersion:[{customerId:'customer-private',status:'SUBMITTED'}],partnerRevenueRuleVersion:[{ruleId:'rule-private',status:'SUBMITTED'}],partnerAccountVersion:[{ownerId:'owner-private',status:'SUBMITTED'}],partnerVehicleBindingProposal:[{vehicleId:'vehicle-a',bindingRevision:2},{vehicleId:'vehicle-b',bindingRevision:0},{vehicleId:'vehicle-a',bindingRevision:1}],ownerVehicle:[{vehicleId:'vehicle-a',revision:2}]};
 const db=new Proxy({},{get:(_target,model:string)=>({count:async(query:any)=>{calls.push({model,method:'count',query});return model==='insuranceRenewalReminder'?query.where.thresholdDays:3;},findMany:async(query:any)=>{calls.push({model,method:'findMany',query});return data[model]||[];}})});
 return{db:db as any,calls};
}
test('workbench counts real pending records across seven modules without exposing personal facts',async()=>{
 const f=database(),summary=await buildWorkbenchSummary(f.db,'ADMIN',now);
 for(const module of ['vehicles','customers','partners','insurance','products','orders','contracts'])assert.ok(summary.queues.some(q=>q.module===module),module);
 assert.equal(summary.queues.find(q=>q.key==='partner-admission')!.count,1);
 assert.equal(summary.queues.find(q=>q.key==='vehicle-binding')!.count,2,'stale proposals are excluded while an unbound vehicle starts at revision zero');
 assert.equal(summary.queues.find(q=>q.key==='payment-exceptions')!.count,3);
 for(const q of summary.queues){assert.ok(q.href.startsWith('#'));assert.ok(q.instruction.length>10);assert.ok(['OPERATIONS','FINANCE','SUPPORT'].includes(q.ownerRole));assert.ok(!('assigneeId' in q));}
 assert.ok(!JSON.stringify(summary).includes('private'));
 assert.deepEqual(new Set(f.calls.map(c=>c.method)),new Set(['count','findMany']));
});
test('role filtering happens before querying; finance cannot read risk and support cannot read finance or admission',async()=>{
 for(const role of ['OPERATIONS','FINANCE','SUPPORT','FIELD','UNKNOWN']){
  const f=database(),summary=await buildWorkbenchSummary(f.db,role,now);
  if(role==='OPERATIONS'){assert.ok(summary.queues.some(q=>q.key==='risk-applications'));assert.ok(!summary.queues.some(q=>q.ownerRole==='FINANCE'));assert.ok(!f.calls.some(c=>c.model==='partnerSettlement'||c.model==='payment'));}
  if(role==='FINANCE'){assert.ok(summary.queues.some(q=>q.key==='settlement-review'));assert.ok(summary.queues.every(q=>q.ownerRole==='FINANCE'));assert.ok(!f.calls.some(c=>['application','customerQualificationVersion','partnerVerification','archiveVersion','insurancePolicyVersion'].includes(c.model)));}
  if(role==='SUPPORT'){assert.deepEqual(summary.queues.map(q=>q.key),['service-intake']);assert.deepEqual(f.calls.map(c=>c.model),['serviceRequest']);}
  if(role==='FIELD'||role==='UNKNOWN'){assert.deepEqual(summary.queues,[]);assert.deepEqual(f.calls,[]);}
 }
});
test('renewal counters use due OPEN tasks and separate 30, 7 and 0 day thresholds',async()=>{
 const f=database(),summary=await buildWorkbenchSummary(f.db,'OPERATIONS',now);
 const calls=f.calls.filter(c=>c.model==='insuranceRenewalReminder');assert.equal(calls.length,3);
 assert.deepEqual(calls.map(c=>c.query.where.thresholdDays).sort((a,b)=>a-b),[0,7,30]);
 for(const call of calls){assert.equal(call.query.where.status,'OPEN');assert.deepEqual(call.query.where.dueAt,{lte:now});}
 assert.equal(summary.queues.find(q=>q.key==='insurance-renewal-0')!.count,0,'real zero counts remain zero');
 assert.ok(summary.queues.find(q=>q.key==='insurance-renewal-0')!.title.includes('到期'));
 assert.equal(f.calls.some(c=>c.model==='insuranceCoverageReviewTask'),false,'retired requirements must not query historical supplement tasks');assert.equal(summary.queues.some(q=>q.key==='insurance-supplement'),false);assert.equal(summary.queues.some(q=>q.instruction.includes('保障要求')),false);
});
test('latest-review queues select current subject versions instead of counting obsolete submitted history',async()=>{
 const f=database();await buildWorkbenchSummary(f.db,'ADMIN',now);
 for(const [model,field,version]of [['partnerVerification','ownerId','revision'],['customerQualificationVersion','customerId','revision'],['partnerRevenueRuleVersion','ruleId','version'],['partnerAccountVersion','ownerId','version']]){
  const call=f.calls.find(c=>c.model===model)!;
  assert.deepEqual(call.query.distinct,[field]);assert.deepEqual(call.query.orderBy,[{[field]:'asc'},{[version]:'desc'}]);
  assert.equal(call.query.where,undefined,'filtering SUBMITTED before latest selection can resurrect old submissions');
 }
});
test('query failure is visible and does not become a fabricated zero queue',async()=>{
 const f=database();
 const db={payment:{count:async()=>{throw new Error('unavailable');}}};
 await assert.rejects(buildWorkbenchSummary(new Proxy(db,{get:(target,key:string)=>key==='payment'?target.payment:(f.db as any)[key]}) as any,'FINANCE',now),/unavailable/);
 await assert.rejects(buildWorkbenchSummary(f.db,'ADMIN',new Date('invalid')),/WORKBENCH_TIME_INVALID/);
});
