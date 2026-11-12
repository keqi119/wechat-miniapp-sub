import {test} from 'node:test';
import assert from 'node:assert/strict';
import {addPublicationFacts,syntheticPublicationFile} from './publish-readiness-fixture';
import {deliveryBusinessReady,readDeliveryBusinessReady} from '../src/orders/business-gates';
import {policyDateTime} from '../src/insurance/coverage';

const at=new Date('2026-11-12T02:00:00Z');
function fixture(){
 const vehicle={id:'vehicle',vin:'LSVNV2182E2182777',plateNumber:'沪A00001',modelDefinitionId:'model'},tx:any={vehicle:{findUnique:async()=>vehicle},productVersion:{findUnique:async()=>({id:'product'})}};
 return{vehicle,tx,...addPublicationFacts(tx,vehicle)};
}
async function inspect(f:ReturnType<typeof fixture>,time=at){const m:any=await import('../src/insurance/delivery-coverage').catch(()=>({}));assert.equal(typeof m.deliveryCoverageAt,'function','delivery-specific insurance guard exists');return m.deliveryCoverageAt(f.tx,f.vehicle.id,'product',time);}
function dates(v:any,start:Date,end:Date){v.startAt=start;v.endAt=end;v.registrationSnapshot.policy.startAt=start.toISOString();v.registrationSnapshot.policy.endAt=end.toISOString();}

test('delivery needs both insurance types and returns their current evidence, with no lease-long coverage requirement',async()=>{
 const f=fixture();for(const p of f.policies)dates(p.versions[0],at,new Date(at.getTime()+1));
 const result=await inspect(f);assert.equal(result.ready,true);assert.deepEqual(result.policyVersionIds,['version-COMPULSORY_TRAFFIC','version-COMMERCIAL']);assert.deepEqual(result.requirementIds,[]);
 f.policies.pop();const missing=await inspect(f);assert.equal(missing.ready,false);assert.match(missing.blockers[0].label,/商业险/);assert.equal(missing.blockers[0].resourceType,'vehicles');assert.equal(missing.blockers[0].resourceId,f.vehicle.id);
 f.policies.length=0;assert.equal((await inspect(f)).blockers.length,2);
});

test('delivery rejects missing, future, expired, unregistered, unknown or inconsistent evidence',async()=>{
 const mutations=[
  (f:any)=>{f.policies[0].versions[0].policyType=null;},
  (f:any)=>dates(f.policies[0].versions[0],new Date(at.getTime()+1),new Date('2030-01-01')),
  (f:any)=>dates(f.policies[0].versions[0],new Date('2026-01-01'),at),
  (f:any)=>{f.policies[0].versions[0].status='DRAFT';},
  (f:any)=>{f.files.splice(f.files.findIndex((x:any)=>x.id===f.policies[0].versions[0].fileIds[0]),1);},
  (f:any)=>{f.files.find((x:any)=>x.id===f.policies[0].versions[0].fileIds[0]).storagePath+='.missing';},
  (f:any)=>{f.files.find((x:any)=>x.id===f.policies[0].versions[0].fileIds[0]).sha256='b'.repeat(64);},
  (f:any)=>{f.bindings[0].vehicleIds=['unrelated'];},
  (f:any)=>{f.bindings[0].uploadedBy='someone-else';},
  (f:any)=>{f.files.find((x:any)=>x.id===f.policies[0].versions[0].fileIds[0]).customerId='customer';},
  (f:any)=>{f.policies[0].versions[0].registrationSnapshot.files[0].sha256='b'.repeat(64);}
 ];
 for(const mutate of mutations){const f=fixture();mutate(f);const r=await inspect(f);assert.equal(r.ready,false,String(mutate));assert(r.blockers.some((b:any)=>b.label.includes('交强险')));}
});

test('Shanghai date-only inclusive last day and actual handover time determine coverage',async()=>{
 const f=fixture();for(const p of f.policies)dates(p.versions[0],policyDateTime('2026-11-12'),policyDateTime('2026-11-12',true));
 assert.equal((await inspect(f,new Date('2026-11-11T15:59:59.999Z'))).ready,false);
 assert.equal((await inspect(f,new Date('2026-11-11T16:00:00Z'))).ready,true);
 assert.equal((await inspect(f,new Date('2026-11-12T15:59:59.999Z'))).ready,true);
 assert.equal((await inspect(f,new Date('2026-11-12T16:00:00Z'))).ready,false);
 assert.equal((await inspect(f,new Date(NaN))).ready,false);
});

test('effective cancellation and vehicle removal supersede older evidence; valid replacement policy still counts',async()=>{
 for(const kind of ['CANCELLATION','ENDORSEMENT']){
  const f=fixture(),v=f.policies[0].versions[0];
  f.policies[0].versions.push({...structuredClone(v),id:'superseding',version:2,changeKind:kind,status:'APPROVED',effectiveAt:at,vehicleIds:kind==='ENDORSEMENT'?['other']:v.vehicleIds});
  assert.equal((await inspect(f)).ready,false);
  const replacement=structuredClone(f.policies[0]);replacement.id='replacement';replacement.versions=[{...structuredClone(v),id:'replacement-version',policyId:'replacement'}];f.policies.push(replacement);f.bindings.push({...f.bindings[0],policyId:'replacement'});
  assert.equal((await inspect(f)).ready,true);
 }
});

test('reviewed historical explicit insurance codes and multi-vehicle originals remain usable',async()=>{
 const f=fixture();for(const p of f.policies){const v=p.versions[0],file=syntheticPublicationFile('other-'+p.id,'insurance','application/pdf',Buffer.from('%PDF-1.4 other '+p.id));f.files.push(file);f.bindings.push({policyId:p.id,fileId:file.id,vehicleIds:['other'],uploadedBy:'operator'});v.vehicleIds.push('other');v.fileIds.push(file.id);v.status='APPROVED';v.policyType=null;v.coverageItems=[{code:p.id.slice(7),label:'明确险种',amount:null,deductible:'按原件',terms:'按原件'}];v.reviewChecks=[{vehicleId:f.vehicle.id,fileId:v.fileIds[0],confirmed:true,note:'核对原件'}];}
 assert.equal((await inspect(f)).ready,true);for(const p of f.policies)p.versions[0].coverageItems[0].code='UNKNOWN';assert.equal((await inspect(f)).ready,false);
});

test('ordinary delivery preview and final transaction both re-read coverage and retain other blockers',async()=>{
 const f=fixture(),locks:any[]=[];f.tx.$queryRaw=async(...args:any[])=>{locks.push(args);return[];};
 f.tx.order={findUnique:async()=>({id:'order',customerId:'customer',vehicleId:f.vehicle.id,contractMode:'OFFLINE',finalPlanSnapshot:{productSnapshot:{productVersionId:'product',benefits:[]}}})};
 const preview=await readDeliveryBusinessReady(f.tx,'order',at);assert(preview.blockers.some(b=>b.code==='ORDER_BUSINESS_SNAPSHOT_REQUIRED'));assert(preview.coverageEvidence);assert.equal(locks.length,0);
 f.policies.pop();const final=await deliveryBusinessReady(f.tx,'order',at);assert.equal(final.ready,false);assert.equal(final.coverageEvidence,undefined);assert(final.blockers.some(b=>b.label.includes('商业险')));assert(locks.length>=3);
});
