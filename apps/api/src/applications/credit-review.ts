import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../common/db';
import { audit, hash, key, text } from '../common/data';
import { ensure } from '../common/errors';
import { requireCurrentConsents } from '../auth/consents';
import { acceptancePricingOffer } from './acceptance-pricing';
export const CREDIT_RULE = 'ZHIMA_MANUAL_V1';
const editable = ['SUBMITTED','IN_REVIEW','NEEDS_INFO','AWAITING_CONFIRMATION'];
const multipliers: Record<string,number> = { GE750:0, B700_749:1, B650_699:2 };
async function currentDocument(tx:any) {
  return tx.legalDocument.findFirst({where:{type:'credit-verification',status:'PUBLISHED',confirmedAt:{not:null}},orderBy:{version:'desc'}});
}
async function state(tx:any, app:any) {
  const [document,consent,verification] = await Promise.all([currentDocument(tx),tx.creditConsent.findFirst({where:{applicationId:app.id},orderBy:{revision:'desc'}}),tx.creditVerification.findFirst({where:{applicationId:app.id},orderBy:{revision:'desc'}})]);
  const consentValid = !!document && consent?.status === 'ACCEPTED' && consent.documentId === document.id && consent.version === document.version;
  const verified = !!(consentValid && verification?.consentId === consent.id && verification.revision === app.creditRevision && verification.ruleVersion === CREDIT_RULE);
  return {document,consent,verification,consentValid,verified};
}
export async function requireCredit(tx:any, app:any, verificationId:string) {
  const s = await state(tx,app);
  ensure(s.verified && s.verification.id === verificationId,409,'CREDIT_REVIEW_REQUIRED','请取得本申请当前有效授权和人工核验后重新出具方案');
  const multiplier = multipliers[s.verification.band];
  ensure(multiplier !== undefined,409,'CREDIT_MANUAL_REVIEW','该档位须人工联系处理，不可生成正式方案');
  return {verification:s.verification,multiplier};
}
async function touch(tx:any,app:any) {
  return tx.application.update({where:{id:app.id},data:{creditRevision:{increment:1},...(app.status==='AWAITING_CONFIRMATION'?{status:'IN_REVIEW',revision:{increment:1}}:{})}});
}
async function view(tx:any,app:any,admin=false,actorRole?:string) {
  const s=await state(tx,app), open=editable.includes(app.status);
  let consentRequirementsMet=true;
  try { await requireCurrentConsents(tx,app.customerId,['terms','privacy']); } catch(error:any) { const code=error?.getResponse?.()?.error?.code; if(!['CONSENT_REQUIRED','LEGAL_UNAVAILABLE'].includes(code))throw error;consentRequirementsMet=false; }
  const multiplier=s.verified ? multipliers[s.verification.band] ?? null : null;
  return {applicationId:app.id,creditRevision:app.creditRevision,ruleVersion:CREDIT_RULE,...(admin&&actorRole==='ADMIN'&&acceptancePricingOffer(app)?{acceptancePricing:acceptancePricingOffer(app)}:{}),
    document:s.document?{id:s.document.id,type:s.document.type,version:s.document.version,title:s.document.title,content:s.document.content}:null,
    consent:s.consent?{id:s.consent.id,status:s.consent.status,documentId:s.consent.documentId,version:s.consent.version,acceptedAt:s.consent.acceptedAt,withdrawnAt:s.consent.withdrawnAt}:null,
    verification:s.verification?{id:s.verification.id,band:s.verification.band,verifiedBy:s.verification.verifiedBy,verifiedAt:s.verification.verifiedAt,consentId:s.verification.consentId}:null,
    status:!open?'HISTORICAL':s.verified?(multiplier===null?'MANUAL_REVIEW':'VERIFIED'):s.consent?.status==='DECLINED'?'MANUAL_REVIEW':s.consentValid?'AWAITING_VERIFICATION':'CONSENT_REQUIRED',
    canConsent:open&&!!s.document&&consentRequirementsMet,canDecline:open&&!!s.document,consentRequirementsMet,
    canWithdraw:s.consent?.status==='ACCEPTED',canVerify:admin&&open&&s.consentValid&&consentRequirementsMet,verificationCurrent:s.verified,
    canConfirmFinalPlan:app.status==='AWAITING_CONFIRMATION'&&s.verified&&multiplier!==null&&consentRequirementsMet,
    canFinalize:admin&&['IN_REVIEW','AWAITING_CONFIRMATION'].includes(app.status)&&s.verified&&multiplier!==null&&consentRequirementsMet,depositMultiplier:multiplier};
}
@Controller()
export class CreditReviewController {
  constructor(@Inject(Db) private db:Db) {}
  private async application(tx:any,id:string,customerId?:string) {const app=await tx.application.findFirst({where:{id,...(customerId?{customerId}:{})}});ensure(app,404,'NOT_FOUND','申请不存在');return app;}
  @Get('customer/applications/:id/credit-review') customer(@Param('id')id:string,@Req()r:any){return this.db.serial(async tx=>view(tx,await this.application(tx,id,r.customer.id)));}
  @Get('admin/applications/:id/credit-review') admin(@Param('id')id:string,@Req()r:any){ensure(['ADMIN','OPERATIONS'].includes(r.admin.role),403,'FORBIDDEN','当前角色无权读取信用核验资料');return this.db.serial(async tx=>view(tx,await this.application(tx,id),true,r.admin.role));}
  @Post('customer/applications/:id/credit-consent') consent(@Param('id')id:string,@Body()body:any,@Req()r:any){
    const input=z.object({documentId:text,version:z.number().int().positive(),decision:z.enum(['ACCEPT','DECLINE']),idempotencyKey:key}).strict().parse(body);
    return this.db.serial(async tx=>{
      const app=await this.application(tx,id,r.customer.id), requestHash=hash(input);
      const prior=await tx.creditConsent.findUnique({where:{applicationId_idempotencyKey:{applicationId:id,idempotencyKey:input.idempotencyKey}}});
      if(prior){ensure(prior.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','授权请求编号与内容冲突');return view(tx,app);}
      ensure(editable.includes(app.status),409,'STATE_CONFLICT','该申请已结束，不可新增核验授权');
      const doc=await currentDocument(tx);ensure(doc&&doc.id===input.documentId&&doc.version===input.version,409,'CONSENT_VERSION','请阅读当前版本人工核验说明');
      if(input.decision==='ACCEPT')await requireCurrentConsents(tx,app.customerId,['terms','privacy']);
      const updated=await touch(tx,app);
      const consent=await tx.creditConsent.create({data:{applicationId:id,customerId:r.customer.id,documentId:doc.id,version:doc.version,status:input.decision==='ACCEPT'?'ACCEPTED':'DECLINED',acceptedAt:input.decision==='ACCEPT'?new Date():null,revision:updated.creditRevision,idempotencyKey:input.idempotencyKey,requestHash}});
      await audit(tx,r.customer.id,input.decision==='ACCEPT'?'CREDIT_CONSENT':'CREDIT_DECLINED','applications',id,{consentId:consent.id,documentId:doc.id,version:doc.version},'CUSTOMER');return view(tx,updated);
    });
  }
  @Post('customer/applications/:id/credit-consent/withdraw') withdraw(@Param('id')id:string,@Body()body:any,@Req()r:any){
    const input=z.object({consentId:text,idempotencyKey:key}).strict().parse(body);
    return this.db.serial(async tx=>{
      const app=await this.application(tx,id,r.customer.id),s=await state(tx,app);
      const consent=await tx.creditConsent.findFirst({where:{id:input.consentId,applicationId:id,customerId:r.customer.id}});
      ensure(consent,404,'NOT_FOUND','本申请授权不存在');
      if(consent.status==='WITHDRAWN'){ensure(consent.withdrawalKey===input.idempotencyKey,409,'IDEMPOTENCY_CONFLICT','该授权已撤回，请刷新');return view(tx,app);}
      ensure(consent.id===s.consent?.id&&consent.status==='ACCEPTED',409,'CONSENT_VERSION','授权状态已改变，请刷新');
      await tx.creditConsent.update({where:{id:consent.id},data:{status:'WITHDRAWN',withdrawnAt:new Date(),withdrawalKey:input.idempotencyKey}});
      const updated=await touch(tx,app);await audit(tx,r.customer.id,'CREDIT_WITHDRAWN','applications',id,{consentId:consent.id},'CUSTOMER');return view(tx,updated);
    });
  }
  @Post('admin/applications/:id/credit-verifications') verify(@Param('id')id:string,@Body()body:any,@Req()r:any){
    const input=z.object({consentId:text,creditRevision:z.number().int().nonnegative(),band:z.enum(['GE750','B700_749','B650_699','LT650','UNVERIFIABLE']),customerPresented:z.literal(true),idempotencyKey:key}).strict().parse(body);
    return this.db.serial(async tx=>{
      const app=await this.application(tx,id),requestHash=hash(input);
      const prior=await tx.creditVerification.findUnique({where:{applicationId_idempotencyKey:{applicationId:id,idempotencyKey:input.idempotencyKey}}});
      if(prior){ensure(prior.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','核验请求编号与内容冲突');return view(tx,app,true);}
      ensure(editable.includes(app.status),409,'STATE_CONFLICT','申请已结束，不可新增核验');
      const s=await state(tx,app);ensure(s.consentValid&&s.consent.id===input.consentId&&app.creditRevision===input.creditRevision,409,'CREDIT_CONSENT_REQUIRED','本申请授权或核验版本已改变，请刷新');
      await requireCurrentConsents(tx,app.customerId,['terms','privacy']);
      const updated=await touch(tx,app);
      const record=await tx.creditVerification.create({data:{applicationId:id,consentId:input.consentId,band:input.band,revision:updated.creditRevision,ruleVersion:CREDIT_RULE,verifiedBy:r.admin.id,idempotencyKey:input.idempotencyKey,requestHash}});
      await audit(tx,r.admin.id,'CREDIT_VERIFIED','applications',id,{verificationId:record.id,consentId:input.consentId,band:input.band,ruleVersion:CREDIT_RULE});return view(tx,updated,true);
    });
  }
}
