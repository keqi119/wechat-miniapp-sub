import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/common/data';
import {coverageAt,evaluateCoverage} from '../src/insurance/coverage';
import {InsuranceService} from '../src/insurance/service';
import {reviewInput} from '../src/insurance/types';
import {CoverageRequirementsController} from '../src/insurance/controller';

const operator={id:'operator',role:'OPERATIONS' as const,authVersion:1};
const reviewer={id:'reviewer',role:'OPERATIONS' as const,authVersion:1};
const now=new Date('2026-10-31T00:00:00+08:00');
const proof={vehicleId:'v1',fileId:'f1',confirmed:true as const,note:'已核保单原件、主体、车辆与有效期'};
function fixture(){
 const version:any={id:'pv1',policyId:'p1',version:1,revision:1,status:'DRAFT',changeKind:'ORIGINAL',createdBy:operator.id,submittedBy:null,editedByIds:[operator.id],vehicleIds:['v1'],fileIds:['f1'],requirementVersionIds:[],coverageItems:[{code:'A',label:'原件险种',amount:10000,deductible:'以原件为准',terms:'原件记载'}],startAt:new Date('2026-01-01'),endAt:new Date('2027-01-01'),effectiveAt:new Date('2026-01-01'),reviewChecks:[]};
 const file={id:'f1',purpose:'insurance',customerId:null,adminId:operator.id,mimeType:'application/pdf',size:100,sha256:'a'.repeat(64)};
 const bindings=[{fileId:'f1',policyId:'p1',vehicleIds:['v1'],uploadedBy:operator.id}];
 const commands=new Map<string,any>(), audits:any[]=[];let active=true,writes=0,commandReads=0;
 const forbidden=new Proxy({}, {get(){throw new Error('retired requirement delegate must not be touched');}});
 const tx:any={adminUser:{findUnique:async({where}:any)=>({id:where.id,role:'OPERATIONS',authVersion:1,active})},vehicle:{findMany:async()=>[{id:'v1',modelDefinitionId:null}],findUnique:async()=>({modelDefinitionId:null})},productVersion:{findUnique:async()=>({id:'prod'})},coverageRequirement:forbidden,coverageRequirementVersion:forbidden,insuranceCoverageReviewTask:forbidden,
  insuranceCommand:{findUnique:async({where}:any)=>{commandReads++;const k=where.actorId_resourceId_action_key;return commands.get([k.actorId,k.resourceId,k.action,k.key].join('/'));},create:async({data}:any)=>{commands.set([data.actorId,data.resourceId,data.action,data.key].join('/'),structuredClone(data));writes++;return data;}},
  insurancePolicyVersion:{findUnique:async()=>version,updateMany:async({where,data}:any)=>{if(where.revision!==version.revision||where.status!==version.status)return {count:0};Object.assign(version,data,{revision:version.revision+1});writes++;return {count:1};}},
  insurancePolicy:{findUnique:async()=>({id:'p1',revision:1,versions:[version],files:bindings}),findMany:async()=>[{id:'p1',versions:[version]}],update:async()=>{writes++;return {id:'p1'};}},
  storedFile:{findMany:async()=>[file]},insurancePolicyFile:{findMany:async()=>bindings},order:{findMany:async()=>[]},serviceRequest:{findMany:async()=>[]},auditLog:{create:async({data}:any)=>{audits.push(data);writes++;return data;}}};
 return {tx,version,commands,audits,service:new InsuranceService(),setActive:(value:boolean)=>{active=value;},stats:()=>({writes,commandReads})};
}
const errorCode=(code:string)=>(e:any)=>e?.response?.error?.code===code;

test('no configuration: submit and independent manual review preserve the genuine vehicle/file evidence and idempotency',async()=>{
 const f=fixture();await f.service.submit(f.tx,operator,'pv1',{revision:1,idempotencyKey:'submit-basic'});assert.equal(f.version.status,'SUBMITTED');
 const body={revision:2,idempotencyKey:'review-basic',decision:'APPROVED',checks:[proof],reason:'独立核验原件事实'};
 await assert.rejects(f.service.review(f.tx,operator,'pv1',body),errorCode('INSURANCE_SELF_REVIEW'));
 const result=await f.service.review(f.tx,reviewer,'pv1',body);assert.equal(f.version.status,'APPROVED');assert.deepEqual(f.version.reviewChecks,[proof]);
 const before=f.stats();assert.deepEqual(await f.service.review(f.tx,reviewer,'pv1',body),JSON.parse(JSON.stringify(result)));assert.equal(f.stats().writes,before.writes);
 assert.deepEqual(await coverageAt(f.tx,'v1','prod',now),{ready:true,blockers:[],policyVersionIds:['pv1'],requirementIds:[]});
 f.setActive(false);const reads=f.stats().commandReads;await assert.rejects(f.service.review(f.tx,reviewer,'pv1',body),errorCode('STAFF_SESSION_CHANGED'));assert.equal(f.stats().commandReads,reads);
});

