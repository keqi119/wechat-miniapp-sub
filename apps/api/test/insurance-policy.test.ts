import test from 'node:test';
import assert from 'node:assert/strict';
import {assertInsuranceFiles,assertIndependentReview,normalizePolicyIdentity,validateReviewChecks} from '../src/insurance/service';
import {policyDraftInput,reviewInput} from '../src/insurance/types';
const file={id:'f',adminId:'uploader',purpose:'insurance',customerId:null,mimeType:'application/pdf',size:10,sha256:'a'.repeat(64)};
const binding={fileId:'f',policyId:'p',vehicleIds:['v'],uploadedBy:'uploader'};
test('同保险机构保单号以规范化标识去重',()=>{assert.deepEqual(normalizePolicyIdentity(' 机构Ａ ',' Ｐ－００１ '),normalizePolicyIdentity('机构A','P-001'));assert.notDeepEqual(normalizePolicyIdentity('机构B','P-001'),normalizePolicyIdentity('机构A','P-001'));});
test('保单附件仅接受本保单逐车绑定私有PDF/JPEG/PNG10MiB',()=>{assert.doesNotThrow(()=>assertInsuranceFiles('p',['v'],['f'],[file],[binding]));for(const change of [{policyId:'other'},{vehicleIds:['other']}])assert.throws(()=>assertInsuranceFiles('p',['v'],['f'],[file],[{...binding,...change}]));for(const change of [{purpose:'vehicle'},{size:10*1024*1024+1},{mimeType:'text/plain'},{customerId:'customer'}])assert.throws(()=>assertInsuranceFiles('p',['v'],['f'],[{...file,...change}],[binding]));});
test('创建者、提交者与任何附件上传者不可自审',()=>{for(const id of ['creator','submitter','uploader'])assert.throws(()=>assertIndependentReview(id,{createdBy:'creator',submittedBy:'submitter'},[file]));assert.doesNotThrow(()=>assertIndependentReview('reviewer',{createdBy:'creator',submittedBy:'submitter'},[file]));});
test('逐项人工证明必须绑定车辆、要求版本、险种及本版本文件',()=>{const version={vehicleIds:['v'],requirementVersionIds:['rv'],fileIds:['f'],coverageItems:[{code:'A'}]};const requirements=[{id:'rv',items:[{code:'A'}]}];const check={vehicleId:'v',requirementVersionId:'rv',itemCode:'A',fileId:'f',confirmed:true,note:'人工已核对原件'};assert.doesNotThrow(()=>validateReviewChecks(version,requirements,[check]));for(const change of [{vehicleId:'other'},{requirementVersionId:'new'},{itemCode:'B'},{fileId:'other'},{confirmed:false}])assert.throws(()=>validateReviewChecks(version,requirements,[{...check,...change}]));});
test('保单及审核DTO拒绝未知字段、非整数金额与空审核证明',()=>{assert.equal(policyDraftInput.safeParse({premiumAmount:1.5}).success,false);assert.equal(reviewInput.safeParse({revision:0,idempotencyKey:'review-1',decision:'APPROVED',checks:[]}).success,false);});

test('草稿修改人员也不可审核',async()=>{
 assert.throws(()=>assertIndependentReview('editor',{createdBy:'creator',submittedBy:'submitter',editedByIds:['editor']},[file]));
});

