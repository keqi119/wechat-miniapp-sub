import {assertOrdinaryReview} from '../auth/ordinary-review';
import {Injectable} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit,hash,pagination} from '../common/data';
import {ensure,fail} from '../common/errors';
import {saveFile,validMime} from '../files/storage';
import {policyDateTime} from './coverage';
import {createRenewalReminders} from './reminders';
import {projectPolicy,registerPolicy,registrationList,requireLegacyPolicy} from './registrations';
import {commandInput,policyDraftInput,reviewInput,uploadInput,reviewCheckInput,policyReviewCheckInput,InsuranceActor,InsuranceTx,InsurancePolicyView,InsuranceFileFact,InsuranceFileBinding,PolicyPage,PageQuery,PolicyFileView,CoverageRequirementView} from './types';

export function normalizePolicyIdentity(insurer:string,policyNumber:string){return {insurer:insurer.normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase(),policyNumber:policyNumber.normalize('NFKC').trim().replace(/\s+/g,'').toUpperCase()};}
export function assertInsuranceFiles(policyId:string,vehicleIds:string[],fileIds:string[],files:InsuranceFileFact[],bindings:InsuranceFileBinding[]){
 ensure(fileIds.length>0&&fileIds.length<=20&&new Set(fileIds).size===fileIds.length,400,'INSURANCE_FILE_INVALID','须有1至20份不重复保单附件');
 const covered=new Set<string>();
 for(const id of fileIds){const file=files.find(f=>f.id===id),binding=bindings.find(b=>b.fileId===id&&b.policyId===policyId);
  ensure(file&&binding&&file.purpose==='insurance'&&!file.customerId&&file.adminId===binding.uploadedBy&&file.size>0&&file.size<=10*1024*1024&&['application/pdf','image/jpeg','image/png'].includes(file.mimeType)&&/^[a-f0-9]{64}$/.test(file.sha256)&&binding.vehicleIds.some(v=>vehicleIds.includes(v)),409,'INSURANCE_FILE_SCOPE','保单附件类型、大小或被保车辆归属无效');
  for(const id of binding.vehicleIds)covered.add(id);
 }
 ensure(vehicleIds.every(id=>covered.has(id)),409,'INSURANCE_FILE_SCOPE','每辆被保车辆均须有对应保单附件');
}
export function assertIndependentReview(reviewerId:string,version:{createdBy:string;submittedBy:string|null;editedByIds?:string[]},files:Pick<InsuranceFileFact,'adminId'>[],role='OPERATIONS'){assertOrdinaryReview({id:reviewerId,role},[version.createdBy,version.submittedBy,...(version.editedByIds||[]),...files.map(f=>f.adminId)],'INSURANCE_SELF_REVIEW',403);}
export function validatePolicyReviewChecks(version:Parameters<typeof validateReviewChecks>[0]&{changeKind:string},requirements:Parameters<typeof validateReviewChecks>[1],checks:unknown){
 if(version.changeKind==='CANCELLATION'){ensure(Array.isArray(checks)&&checks.length===0,400,'INSURANCE_CANCELLATION_CHECKS','退保核验不填写保障通过记录');return [];}
 const parsed=z.array(policyReviewCheckInput).min(1).parse(checks),seen=new Set<string>();
 for(const check of parsed){const key=JSON.stringify([check.vehicleId,check.fileId]);ensure(version.vehicleIds.includes(check.vehicleId)&&version.fileIds.includes(check.fileId)&&!seen.has(key),409,'INSURANCE_CHECK_SCOPE','核验须绑定本版真实被保车辆及保单原件');seen.add(key);}
 ensure(version.vehicleIds.every(id=>parsed.some(check=>check.vehicleId===id)),409,'INSURANCE_CHECK_INCOMPLETE','每辆被保车辆须分别核验');return parsed;
}
export function validateReviewChecks(version:{vehicleIds:string[];requirementVersionIds:string[];fileIds:string[];coverageItems:unknown},requirements:{id:string;items:unknown}[],rawChecks:unknown){
 const checks=z.array(reviewCheckInput).min(1).parse(rawChecks),coverage=z.array(z.object({code:z.string(),amount:z.number().int().nonnegative().nullable().optional()})).parse(version.coverageItems),seen=new Set<string>();
 for(const check of checks){const requirement=requirements.find(r=>r.id===check.requirementVersionId),items=z.array(z.object({code:z.string(),minAmount:z.number().int().nonnegative().nullable().optional()})).safeParse(requirement?.items).data||[],key=`${check.vehicleId}/${check.requirementVersionId}/${check.itemCode}`;
  ensure(version.vehicleIds.includes(check.vehicleId)&&version.requirementVersionIds.includes(check.requirementVersionId)&&version.fileIds.includes(check.fileId)&&coverage.some(i=>i.code===check.itemCode)&&items.some(i=>i.code===check.itemCode)&&!seen.has(key),409,'INSURANCE_CHECK_SCOPE','核验必须逐车绑定本保单附件、险种及要求版本');seen.add(key);
  const minimum=items.find(i=>i.code===check.itemCode)?.minAmount,amount=coverage.find(i=>i.code===check.itemCode)?.amount;ensure(minimum==null||(amount!=null&&amount>=minimum),409,'INSURANCE_AMOUNT_INSUFFICIENT','保单额度低于明确配置的最低保障额，不能勾选满足');
 }
 ensure(version.vehicleIds.every(id=>checks.some(check=>check.vehicleId===id)),409,'INSURANCE_CHECK_INCOMPLETE','每辆被保车辆须分别核验');
 return checks;
}
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function command<T>(tx:InsuranceTx,actor:InsuranceActor,resourceId:string,action:string,input:{idempotencyKey:string},operation:()=>Promise<T>):Promise<T>{
 await requireCurrentStaff(tx,actor,'insurance-policies');
 const where={actorId_resourceId_action_key:{actorId:actor.id,resourceId,action,key:input.idempotencyKey}},requestHash=hash(input),old=await tx.insuranceCommand.findUnique({where});
 if(old){ensure(old.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','相同幂等键不能修改保单请求');return old.resultSnapshot as T;}
 const result=await operation();await tx.insuranceCommand.create({data:{actorId:actor.id,resourceId,action,key:input.idempotencyKey,requestHash,resultSnapshot:json(result)}});return result;
}
const include={versions:{orderBy:{version:'desc' as const}},files:true};
@Injectable()
export class InsuranceService {
 async list(tx:InsuranceTx,actor:InsuranceActor,query:PageQuery):Promise<PolicyPage>{
  return registrationList(tx,actor,query);
 }
 async register(tx:InsuranceTx,actor:InsuranceActor,raw:unknown,files:Express.Multer.File[],policyId?:string){return registerPolicy(tx,actor,raw,files,policyId);}
 async detail(tx:InsuranceTx,actor:InsuranceActor,id:string):Promise<InsurancePolicyView>{
  await requireCurrentStaff(tx,actor,'insurance-policies',false);const policy=await tx.insurancePolicy.findUnique({where:{id},include});ensure(policy,404,'NOT_FOUND','保单不存在');
  const vehicleIds=[...new Set(policy.versions.flatMap(v=>v.vehicleIds))];const orders=await tx.order.findMany({where:{vehicleId:{in:vehicleIds}},select:{id:true}});
  const accidentServices=await tx.serviceRequest.findMany({where:{orderId:{in:orders.map(o=>o.id)},type:{in:['ACCIDENT','accident']}},select:{id:true,orderId:true,status:true,createdAt:true},orderBy:{createdAt:'desc'},take:100});
  return {...await projectPolicy(tx,policy),accidentServices};
 }
 async createDraft(tx:InsuranceTx,actor:InsuranceActor,raw:unknown,policyId?:string,renewalOfPolicyId?:string):Promise<InsurancePolicyView>{
  const input=policyDraftInput.parse(raw);return command(tx,actor,policyId||renewalOfPolicyId||'NEW','CREATE_DRAFT',input,async()=>{
   if(policyId)await requireLegacyPolicy(tx,policyId);if(renewalOfPolicyId)await requireLegacyPolicy(tx,renewalOfPolicyId);
   const identity=normalizePolicyIdentity(input.insurer,input.policyNumber);let policy=policyId?await tx.insurancePolicy.findUnique({where:{id:policyId}}):null;
   if(policyId){ensure(policy,404,'NOT_FOUND','保单不存在');ensure(policy.revision===input.revision,409,'REVISION_CONFLICT','保单已更新');ensure(policy.insurer===identity.insurer&&policy.policyNumber===identity.policyNumber,409,'INSURANCE_IDENTITY_IMMUTABLE','保险机构及原保单号不得变更');ensure(input.changeKind!=='ORIGINAL',400,'INSURANCE_CHANGE_KIND','原保单后续版本必须标注批改或退保');}
   else {ensure(input.revision===0,409,'REVISION_CONFLICT','新保单修订号须为0');ensure(input.changeKind==='ORIGINAL',400,'INSURANCE_CHANGE_KIND','新保单须为原始版本');if(renewalOfPolicyId)ensure(await tx.insurancePolicy.count({where:{id:renewalOfPolicyId}}),404,'NOT_FOUND','续保来源不存在');ensure(!await tx.insurancePolicy.count({where:identity}),409,'INSURANCE_POLICY_DUPLICATE','该保险机构下保单号已存在');policy=await tx.insurancePolicy.create({data:{...identity,renewalOfPolicyId,createdBy:actor.id}});}
   ensure(policy,404,'NOT_FOUND','保单不存在');await this.validateScope(tx,input.vehicleIds,input.requirementVersionIds);
   const last=await tx.insurancePolicyVersion.findFirst({where:{policyId:policy.id},orderBy:{version:'desc'}}),data=this.draftData(input);
   if(last)ensure(data.effectiveAt>=last.effectiveAt,409,'INSURANCE_EFFECTIVE_ORDER','批改生效时间不得早于上一版本');
   const changed=await tx.insurancePolicy.updateMany({where:{id:policy.id,revision:input.revision},data:{revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','保单已更新');
   // Empty draft files allow creating a policy before its dedicated upload endpoint can bind originals.
   if(input.fileIds.length)await this.files(tx,policy.id,input.vehicleIds,input.fileIds);
   const version=await tx.insurancePolicyVersion.create({data:{...data,policyId:policy.id,version:(last?.version||0)+1,createdBy:actor.id}});
   await audit(tx,actor.id,'CREATE_DRAFT','insurance-policies',policy.id,{versionId:version.id,renewalOfPolicyId});return this.detail(tx,actor,policy.id);
  });
 }
 async updateDraft(tx:InsuranceTx,actor:InsuranceActor,versionId:string,raw:unknown):Promise<InsurancePolicyView>{
  const input=policyDraftInput.parse(raw);return command(tx,actor,versionId,'UPDATE_DRAFT',input,async()=>{
   const version=await this.version(tx,versionId);await requireLegacyPolicy(tx,version.policyId);const policy=await tx.insurancePolicy.findUniqueOrThrow({where:{id:version.policyId}}),identity=normalizePolicyIdentity(input.insurer,input.policyNumber);
   ensure(version.status==='DRAFT'||version.status==='REJECTED',409,'INSURANCE_IMMUTABLE','已提交及已审核版本不能覆盖');ensure(identity.insurer===policy.insurer&&identity.policyNumber===policy.policyNumber&&input.changeKind===version.changeKind,409,'INSURANCE_IDENTITY_IMMUTABLE','机构、保单号及版本类型不可修改');
   await this.validateScope(tx,input.vehicleIds,input.requirementVersionIds);if(input.fileIds.length)await this.files(tx,policy.id,input.vehicleIds,input.fileIds);
   const data=this.draftData(input),prior=await tx.insurancePolicyVersion.findFirst({where:{policyId:policy.id,id:{not:versionId},status:'APPROVED'},orderBy:{effectiveAt:'desc'}});if(prior)ensure(data.effectiveAt>=prior.effectiveAt,409,'INSURANCE_EFFECTIVE_ORDER','批改生效时间不得早于已审版本');
   if(version.status==='REJECTED'){
    ensure(version.revision===input.revision,409,'REVISION_CONFLICT','保单草稿已更新');const latest=await tx.insurancePolicyVersion.findFirst({where:{policyId:policy.id},orderBy:{version:'desc'}});ensure(latest?.id===versionId,409,'REVISION_CONFLICT','已有更新的保单版本');
    await tx.insurancePolicyVersion.create({data:{...data,policyId:policy.id,version:version.version+1,createdBy:actor.id,editedByIds:[actor.id]}});
   }else{
    const changed=await tx.insurancePolicyVersion.updateMany({where:{id:versionId,revision:input.revision,status:'DRAFT'},data:{...data,revision:{increment:1},editedByIds:{push:actor.id}}});ensure(changed.count===1,409,'REVISION_CONFLICT','保单草稿已更新');
   }
   await tx.insurancePolicy.update({where:{id:policy.id},data:{revision:{increment:1}}});await audit(tx,actor.id,'UPDATE_DRAFT','insurance-policies',policy.id,{versionId});return this.detail(tx,actor,policy.id);
  });
 }
 async submit(tx:InsuranceTx,actor:InsuranceActor,versionId:string,raw:unknown):Promise<InsurancePolicyView>{
  const input=commandInput.parse(raw);return command(tx,actor,versionId,'SUBMIT',input,async()=>{
   const version=await this.version(tx,versionId);await requireLegacyPolicy(tx,version.policyId);ensure(version.status==='DRAFT',409,'INSURANCE_IMMUTABLE','仅草稿可提交');await this.validateScope(tx,version.vehicleIds,version.requirementVersionIds);await this.files(tx,version.policyId,version.vehicleIds,version.fileIds);
   const changed=await tx.insurancePolicyVersion.updateMany({where:{id:versionId,revision:input.revision,status:'DRAFT'},data:{status:'SUBMITTED',revision:{increment:1},submittedBy:actor.id,submittedAt:new Date()}});ensure(changed.count===1,409,'REVISION_CONFLICT','保单版本已更新');
   await tx.insurancePolicy.update({where:{id:version.policyId},data:{revision:{increment:1}}});await audit(tx,actor.id,'SUBMIT','insurance-policies',version.policyId,{versionId});return this.detail(tx,actor,version.policyId);
  });
 }
 async review(tx:InsuranceTx,actor:InsuranceActor,policyVersionId:string,raw:unknown):Promise<InsurancePolicyView>{
  const input=reviewInput.parse(raw);return command(tx,actor,policyVersionId,'REVIEW',input,async()=>{
   const version=await this.version(tx,policyVersionId);await requireLegacyPolicy(tx,version.policyId);ensure(version.status==='SUBMITTED',409,'INSURANCE_REVIEW_STATE','仅待审核版本可审核');const files=await this.files(tx,version.policyId,version.vehicleIds,version.fileIds);assertIndependentReview(actor.id,version,files,actor.role);
   if(input.decision==='APPROVED'){
    const checks=validatePolicyReviewChecks(version,[],input.checks),bindings=await tx.insurancePolicyFile.findMany({where:{policyId:version.policyId,fileId:{in:version.fileIds}}});
    ensure(checks.every(c=>bindings.some(b=>b.fileId===c.fileId&&b.vehicleIds.includes(c.vehicleId))),409,'INSURANCE_CHECK_SCOPE','核验附件未绑定当前被保车辆');
   }
   const changed=await tx.insurancePolicyVersion.updateMany({where:{id:policyVersionId,revision:input.revision,status:'SUBMITTED'},data:{status:input.decision,revision:{increment:1},reviewedBy:actor.id,reviewedAt:new Date(),reviewChecks:json(input.checks),reviewReason:input.reason}});ensure(changed.count===1,409,'REVISION_CONFLICT','保单审核状态已更新');
   await tx.insurancePolicy.update({where:{id:version.policyId},data:{revision:{increment:1}}});await audit(tx,actor.id,input.decision,'insurance-policies',version.policyId,{policyVersionId,requirementVersionIds:version.requirementVersionIds});return this.detail(tx,actor,version.policyId);
  });
 }
 async retiredRequirements(tx:InsuranceTx,actor:InsuranceActor,write=false):Promise<never>{await requireCurrentStaff(tx,actor,'coverage-requirements',write);return fail(410,'COVERAGE_REQUIREMENTS_RETIRED','保障要求管理已停用；保单仍须按真实原件、车辆及有效期独立复核');}
 async requirements(tx:InsuranceTx,actor:InsuranceActor):Promise<{items:CoverageRequirementView[];total:number}>{return this.retiredRequirements(tx,actor);}
 async configureRequirement(tx:InsuranceTx,actor:InsuranceActor,_raw:unknown):Promise<CoverageRequirementView>{return this.retiredRequirements(tx,actor,true);}
 async uploadFile(tx:InsuranceTx,actor:InsuranceActor,policyId:string,raw:unknown,file:Express.Multer.File):Promise<PolicyFileView>{
  const input=uploadInput.parse(raw);ensure(file&&Buffer.isBuffer(file.buffer)&&file.buffer.length===file.size&&file.size>0&&file.size<=10*1024*1024&&validMime(file.buffer,file.mimetype),400,'INSURANCE_FILE_INVALID','仅支持内容有效的10MiB PDF/JPEG/PNG');
  const digest=hash({sha256:require('node:crypto').createHash('sha256').update(file.buffer).digest('hex'),name:file.originalname,mimeType:file.mimetype});
  const uploadCommand={...input,digest};return command(tx,actor,policyId,'UPLOAD_FILE',uploadCommand,async()=>{
   await requireLegacyPolicy(tx,policyId);const policy=await tx.insurancePolicy.findUnique({where:{id:policyId},include:{versions:{orderBy:{version:'desc'},take:1}}});ensure(policy,404,'NOT_FOUND','保单不存在');const draft=policy.versions[0];ensure(draft&&(draft.status==='DRAFT'||draft.status==='REJECTED')&&input.vehicleIds.every(v=>draft.vehicleIds.includes(v)),409,'INSURANCE_FILE_SCOPE','仅可向当前草稿的被保车辆上传附件');
   const changed=await tx.insurancePolicy.updateMany({where:{id:policyId,revision:input.revision},data:{revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','保单已更新');
   const saved=await saveFile(file),stored=await tx.storedFile.create({data:{...saved,purpose:'insurance',adminId:actor.id}});await tx.insurancePolicyFile.create({data:{policyId,fileId:stored.id,vehicleIds:input.vehicleIds,uploadedBy:actor.id}});
   await audit(tx,actor.id,'UPLOAD_FILE','insurance-policies',policyId,{fileId:stored.id,vehicleIds:input.vehicleIds,sha256:stored.sha256});return {id:stored.id,name:stored.name,mimeType:stored.mimeType,size:stored.size,policyId,vehicleIds:input.vehicleIds,revision:input.revision+1};
  });
 }
 async readFile(tx:InsuranceTx,actor:InsuranceActor,policyId:string,fileId:string){await requireCurrentStaff(tx,actor,'insurance-policies',false);ensure(await tx.insurancePolicyFile.count({where:{policyId,fileId}}),404,'NOT_FOUND','保单附件不存在');const file=await tx.storedFile.findUnique({where:{id:fileId}});ensure(file&&file.purpose==='insurance',404,'NOT_FOUND','保单附件不存在');return file;}
 async reminders(tx:InsuranceTx,actor:InsuranceActor,query:PageQuery){await requireCurrentStaff(tx,actor,'insurance-policies',false);const p=pagination(query),where:Prisma.InsuranceRenewalReminderWhereInput={...(query.status?{status:query.status}:{}),...(query.vehicleId?{vehicleId:query.vehicleId}:{})};const [items,total]=await Promise.all([tx.insuranceRenewalReminder.findMany({where,skip:p.skip,take:p.take,orderBy:{dueAt:'asc'}}),tx.insuranceRenewalReminder.count({where})]);return {items,total,page:p.page,pageSize:p.pageSize};}
 async reviewTasks(tx:InsuranceTx,actor:InsuranceActor,_query:PageQuery):Promise<never>{return this.retiredRequirements(tx,actor);}
 async refreshReminders(tx:InsuranceTx,actor:InsuranceActor,raw:unknown){const input=commandInput.parse(raw);return command(tx,actor,'REMINDERS','REFRESH_REMINDERS',input,async()=>{const created=await createRenewalReminders(tx,new Date());await audit(tx,actor.id,'REFRESH_REMINDERS','insurance-policies','REMINDERS',{created});return {created};});}
 private async version(tx:InsuranceTx,id:string){const version=await tx.insurancePolicyVersion.findUnique({where:{id}});ensure(version,404,'NOT_FOUND','保单版本不存在');return version;}
 private draftData(input:z.infer<typeof policyDraftInput>){const startAt=policyDateTime(input.startAt),endAt=policyDateTime(input.endAt,true),effectiveAt=policyDateTime(input.effectiveAt);ensure(startAt<endAt,400,'INSURANCE_INTERVAL_INVALID','保障截止须晚于起始');const identity=normalizePolicyIdentity(input.insurer,input.policyNumber);return {insurerSnapshot:identity.insurer,policyNumberSnapshot:identity.policyNumber,policyholder:input.policyholder,insuredParty:input.insuredParty,vehicleIds:input.vehicleIds,coverageItems:json(input.coverageItems),premiumAmount:input.premiumAmount,terms:input.terms,startAt,endAt,effectiveAt,fileIds:input.fileIds,requirementVersionIds:input.requirementVersionIds,changeKind:input.changeKind};}
 private async validateScope(tx:InsuranceTx,vehicleIds:string[],_requirementVersionIds:string[]){
  const vehicles=await tx.vehicle.findMany({where:{id:{in:vehicleIds}},select:{id:true}});ensure(vehicles.length===vehicleIds.length,404,'INSURANCE_VEHICLE_MISSING','被保车辆不存在');
 }
 private async files(tx:InsuranceTx,policyId:string,vehicleIds:string[],fileIds:string[]){const [files,bindings]=await Promise.all([tx.storedFile.findMany({where:{id:{in:fileIds}}}),tx.insurancePolicyFile.findMany({where:{policyId,fileId:{in:fileIds}}})]);assertInsuranceFiles(policyId,vehicleIds,fileIds,files,bindings);return files;}
}
