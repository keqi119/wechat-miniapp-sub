import {lockTechnical,TECHNICAL_KIND,assertTechnicalIdentity} from '../../technical-acceptance/rules';
import { Db } from '../../common/db';
import { ensure } from '../../common/errors';
import { audit } from '../../common/data';
import { ContractPdfArtifactWriterService, SignatureKind } from '../../contract/contract-pdf-artifact-writer.service';
import { CustomerESignOnboardingService } from '../customer-esign-onboarding.service';
import { FadadaSettings } from '../esign.settings';
import { SignaturePolicyEngine } from './signature-policy-engine';
import { compileSigningPlan } from './signing-plan-compiler';
import { hashSigningPlanPayload } from './signing-plan-hash';
export class SignaturePolicyService {
  private engine=new SignaturePolicyEngine();
  private reviewHash(plan:unknown,documentHash:string,sourcePdfHash:string,slotCoordinates:unknown){return hashSigningPlanPayload({compiledPlan:plan,documentHash,sourcePdfHash,slotCoordinates});}
  private reviewPlan(plan:any,stored:any){const renewal=stored?.renewal;if(!renewal)return plan;ensure(typeof renewal.taskId==='string'&&typeof renewal.priorApprovalId==='string'&&Object.keys(renewal).length===2,409,'RENEWAL_STATE','重新授权来源无效');return{...plan,renewal:{taskId:renewal.taskId,priorApprovalId:renewal.priorApprovalId}};}
  constructor(private db:Db,private writer:ContractPdfArtifactWriterService,private accounts:CustomerESignOnboardingService,private settings:FadadaSettings){}
  private async evaluation(kind:SignatureKind,resourceId:string,policyId:string,actorId:string){
    const [resource,policy,actor]=await Promise.all([this.writer.resource(kind,resourceId),this.db.signaturePolicy.findUnique({where:{id:policyId}}),this.db.adminUser.findUnique({where:{id:actorId}})]);
    if(kind==='TECHNICAL_ACCEPTANCE')await assertTechnicalIdentity(this.db,resource);
    if(kind==='TECHNICAL_ACCEPTANCE')ensure(resource.confirmedAt&&!resource.stoppedAt&&!resource.purgedAt&&!resource.purgeStartedAt&&['DRAFT','PENDING'].includes(resource.status),409,'ACCEPTANCE_STATE','验收已停止或本人未确认');
    if(kind==='AMENDMENT')ensure(resource.delayQuote?.status==='CONFIRMED'&&resource.delayQuote.change.activeQuoteId===resource.delayQuote.id&&resource.delayQuote.change.status==='AWAITING_SIGNATURE',409,'AMENDMENT_STATE','补充协议不再是当前待签版本');
    ensure(actor?.active,403,'SEAL_REQUESTER_INACTIVE','签章申请人不可用');
    ensure(policy?.status==='ACTIVE'&&policy.kind===kind,409,'SIGNATURE_POLICY','签署策略不可用');
    const seal=await this.db.enterpriseSeal.findUnique({where:{id:policy.sealId}});
    ensure(seal?.status==='ACTIVE'&&seal.organizationName==='上海晓浪网络科技有限公司'&&seal.confirmedBy&&seal.confirmedAt&&seal.providerCustomerId&&seal.providerSignatureId,409,'ENTERPRISE_SEAL','正式企业印章尚未核验启用');
    const authorities=await this.db.sealAuthority.findMany({where:{sealId:seal.id}});
    const readiness=await this.accounts.readiness(resource.customerId);
    const policyView={id:policy.id,policyCode:policy.policyCode,policyName:policy.policyName,status:policy.status as 'ACTIVE',executionMode:policy.executionMode as 'PARALLEL'|'SEQUENTIAL',requiresEnterpriseSeal:true,defaultSealId:seal.id};
    const sealView={id:seal.id,provider:'FADADA' as const,providerSealId:seal.providerSignatureId,sealName:seal.sealName,sealType:'COMPANY' as const,status:seal.status as 'ACTIVE'};
    const decision=this.engine.evaluate({actor:{id:actor.id,roleCodes:[actor.role],permissionCodes:[]},authorities:authorities as any,contract:{id:resourceId,businessType:kind,contractTemplateType:kind,status:(kind!=='HANDOVER'?['DRAFT','PENDING'].includes(resource.status):resource.status==='CUSTOMER_CONFIRMED')?'PENDING_SIGN':resource.status},customer:{id:resource.customerId,status:'ACTIVE'},customerReadiness:readiness,order:kind==='TECHNICAL_ACCEPTANCE'?undefined:{id:resource.orderId,customerId:resource.customerId,orderStatus:resource.order?.status||'AWAITING_SIGNATURE'},policy:policyView,seal:sealView,source:'ADMIN'});
    ensure(['ALLOW','REQUIRE_APPROVAL'].includes(decision.code),409,decision.code,'签署策略或客户实名状态不满足要求');
    // Compilation here creates an immutable review draft only. Provider execution
    // still requires approved(), two distinct active people and both authorities.
    const plan=compileSigningPlan({contractId:resourceId,customerId:resource.customerId,orderId:resource.orderId,decision:{...decision,code:'ALLOW',compileAllowed:true},policy:policyView,seal:sealView});
    return {resource,policy,seal,authorities,actor,plan};
  }
  async prepare(kind:SignatureKind,resourceId:string,policyId:string,requesterId:string){
    const context=await this.evaluation(kind,resourceId,policyId,requesterId);
    const documentHash=kind!=='HANDOVER'?context.resource.documentHash:context.resource.manifestHash;
    const where={kind,resourceId,documentHash,policyId,status:{in:['PENDING','APPROVED']},expiresAt:{gt:new Date()}};
    const existing=await this.db.eSignApproval.findFirst({where,orderBy:{createdAt:'desc'}});
    if(existing){ensure(existing.requesterId===requesterId,409,'APPROVAL_EXISTS','已有签章复核申请');ensure(existing.planHash===this.reviewHash(this.reviewPlan(context.plan,existing.plan),existing.documentHash,existing.sourcePdfHash,existing.slotCoordinates),409,'PLAN_CHANGED','策略已变化，请先拒绝旧复核申请');return existing;}
    const artifact=await this.writer.prepare(kind,resourceId,this.settings);
    return this.db.serial(async tx=>{
      if(kind===TECHNICAL_KIND){const current=await lockTechnical(tx,resourceId);ensure(current?.confirmedAt&&!current.stoppedAt&&!current.purgeStartedAt&&!current.purgedAt&&current.status==='DRAFT'&&current.documentHash===documentHash,409,'ACCEPTANCE_STATE','验收准备期间状态已变化');}
      const concurrent=await tx.eSignApproval.findFirst({where:{...where,expiresAt:{gt:new Date()}},orderBy:{createdAt:'desc'}});
      if(concurrent){ensure(concurrent.requesterId===requesterId,409,'APPROVAL_EXISTS','已有签章复核申请');return concurrent;}
      const approval=await tx.eSignApproval.create({data:{kind,resourceId,customerId:context.resource.customerId,documentHash,sourceFileId:artifact.file.id,sourcePdfHash:artifact.file.sha256,slotCoordinates:artifact.slotCoordinates,policyId,sealId:context.seal.id,requesterId,status:'PENDING',planHash:this.reviewHash(context.plan,documentHash,artifact.file.sha256,artifact.slotCoordinates),plan:context.plan as any,expiresAt:new Date(Date.now()+24*60*60*1000)}});
      await audit(tx,requesterId,'SIGNATURE_REVIEW_REQUESTED','esign-approvals',approval.id,{resourceId,sourcePdfHash:artifact.file.sha256,planHash:approval.planHash});return approval;
    });
  }
  private canApprove(authorities:any[],sealId:string,actor:any){return authorities.some(a=>a.sealId===sealId&&a.status==='ACTIVE'&&a.authorityType==='APPROVE_USE'&&((a.subjectType==='USER'&&a.subjectId===actor.id)||(a.subjectType==='ROLE'&&a.subjectId===actor.role)));}
  async renewalEligibility(id:string){
    const prior=await this.db.eSignApproval.findUnique({where:{id}});
    if(!prior||prior.status!=='APPROVED'||prior.expiresAt>new Date())return{eligible:false,reason:'仅已过期的已批准签章授权可以重新申请'};
    const task=await this.db.fadadaTask.findUnique({where:{approvalId:id}});
    if(!task||!['PREPARED','PENDING'].includes(task.status))return{eligible:false,reason:'当前授权没有未完成的签署任务'};
    if(task.processingUntil&&task.processingUntil>new Date())return{eligible:false,reason:'签署任务正在处理中，请稍后重试'};
    if(task.kind!==prior.kind||task.resourceId!==prior.resourceId||task.customerId!==prior.customerId||task.documentHash!==prior.documentHash||task.sourceFileId!==prior.sourceFileId||task.sourcePdfHash!==prior.sourcePdfHash)return{eligible:false,reason:'任务与原始文档归属或哈希不一致'};
    return{eligible:true,reason:'复用同一签署任务与原始PDF，需重新双人复核',taskId:task.id};
  }
  async renew(id:string,policyId:string,requesterId:string){
    const eligibility=await this.renewalEligibility(id);ensure(eligibility.eligible&&eligibility.taskId,409,'RENEWAL_STATE',eligibility.reason);
    const prior=await this.db.eSignApproval.findUniqueOrThrow({where:{id}}),task=await this.db.fadadaTask.findUniqueOrThrow({where:{id:eligibility.taskId}});
    ensure(prior.planHash===this.reviewHash(prior.plan,prior.documentHash,prior.sourcePdfHash,prior.slotCoordinates),409,'SIGNING_PLAN_CHANGED','原始复核证据已变化');
    const context=await this.evaluation(prior.kind as SignatureKind,prior.resourceId,policyId,requesterId);
    ensure(context.resource.customerId===task.customerId&&(prior.kind!=='HANDOVER'?context.resource.documentHash:context.resource.manifestHash)===task.documentHash&&context.seal.providerCustomerId===task.platformProviderId&&context.seal.id===prior.sealId,409,'RENEWAL_IDENTITY','重新授权不能改变业务文档、企业签署身份或原印章');
    await this.writer.readVerified(task.sourceFileId,task.sourcePdfHash);
    const plan={...context.plan,renewal:{taskId:task.id,priorApprovalId:id}};
    return this.db.serial(async tx=>{
      const current=await tx.fadadaTask.findUniqueOrThrow({where:{id:task.id}});ensure(current.approvalId===id&&['PREPARED','PENDING'].includes(current.status)&&(!current.processingUntil||current.processingUntil<=new Date()),409,'RENEWAL_STATE','当前签署授权或任务处理状态已变化');
      const existing=await tx.eSignApproval.findFirst({where:{kind:prior.kind,resourceId:prior.resourceId,documentHash:prior.documentHash,policyId,status:'PENDING',expiresAt:{gt:new Date()},plan:{path:['renewal','priorApprovalId'],equals:id}},orderBy:{createdAt:'desc'}});
      if(existing){ensure(existing.requesterId===requesterId&&existing.planHash===this.reviewHash(plan,prior.documentHash,task.sourcePdfHash,prior.slotCoordinates),409,'APPROVAL_EXISTS','已有其他重新授权申请');return existing;}
      const next=await tx.eSignApproval.create({data:{kind:prior.kind,resourceId:prior.resourceId,customerId:prior.customerId,documentHash:prior.documentHash,sourceFileId:task.sourceFileId,sourcePdfHash:task.sourcePdfHash,slotCoordinates:prior.slotCoordinates as any,policyId,sealId:context.seal.id,requesterId,status:'PENDING',plan:plan as any,planHash:this.reviewHash(plan,prior.documentHash,task.sourcePdfHash,prior.slotCoordinates),expiresAt:new Date(Date.now()+24*60*60*1000)}});
      await audit(tx,requesterId,'SIGNATURE_REAUTHORIZATION_REQUESTED','esign-approvals',next.id,{priorApprovalId:id,taskId:task.id,sourcePdfHash:task.sourcePdfHash});return next;
    });
  }
  async reject(id:string,reviewerId:string,reason:string){
    ensure(typeof reason==='string'&&reason.trim()&&reason.length<=500,400,'REVIEW_REASON','请填写拒绝原因');
    const draft=await this.db.eSignApproval.findUnique({where:{id}});ensure(draft,404,'NOT_FOUND','签章复核申请不存在');ensure(draft.requesterId!==reviewerId,403,'TWO_PERSON_REQUIRED','申请人与复核人必须不同');
    const [reviewer,authorities]=await Promise.all([this.db.adminUser.findUnique({where:{id:reviewerId}}),this.db.sealAuthority.findMany({where:{sealId:draft.sealId}})]);
    ensure(reviewer?.active&&this.canApprove(authorities,draft.sealId,reviewer),403,'SEAL_APPROVER_AUTHORITY','当前人员无有效印章复核授权');
    return this.db.serial(async tx=>{ensure(!await tx.fadadaTask.count({where:{approvalId:id}}),409,'APPROVAL_PROTECTED','此复核已用于签署任务');const result=await tx.eSignApproval.updateMany({where:{id,status:'PENDING'},data:{status:'REJECTED',approverId:reviewerId}});ensure(result.count===1,409,'APPROVAL_STATE','复核已由其他操作处理');await audit(tx,reviewerId,'SIGNATURE_REVIEW_REJECTED','esign-approvals',id,{reason:reason.trim(),planHash:draft.planHash,sourcePdfHash:draft.sourcePdfHash});return tx.eSignApproval.findUniqueOrThrow({where:{id}});});
  }
  async approve(id:string,approverId:string,planHash:string){
    const draft=await this.db.eSignApproval.findUnique({where:{id}});ensure(draft,404,'NOT_FOUND','签章复核申请不存在');ensure(draft.requesterId!==approverId,403,'TWO_PERSON_REQUIRED','申请人与复核人必须不同');
    const context=await this.evaluation(draft.kind as SignatureKind,draft.resourceId,draft.policyId,draft.requesterId);
    const approver=await this.db.adminUser.findUnique({where:{id:approverId}});
    ensure(approver?.active&&this.canApprove(context.authorities,draft.sealId,approver),403,'SEAL_APPROVER_AUTHORITY','当前人员无有效印章复核授权');
    ensure(draft.status==='PENDING'&&draft.expiresAt>new Date()&&planHash===draft.planHash&&planHash===this.reviewHash(this.reviewPlan(context.plan,draft.plan),draft.documentHash,draft.sourcePdfHash,draft.slotCoordinates),409,'APPROVAL_STATE','复核版本、策略或有效期已变化');
    ensure((draft.kind!=='HANDOVER'?context.resource.documentHash:context.resource.manifestHash)===draft.documentHash,409,'DOCUMENT_MISMATCH','复核文档已变化');
    await this.writer.readVerified(draft.sourceFileId,draft.sourcePdfHash);
    return this.db.serial(async tx=>{const renewal=(draft.plan as any)?.renewal;if(renewal){const changed=await tx.fadadaTask.updateMany({where:{id:renewal.taskId,approvalId:renewal.priorApprovalId,kind:draft.kind,resourceId:draft.resourceId,customerId:draft.customerId,documentHash:draft.documentHash,sourceFileId:draft.sourceFileId,sourcePdfHash:draft.sourcePdfHash,platformProviderId:context.seal.providerCustomerId,status:{in:['PREPARED','PENDING']},OR:[{processingUntil:null},{processingUntil:{lt:new Date()}}]},data:{approvalId:id}});ensure(changed.count===1,409,'RENEWAL_STATE','签署任务或旧授权已变化，不能切换授权');await audit(tx,approverId,'SIGNATURE_TASK_REAUTHORIZED','esign-tasks',renewal.taskId,{priorApprovalId:renewal.priorApprovalId,approvalId:id,sourcePdfHash:draft.sourcePdfHash,planHash});}const updated=await tx.eSignApproval.updateMany({where:{id,status:'PENDING',planHash,expiresAt:{gt:new Date()}},data:{status:'APPROVED',approverId,approvedAt:new Date()}});ensure(updated.count===1,409,'APPROVAL_STATE','复核已由其他操作处理');await audit(tx,approverId,'SIGNATURE_REVIEW_APPROVED','esign-approvals',id,{planHash,sourcePdfHash:draft.sourcePdfHash});return tx.eSignApproval.findUniqueOrThrow({where:{id}});});
  }
  async approved(kind:SignatureKind,resourceId:string,documentHash:string,approvalId?:string){
    const approval=approvalId?await this.db.eSignApproval.findUnique({where:{id:approvalId}}):await this.db.eSignApproval.findFirst({where:{kind,resourceId,documentHash,status:'APPROVED'},orderBy:{approvedAt:'desc'}});
    ensure(approval&&approval.kind===kind&&approval.resourceId===resourceId&&approval.documentHash===documentHash&&approval.status==='APPROVED'&&approval.approvedAt&&approval.approverId&&approval.requesterId!==approval.approverId&&approval.expiresAt>new Date(),409,'SIGNATURE_APPROVAL_REQUIRED','请先完成当前文档和印章的双人复核');
    const context=await this.evaluation(kind,resourceId,approval.policyId,approval.requesterId);
    const reviewer=await this.db.adminUser.findUnique({where:{id:approval.approverId!}});
    ensure(reviewer?.active&&this.canApprove(context.authorities,approval.sealId,reviewer),403,'SEAL_APPROVER_AUTHORITY','印章复核授权已失效');
    ensure(this.reviewHash(this.reviewPlan(context.plan,approval.plan),approval.documentHash,approval.sourcePdfHash,approval.slotCoordinates)===approval.planHash&&context.seal.id===approval.sealId&&(kind!=='HANDOVER'?context.resource.documentHash:context.resource.manifestHash)===documentHash,409,'SIGNING_PLAN_CHANGED','签署方案已变化');
    await this.writer.readVerified(approval.sourceFileId,approval.sourcePdfHash);
    return {...context,approval};
  }
}