test('HTTP 无保障配置保单档案、附件、独立审核、续保/批改与提醒持久幂等', {skip:process.env.NODE_ENV!=='test'||!process.env.TEST_DATABASE_URL}, async()=>{
 const databaseUrl=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(databaseUrl.hostname)&&databaseUrl.port==='55432'&&databaseUrl.pathname==='/chundian_test','仅可使用项目本地测试库');process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.ADMIN_ORIGIN='http://localhost:3100';
 const [{Db},{createApp},{listenForHttpTests},{tokenHash},{coverageAt},{createRenewalReminders},{randomUUID}]=await Promise.all([import('../src/common/db'),import('../src/app'),import('./http-listener'),import('../src/auth/auth.service'),import('../src/insurance/coverage'),import('../src/insurance/reminders'),import('node:crypto')]);
 const db=new Db(),suffix=randomUUID();let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try {
  const operators=await Promise.all(['creator','reviewer','support'].map((label,index)=>db.adminUser.create({data:{username:`insurance-${label}-${suffix}`,name:label,passwordHash:'synthetic-unused-password-hash',role:index===2?'SUPPORT':'OPERATIONS'}})));
  const sessions=await Promise.all(operators.map((a,index)=>db.adminSession.create({data:{id:tokenHash(`insurance-test-${index}-${suffix}`),adminId:a.id,csrfToken:`csrf-${index}-${suffix}`,expiresAt:new Date(Date.now()+3600000)}})));
  app=await createApp({db});const base=await listenForHttpTests(app);
  const request=async(path:string,method='GET',body?:unknown,who=0)=>{const headers:Record<string,string>={Origin:'http://localhost:3100',Cookie:`admin_session=insurance-test-${who}-${suffix}`,'X-CSRF-Token':sessions[who].csrfToken};if(!(body instanceof FormData))headers['Content-Type']='application/json';const response=await fetch(`${base}/api/admin/${path}`,{method,headers,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});const data=response.headers.get('content-type')?.includes('application/json')?await response.json() as any:await response.text();return {status:response.status,data};};
  const model=await db.modelDefinition.create({data:{brand:'合成',name:'合成保险车型'}});
  const vehicle=await db.vehicle.create({data:{modelDefinitionId:model.id,brand:'合成',model:'保险测试',title:'合成保险车辆',year:2026,city:'上海',mileageKm:0}});
  const otherVehicle=await db.vehicle.create({data:{modelDefinitionId:model.id,brand:'合成',model:'保险测试',title:'合成另一车辆',year:2026,city:'上海',mileageKm:0}});
  const product=await db.product.create({data:{name:'保险测试产品',createdBy:operators[0].id,versions:{create:{version:1,status:'PUBLISHED',name:'保险测试',months:24,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自理',conditions:'合成数据',vehicleIds:[vehicle.id],modelDefinitionIds:[model.id],createdBy:operators[0].id}}},include:{versions:true}}),pv=product.versions[0];
  const requirementInput={revision:0,idempotencyKey:`requirement-${suffix}`,scopeType:'MODEL',scopeId:model.id,effectiveAt:'2026-01-01',items:[{code:'A',label:'平台正式约定A',description:'合成条款：人工核验'}]};
  const configured=await request('coverage-requirements','POST',requirementInput);assert.equal(configured.status,410);assert.equal(configured.data.error.code,'COVERAGE_REQUIREMENTS_RETIRED');assert.equal(await db.coverageRequirement.count({where:{scopeId:model.id}}),0);
  const startAt='2026-10-01T00:00:00+08:00',endAt='2026-11-01T00:00:00+08:00';
  const draft={revision:0,idempotencyKey:`policy-${suffix}`,insurer:'合成保险机构',policyNumber:`TEST-${suffix}`,policyholder:'合成投保人',insuredParty:'合成被保人',vehicleIds:[vehicle.id],coverageItems:[{code:'A',label:'约定保障A',amount:10000,deductible:'按合成原件',terms:'仅测试，不推断法律要求'}],premiumAmount:100,terms:'测试材料',startAt,endAt,effectiveAt:startAt,fileIds:[],requirementVersionIds:[],changeKind:'ORIGINAL'};
  let created=await request('insurance-policies','POST',draft);assert.equal(created.status,201);const policyId=created.data.id;let current=created.data;
  const replay=await request('insurance-policies','POST',draft);assert.equal(replay.data.id,policyId);assert.equal(await db.insurancePolicy.count({where:{policyNumber:normalizePolicyIdentity(draft.insurer,draft.policyNumber).policyNumber}}),1);
  assert.equal((await request('insurance-policies','POST',{...draft,idempotencyKey:`duplicate-${suffix}`})).status,409);
  assert.equal((await request('insurance-policies','POST',{...draft,policyNumber:'changed'})).status,409);
  assert.equal((await request('insurance-policies','POST',draft,2)).status,403);
  const form=new FormData();form.set('file',new Blob(['%PDF-1.4\nSYNTHETIC INSURANCE ONLY\n%%EOF'],{type:'application/pdf'}),'insurance-test.pdf');form.set('revision',String(current.revision));form.set('idempotencyKey',`upload-${suffix}`);form.set('vehicleIds',JSON.stringify([vehicle.id]));
  const uploaded=await request(`insurance-policies/${policyId}/files`,'POST',form);assert.equal(uploaded.status,201);const fileId=uploaded.data.id;
  assert.equal((await request(`insurance-policies/${policyId}/files/${fileId}`)).status,200);assert.equal((await request(`insurance-policies/${policyId}/files/${fileId}`,'GET',undefined,2)).status,403);
  assert.equal((await request(`insurance-policies/${policyId}/files`,'POST',form)).data.id,fileId);
  current=(await request(`insurance-policies/${policyId}`)).data;let version=current.versions[0];
  const update={...draft,revision:version.revision,idempotencyKey:`update-${suffix}`,fileIds:[fileId]};
  assert.equal((await request(`insurance-policies/${policyId}/versions/${version.id}`,'PATCH',{...update,vehicleIds:[otherVehicle.id],idempotencyKey:`cross-vehicle-${suffix}`})).status,409);
  current=(await request(`insurance-policies/${policyId}/versions/${version.id}`,'PATCH',update)).data;version=current.versions[0];
  let submitted=await request(`insurance-policies/${policyId}/versions/${version.id}/submit`,'POST',{revision:version.revision,idempotencyKey:`submit-${suffix}`});assert.equal(submitted.status,201);version=submitted.data.versions[0];
  const check={vehicleId:vehicle.id,fileId,confirmed:true,note:'独立逐项核验合成PDF'};
  const approval={revision:version.revision,idempotencyKey:`review-${suffix}`,decision:'APPROVED',checks:[check],reason:'合成独立复核'};
  assert.equal((await request(`insurance-policies/${policyId}/versions/${version.id}/review`,'POST',approval)).status,403);
  const approved=await request(`insurance-policies/${policyId}/versions/${version.id}/review`,'POST',approval,1);assert.equal(approved.status,201);current=approved.data;
  assert.equal((await request(`insurance-policies/${policyId}/versions/${version.id}/review`,'POST',approval,1)).status,201);
  assert.equal((await request(`insurance-policies/${policyId}/versions/${version.id}`,'PATCH',{...update,revision:current.versions[0].revision,idempotencyKey:`immutable-${suffix}`})).status,409);
  assert.equal((await db.serial(tx=>coverageAt(tx,vehicle.id,pv.id,new Date('2026-10-27T00:00:00+08:00')))).ready,true);
  await db.serial(tx=>createRenewalReminders(tx,new Date('2026-10-26T00:00:00+08:00')));assert.equal(await db.insuranceRenewalReminder.count({where:{policyId}}),2);assert.equal(await db.serial(tx=>createRenewalReminders(tx,new Date('2026-10-26T00:00:00+08:00'))),0);
  const renewal=await request(`insurance-policies/${policyId}/renewals`,'POST',{...draft,policyNumber:`RENEW-${suffix}`,idempotencyKey:`renew-${suffix}`,startAt:'2026-11-02T00:00:00+08:00',effectiveAt:'2026-11-02T00:00:00+08:00',endAt:'2027-11-02T00:00:00+08:00'});assert.equal(renewal.status,201);assert.notEqual(renewal.data.id,policyId);assert.equal(renewal.data.renewalOfPolicyId,policyId);
  const cancelled=await request(`insurance-policies/${policyId}/versions`,'POST',{...draft,revision:current.revision,idempotencyKey:`cancel-${suffix}`,changeKind:'CANCELLATION',effectiveAt:'2026-10-30T00:00:00+08:00',fileIds:[fileId]});assert.equal(cancelled.status,201);let cancellation=cancelled.data.versions[0];assert.equal(cancellation.version,2);
  const cancellationSubmit=await request(`insurance-policies/${policyId}/versions/${cancellation.id}/submit`,'POST',{revision:0,idempotencyKey:`cancel-submit-${suffix}`});assert.equal(cancellationSubmit.status,201);
  const rejected=await request(`insurance-policies/${policyId}/versions/${cancellation.id}/review`,'POST',{revision:1,idempotencyKey:`reject-${suffix}`,decision:'REJECTED',checks:[],reason:'合成拒绝后补件'},1);assert.equal(rejected.status,201);const rejectedVersion=rejected.data.versions[0];
  const resubmitted=await request(`insurance-policies/${policyId}/versions/${cancellation.id}`,'PATCH',{...draft,fileIds:[fileId],changeKind:'CANCELLATION',effectiveAt:'2026-10-30T00:00:00+08:00',revision:rejectedVersion.revision,idempotencyKey:`resubmit-${suffix}`});assert.equal(resubmitted.status,200);cancellation=resubmitted.data.versions[0];assert.equal(cancellation.version,3);assert.equal(resubmitted.data.versions.find((v:any)=>v.id===rejectedVersion.id).status,'REJECTED');
  assert.equal((await request(`insurance-policies/${policyId}/versions/${cancellation.id}/submit`,'POST',{revision:0,idempotencyKey:`resubmit-submit-${suffix}`})).status,201);
  const cancellationReview=await request(`insurance-policies/${policyId}/versions/${cancellation.id}/review`,'POST',{...approval,checks:[],revision:1,idempotencyKey:`cancel-review-${suffix}`},1);assert.equal(cancellationReview.status,201);
  assert.equal((await db.serial(tx=>coverageAt(tx,vehicle.id,pv.id,new Date('2026-10-29T00:00:00+08:00')))).ready,true);const blocked=await db.serial(tx=>coverageAt(tx,vehicle.id,pv.id,new Date('2026-10-30T00:00:00+08:00')));assert.equal(blocked.blockers.some(b=>b.code==='INSURANCE_POLICY_CANCELLED'),true);
  const changedRequirement=await request('coverage-requirements','POST',{...requirementInput,revision:1,idempotencyKey:`requirement2-${suffix}`,effectiveAt:'2026-10-28'});assert.equal(changedRequirement.status,410);assert.equal((await db.serial(tx=>coverageAt(tx,vehicle.id,pv.id,new Date('2026-10-29T00:00:00+08:00')))).ready,true);
  assert.equal((await request('insurance-policies')).status,200);assert.equal((await request('insurance-policies/renewal-reminders')).status,200);
  assert.equal((await request(`files/${fileId}`,'GET',undefined,2)).status,403);
  await db.adminUser.update({where:{id:operators[0].id},data:{active:false}});assert.equal((await request('insurance-policies','POST',draft)).status,401);
 } finally {if(app)await app.close();await db.$disconnect();}
});



test('审核人员不能将明确低于平台配置额度的证明勾选为满足',()=>{
 const version={vehicleIds:['v'],requirementVersionIds:['rv'],fileIds:['f'],coverageItems:[{code:'A',amount:100}]};
 const requirements=[{id:'rv',items:[{code:'A',minAmount:200}]}];const checks=[{vehicleId:'v',requirementVersionId:'rv',itemCode:'A',fileId:'f',confirmed:true,note:'不应通过'}];
 assert.throws(()=>validateReviewChecks(version,requirements,checks));
});