test('missing or wrong vehicle/file proof is still rejected without a requirement configuration',async()=>{
 for(const checks of [[],[{...proof,vehicleId:'v2'}],[{...proof,fileId:'other'}],[proof,proof]]){
  const f=fixture();f.version.status='SUBMITTED';await assert.rejects(f.service.review(f.tx,reviewer,'pv1',{revision:1,idempotencyKey:'bad-proof',decision:'APPROVED',checks,reason:'核验'}));assert.equal(f.version.status,'SUBMITTED');assert.equal(f.stats().writes,0);
 }
});

test('current coverage accepts historical reviewed facts after requirement rules retire but not missing/expired/removed evidence',()=>{
 const f=fixture();f.version.status='APPROVED';f.version.reviewChecks=[{vehicleId:'v1',requirementVersionId:'old-req',itemCode:'A',fileId:'f1',confirmed:true,note:'原历史逐项核验'}];
 const facts={vehicleId:'v1',modelDefinitionId:null,productVersionId:'prod',configurationMissing:true,requirements:[],versions:[f.version]};
 const original=JSON.stringify(f.version);assert.equal(evaluateCoverage(facts,now).ready,true);assert.equal(JSON.stringify(f.version),original);
 for(const invalid of [{...f.version,status:'SUBMITTED'},{...f.version,endAt:now},{...f.version,reviewChecks:[{...proof,vehicleId:'other'}]},{...f.version,fileIds:['other']},{...f.version,fileIds:undefined},{...f.version,fileIds:[]},{...f.version,coverageItems:[]}])assert.equal(evaluateCoverage({...facts,versions:[invalid]},now).ready,false);
 for(const fileIds of [undefined,[]])assert.equal(evaluateCoverage({...facts,versions:[f.version,{...f.version,id:'later-invalid',version:2,fileIds}]},now).ready,false,'malformed latest attachment list must not fall back to older approval');
 const removed={...f.version,id:'pv2',version:2,changeKind:'ENDORSEMENT',vehicleIds:['v2']};assert.equal(evaluateCoverage({...facts,versions:[f.version,removed]},now).ready,false);
 assert.equal(evaluateCoverage({...facts,versions:[]},now).ready,false);
});

test('legacy review body retains its exact parsed command hash and replay, before any new policy lookup',async()=>{
 const f=fixture();const oldBody={revision:7,idempotencyKey:'legacy-review',decision:'APPROVED',checks:[{vehicleId:'v1',requirementVersionId:'old-req',itemCode:'A',fileId:'f1',confirmed:true,note:'历史核验'}],reason:'历史'};
 const saved={revision:7,idempotencyKey:'legacy-review',decision:'APPROVED',checks:[{vehicleId:'v1',requirementVersionId:'old-req',itemCode:'A',fileId:'f1',confirmed:true,note:'历史核验'}],reason:'历史'};
 assert.equal(hash(reviewInput.parse(oldBody)),hash(saved));f.commands.set('reviewer/pv1/REVIEW/legacy-review',{requestHash:hash(saved),resultSnapshot:{id:'p1',historical:true}});
 f.tx.insurancePolicyVersion.findUnique=async()=>{throw new Error('replay must not inspect or rewrite historical version');};
 assert.deepEqual(await f.service.review(f.tx,reviewer,'pv1',oldBody),{id:'p1',historical:true});assert.equal(f.stats().writes,0);
 await assert.rejects(f.service.review(f.tx,reviewer,'pv1',{...oldBody,reason:'changed'}),errorCode('IDEMPOTENCY_CONFLICT'));
});

test('every retired coverage management route rechecks current authorization then returns 410 without reading or writing old configurations',async()=>{
 const f=fixture(),controller=new CoverageRequirementsController({serial:async(fn:any)=>fn(f.tx)} as any,f.service),req={admin:operator};
 const actions=[()=>controller.list(req),()=>controller.reviewTasks(req,{}),()=>controller.check(req,{}),()=>controller.detail(req,'old'),()=>controller.configure(req,{}),()=>controller.version(req,'old',{})];
 for(const action of actions)await assert.rejects(action(),(e:any)=>e?.status===410&&e?.response?.error?.code==='COVERAGE_REQUIREMENTS_RETIRED');
 assert.equal(f.stats().writes,0);assert.equal(f.stats().commandReads,0);f.setActive(false);for(const action of actions)await assert.rejects(action(),errorCode('STAFF_SESSION_CHANGED'));
});
