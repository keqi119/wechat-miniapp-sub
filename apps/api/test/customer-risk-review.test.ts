import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/common/data';
import {QualificationService,customerProfileHash,requireCurrentQualification} from '../src/customers/qualifications';
import {qualificationSubmitInput,riskReviewInput,safeReviewProjection} from '../src/customers/types';
import {RiskReviewService,requireCurrentRisk} from '../src/applications/risk-review';

const actor={id:'reviewer',role:'OPERATIONS',authVersion:0};
const code=(value:string)=>(error:any)=>error?.getResponse?.().error?.code===value;
function fixture(){
 const customer:any={id:'customer',name:'合成客户',mobile:'13800000000',drivingYears:5,profile:{city:'上海'},legalIdentityFileId:null};
 const app:any={id:'app',customerId:customer.id,vehicleId:'vehicle',profile:{name:'合成客户'},revision:2,creditRevision:3,status:'IN_REVIEW'};
 const vehicle:any={id:'vehicle',brand:'合成',model:'E',year:2026,vin:'TESTVIN',mileageKm:1000,conditionDisclosure:'正常'};
 const plan:any={id:'plan',applicationId:'app',revision:2,reviewStatus:'DRAFT',commercialHash:hash('commercial'),creditVerificationId:'verification',creditRevision:3,creditBand:'GE750',creditRuleVersion:'ZHIMA_MANUAL_V1',monthlyFeeAmount:500000,depositAmount:0,commercialTerms:{conditions:'合成条款'}};
 const consent:any={id:'consent',applicationId:'app',customerId:'customer',revision:2,version:1,documentId:'credit-doc',status:'ACCEPTED'};
 const verification:any={id:'verification',applicationId:'app',consentId:'consent',revision:3,band:'GE750',ruleVersion:'ZHIMA_MANUAL_V1'};
 const files:any[]=[{id:'id-file',customerId:'customer',adminId:null,purpose:'identity',sha256:hash('id'),mimeType:'image/jpeg'},{id:'license-file',customerId:'customer',adminId:'uploader',purpose:'identity',sha256:hash('license'),mimeType:'image/jpeg'}];
 const qualifications:any[]=[],reviews:any[]=[],commands:any[]=[];
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},
  $queryRaw:async()=>[], $executeRaw:async()=>1,
  adminUser:{findUnique:async()=>({...actor,active:true})},customer:{findUnique:async()=>customer},
  application:{findUnique:async()=>app,update:async({data}:any)=>Object.assign(app,data)},
  finalPlan:{findFirst:async()=>plan,update:async({data}:any)=>Object.assign(plan,data)},vehicle:{findUnique:async()=>vehicle},
  storedFile:{findMany:async({where}:any)=>files.filter(f=>where.id.in.includes(f.id))},
  legalDocument:{findFirst:async()=>({id:'credit-doc',version:1})},customerConsent:{count:async()=>1},creditConsent:{findFirst:async()=>consent,findUnique:async()=>consent},creditVerification:{findFirst:async()=>verification},
  customerQualificationVersion:{findFirst:async()=>qualifications.at(-1),findUnique:async({where}:any)=>qualifications.find(q=>q.id===where.id),findMany:async()=>[...qualifications].reverse(),create:async({data}:any)=>{const q={...data,id:'q'+(qualifications.length+1)};qualifications.push(q);return q;},update:async({where,data}:any)=>Object.assign(qualifications.find(q=>q.id===where.id),data)},
  applicationRiskReview:{findFirst:async({where}:any)=>[...reviews].reverse().find(r=>r.applicationId===where.applicationId),create:async({data}:any)=>{const r={...data,id:'r'+(reviews.length+1),reviewedAt:new Date()};reviews.push(r);return r;}},
  archiveCommand:{findUnique:async({where}:any)=>commands.find(c=>Object.entries(where.actorId_resourceId_action_key).every(([k,v])=>c[k]===v)),create:async({data}:any)=>{commands.push(data);return data;}},
  auditLog:{create:async()=>({})},notification:{create:async()=>({})}
 };
 return{tx,customer,app,vehicle,plan,consent,verification,files,qualifications,reviews};
}
async function approvedQualification(f:ReturnType<typeof fixture>){
 const svc=new QualificationService();
 const q=await svc.submit(f.tx,{...actor,id:'submitter'},'customer',{revision:0,profileHash:customerProfileHash(f.customer),identityFileIds:['id-file'],drivingLicenseFileIds:['license-file'],identityExpiresAt:'2030-01-01T00:00:00.000Z',drivingLicenseExpiresAt:'2030-01-01T00:00:00.000Z',verificationSource:'MANUAL',idempotencyKey:'submit-qualification'});
 return svc.review(f.tx,actor,'customer',{qualificationId:q.id,revision:q.revision,decision:'APPROVED',reasonCodes:[],supplementaryInstructions:'',idempotencyKey:'review-qualification'});
}
function riskInput(f:ReturnType<typeof fixture>,decision='APPROVED'){return{revision:f.app.revision,planRevision:f.plan.revision,commercialHash:f.plan.commercialHash,qualificationId:f.qualifications.at(-1).id,creditVerificationId:f.verification.id,decision,identityChecked:true,drivingQualificationChecked:true,reasonCodes:decision==='APPROVED'?[]:['MATERIALS_INCOMPLETE'],supplementaryInstructions:decision==='NEEDS_INFO'?'请补交驾驶证背面':'',idempotencyKey:'risk-'+decision};}

test('strict qualification and risk DTOs reject scores, screenshots and arbitrary credit notes',()=>{
 const f=fixture();f.qualifications.push({id:'q1'});const input=riskInput(f);
 for(const extra of [{score:780},{fileIds:['credit-screen']},{creditNote:'780分'},{note:'任意信用备注'}])assert.equal(riskReviewInput.safeParse({...input,...extra}).success,false);
 assert.equal(qualificationSubmitInput.safeParse({revision:0,score:780}).success,false);
 assert.equal(riskReviewInput.safeParse({...input,decision:'REJECTED',reasonCodes:[]}).success,false);
 assert.equal(riskReviewInput.safeParse({...input,supplementaryInstructions:'信用780分'}).success,false);
});
test('submission and evidence uploaders cannot self review qualification; stale profile cannot pass',async()=>{
 const f=fixture();await approvedQualification(f);
 const q=f.qualifications[0];q.status='SUBMITTED';
 for(const id of ['submitter','uploader'])await assert.rejects(new QualificationService().review(f.tx,{...actor,id},'customer',{qualificationId:q.id,revision:q.revision,decision:'APPROVED',reasonCodes:[],supplementaryInstructions:'',idempotencyKey:'self-review-'+id}),code('QUALIFICATION_SELF_REVIEW'));
 q.status='APPROVED';f.customer.profile.city='杭州';await assert.rejects(requireCurrentQualification(f.tx,'customer'),code('CUSTOMER_QUALIFICATION_REQUIRED'));
});
test('approval is application-specific, publishes the exact candidate and retries idempotently',async()=>{
 const f=fixture();await approvedQualification(f);const svc=new RiskReviewService(),input=riskInput(f);
 const approved=await svc.assess(f.tx,actor,'app',input);assert.equal(approved.decision,'APPROVED');assert.equal(f.plan.reviewStatus,'APPROVED');assert.equal(f.app.status,'AWAITING_CONFIRMATION');
 assert.equal((await svc.assess(f.tx,actor,'app',input)).id,approved.id);assert.equal(f.reviews.length,1);
 const snapshot=await requireCurrentRisk(f.tx,'app',2);assert.equal(snapshot.planId,'plan');assert.equal(snapshot.creditConsentId,'consent');
 f.app.id='other-app';f.plan.applicationId='other-app';await assert.rejects(requireCurrentRisk(f.tx,'other-app',2),code('RISK_REVIEW_REQUIRED'));
});
test('withdrawn credit, expired identity/license, changed customer/application/vehicle/terms/candidate invalidate approval',async()=>{
 for(const mutate of [
  (f:any)=>f.consent.status='WITHDRAWN', (f:any)=>f.qualifications[0].identityExpiresAt=new Date(0),
  (f:any)=>f.qualifications[0].drivingLicenseExpiresAt=new Date(0), (f:any)=>f.customer.name='变更',
  (f:any)=>f.app.profile={name:'新资料'}, (f:any)=>f.vehicle.vin='OTHER',
  (f:any)=>f.plan.commercialTerms={conditions:'新条款'}, (f:any)=>f.plan.revision=3,
  (f:any)=>f.verification.revision=4, (f:any)=>f.consent.revision=4,
 ]){const f=fixture();await approvedQualification(f);await new RiskReviewService().assess(f.tx,actor,'app',riskInput(f));mutate(f);await assert.rejects(requireCurrentRisk(f.tx,'app',2));}
});
test('NEEDS_INFO blocks confirmation; safe customer/support projections exclude all internal details',async()=>{
 const f=fixture();await approvedQualification(f);await new RiskReviewService().assess(f.tx,actor,'app',riskInput(f,'NEEDS_INFO'));
 assert.equal(f.app.status,'NEEDS_INFO');await assert.rejects(requireCurrentRisk(f.tx,'app',2),code('RISK_REVIEW_REQUIRED'));
 const safe=safeReviewProjection(f.reviews[0]);assert.deepEqual(Object.keys(safe).sort(),['status','supplementaryInstructions']);assert.equal(safe.status,'NEEDS_INFO');assert.equal(safe.supplementaryInstructions,'请补交驾驶证背面');
});
test('withdrawn credit can be recorded as NEEDS_INFO without publishing or treating withdrawal as consent',async()=>{
 const f=fixture();await approvedQualification(f);f.consent.status='WITHDRAWN';
 const input={...riskInput(f,'NEEDS_INFO'),reasonCodes:['CREDIT_CONSENT_REQUIRED'],supplementaryInstructions:'请在申请中处理当前授权状态'};
 const result=await new RiskReviewService().assess(f.tx,actor,'app',input);assert.equal(result.decision,'NEEDS_INFO');assert.equal(f.app.status,'NEEDS_INFO');
 await assert.rejects(requireCurrentRisk(f.tx,'app',2),code('RISK_REVIEW_REQUIRED'));
});
test('risk rejects unauthorized staff, stale revisions, mismatched verification, wrong deposit and unverified identity',async()=>{
 const cases=[{role:'FINANCE'},{revision:1},{creditVerificationId:'another'},{identityChecked:false}];
 for(const change of cases){const f=fixture();await approvedQualification(f);await assert.rejects(new RiskReviewService().assess(f.tx,change.role?{...actor,role:change.role}:actor,'app',{...riskInput(f),...change}));}
 const f=fixture();await approvedQualification(f);f.plan.depositAmount=1;await assert.rejects(new RiskReviewService().assess(f.tx,actor,'app',riskInput(f)),code('CREDIT_REVIEW_REQUIRED'));
});
test('customer status enforces ownership and new qualification versions invalidate an earlier approval',async()=>{
 const f=fixture();await approvedQualification(f);const svc=new RiskReviewService();await svc.assess(f.tx,actor,'app',riskInput(f));
 await assert.rejects(svc.status(f.tx,'app','another-customer'),code('NOT_FOUND'));
 assert.deepEqual(await svc.status(f.tx,'app','customer'),{status:'APPROVED',supplementaryInstructions:''});
 f.qualifications.push({...f.qualifications[0],id:'q2',revision:2,status:'SUBMITTED'});
 assert.deepEqual(await svc.status(f.tx,'app','customer'),{status:'RECHECK_REQUIRED',supplementaryInstructions:''});
});
test('qualification and risk command retries reject changed payloads with the same idempotency key',async()=>{
 const f=fixture();await approvedQualification(f);const svc=new RiskReviewService(),input=riskInput(f);await svc.assess(f.tx,actor,'app',input);
 await assert.rejects(svc.assess(f.tx,actor,'app',{...input,decision:'REJECTED',reasonCodes:['OUTSIDE_SERVICE_SCOPE']}),code('IDEMPOTENCY_CONFLICT'));
});
