import {ownerInvitationToken,ownerLegalLoginEligibility,claimEligibleOwnerInvitation} from './legal-representative';
import {legalLoginScopes,legalSessionView,loginScopeDigest} from './legal-session';
import {Body,Controller,Get,Inject,Post,Req,Res} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {IdentityGateway} from '../common/gateways';
import {audit,mobile,hash} from '../common/data';
import {ensure} from '../common/errors';
import {consentInput,currentDocuments} from '../auth/consents';
import {token,tokenHash} from '../auth/auth.service';
import {OWNER_H5_COOKIE,OWNER_H5_COOKIE_OPTIONS,ownerH5Config} from './config';
import {portalMobileHash} from '../partners/portal-access';
import {portalSessionDto,validPortalGrants} from '../partners/portal-session';
import {CompanyAdminService} from '../partners/company-admin';
const empty=z.object({}).strict(),smsInput=z.object({mobile,purpose:z.enum(['ELECTRONIC_LEGAL','ENTERPRISE_CENTER']).optional(),invitationToken:ownerInvitationToken.optional()}).strict();
const loginInput=z.object({mobile,purpose:z.enum(['ELECTRONIC_LEGAL','ENTERPRISE_CENTER']).optional(),invitationToken:ownerInvitationToken.optional(),challengeId:z.string().regex(/^[a-f0-9]{64}$/),code:z.string().regex(/^\d{6}$/),consents:consentInput}).strict();
const lifetime=300,resendAfterSeconds=60;
function unavailable(value:unknown):asserts value{ensure(value,401,'LOGIN_UNAVAILABLE','无法登录，请核对手机号及验证码或联系运营');}
export async function enabledPortalScopes(tx:any,mobileHash:string){
 const rows=await tx.partnerPortalAccess.findMany({where:{mobileHash,status:'ENABLED'},orderBy:{ownerId:'asc'}});
 return (await validPortalGrants(tx,rows)).map((row:any)=>({accessId:row.id,ownerId:row.ownerId,accessVersion:row.accessVersion}));
}
@Controller()
export class OwnerH5AuthController{
 constructor(@Inject(Db)private db:Db,@Inject(IdentityGateway)private identity:IdentityGateway){}
 @Get('owner-h5/config')config(){return ownerH5Config();}
 @Post('owner-h5/auth/invitation/preview')invitationPreview(@Body()raw:unknown,@Req()request:any){return new CompanyAdminService(this.db).preview(raw,request.ip,async(input)=>{
   const scopes=await this.resolve(this.db,input.mobile,'ENTERPRISE_CENTER',input.invitationCode);
   if(scopes.mode!=='ELECTRONIC_LEGAL'||!scopes.scopes.length)return null;
   const eligible=await ownerLegalLoginEligibility(this.db,input.mobile,input.invitationCode);
   if(!eligible?.invite)return null;
   return{mode:'ELECTRONIC_LEGAL',previewToken:token(),companyName:eligible.invite.owner.name,ownerId:eligible.invite.ownerId,maskedMobile:eligible.invite.owner.legalRepresentative!.maskedMobile,expiresAt:eligible.invite.expiresAt};
  });}
 private async resolve(tx:any,mobile:string,purpose?:'ELECTRONIC_LEGAL'|'ENTERPRISE_CENTER',invitationToken?:string){
  if(purpose==='ELECTRONIC_LEGAL')return{mode:'ELECTRONIC_LEGAL',scopes:await legalLoginScopes(tx,mobile,invitationToken)};
  if(purpose==='ENTERPRISE_CENTER'){
   let scopes:any[]=[];try{scopes=await legalLoginScopes(tx,mobile,invitationToken);}catch(e:any){if(e.getResponse?.().error?.code!=='LEGAL_ENTRY_DISABLED')throw e;}
   if(scopes.length||invitationToken!==undefined)return{mode:'ELECTRONIC_LEGAL',scopes};
  }
  return{mode:'PARTNER_READONLY',scopes:await enabledPortalScopes(tx,portalMobileHash(mobile))};
 }
 @Post('owner-h5/auth/invitation/confirm')async invitationConfirm(@Body()raw:unknown,@Req()request:any,@Res({passthrough:true})response:any){
  const result=await new CompanyAdminService(this.db).confirm(raw,request.cookies?.[OWNER_H5_COOKIE]);
  response.cookie(OWNER_H5_COOKIE,result.rawToken,{...OWNER_H5_COOKIE_OPTIONS,expires:result.session.expiresAt});return portalSessionDto(this.db,result.session);
 }
 @Get('owner-h5/legal-signing')async legalSigning(){
  const required=await currentDocuments(this.db,['terms','privacy']),optional=await Promise.all(['owner-identity','owner-auto-sign'].map(type=>this.db.legalDocument.findFirst({where:{type,status:'PUBLISHED',confirmedBy:{not:null},confirmedAt:{not:null}},orderBy:{version:'desc'}})));
  const documents=[...required,...optional.filter((d):d is NonNullable<typeof d>=>!!d)];return{documents:documents.map(({id,type,version,title,content})=>({id,type,version,title,content,contentHash:hash(content)})),missingTypes:['owner-identity','owner-auto-sign'].filter(type=>!documents.some(d=>d.type===type))};
 }
 @Get('owner-h5/legal')async legal(){
  const documents=await currentDocuments(this.db,['terms','privacy']);
  return{documents:documents.map(({id,type,version,title,content})=>({id,type,version,title,content,contentHash:hash(content)}))};
 }
 @Post('owner-h5/auth/sms/request')async sms(@Body()raw:unknown){
  const input=smsInput.parse(raw),mobileHash=portalMobileHash(input.mobile),challengeId=token(),now=new Date(),db=this.db as any;
  const challenge=await this.db.serial(async(tx:any)=>{
   // Shared phone lock covers grant-independent local request throttling; no plaintext key.
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${mobileHash}))`;
   const previous=await tx.partnerPortalChallenge.findFirst({where:{mobileHash},orderBy:{createdAt:'desc'}}),daily=await tx.partnerPortalChallenge.count({where:{mobileHash,createdAt:{gt:new Date(Date.now()-86400000)}}});
   const {scopes,mode}=await this.resolve(tx,input.mobile,input.purpose,input.invitationToken),limited=previous&&now.getTime()-previous.createdAt.getTime()<resendAfterSeconds*1000||daily>=10;
   return tx.partnerPortalChallenge.create({data:{id:challengeId,mobileHash,maskedMobile:input.mobile.slice(0,3)+'****'+input.mobile.slice(-4),scopeSnapshot:scopes,scopeDigest:loginScopeDigest(scopes,input.purpose,input.invitationToken,mode),expiresAt:new Date(now.getTime()+lifetime*1000),status:limited?'RATE_LIMITED':scopes.length?'SENDING':'DECOY'}});
  });
  ensure(challenge.status!=='RATE_LIMITED',429,'SMS_RATE_LIMITED','暂未发送验证码，请稍后再试，或联系运营核对登记信息');
  ensure(challenge.status!=='DECOY',403,'SMS_NOT_SENT','暂未发送验证码。首次使用请先凭邀请码绑定公司，或联系运营核对登记信息');
  let pending:any=null;
  if(challenge.status==='SENDING'){
   try{
    // Exact channel challenge is mandatory; mobile-only latest-code verification is unsafe.
    const gateway=this.identity as any;ensure(typeof gateway.requestSmsChallenge==='function'&&typeof gateway.verifySmsChallenge==='function',503,'SMS_UNAVAILABLE','短信通道暂不可用');
    const sent=await gateway.requestSmsChallenge(input.mobile);ensure(typeof sent?.challengeId==='string'&&sent.challengeId.length,503,'SMS_UNAVAILABLE','短信通道暂不可用');
    pending=await db.partnerPortalChallenge.update({where:{id:challengeId},data:{smsChallengeId:sent.challengeId,status:'PENDING'}});
    ensure(pending.id===challengeId&&pending.smsChallengeId===sent.challengeId&&pending.status==='PENDING',503,'SMS_UNAVAILABLE','短信通道暂不可用');
   }catch{
    pending=null;
    await db.partnerPortalChallenge.update({where:{id:challengeId},data:{status:'FAILED'}});
    await audit(db,'ANONYMOUS','PARTNER_PORTAL_SMS_FAILED','partner-portal',challengeId,{},'SYSTEM');
   }
  }
  ensure(pending?.status==='PENDING'&&!!pending.smsChallengeId,503,'SMS_UNAVAILABLE','验证码暂未发送，短信通道暂不可用，请稍后重试或联系运营');
  return{accepted:true,challengeId,expiresInSeconds:lifetime,resendAfterSeconds};
 }
 @Post('owner-h5/auth/login')async login(@Body()raw:unknown,@Req()request:any,@Res({passthrough:true})response:any){
  const input=loginInput.parse(raw),mobileHash=portalMobileHash(input.mobile),db=this.db as any;
  const documents=await currentDocuments(db,['terms','privacy']);
  for(const doc of documents)ensure(input.consents.some(c=>c.documentId===doc.id&&c.version===doc.version),409,'CONSENT_VERSION','请阅读并同意当前用户协议及隐私政策');
  // Claim an attempt in its own committed transaction. Provider failures must not roll it back.
  const challenge=await this.db.serial(async(tx:any)=>{
   await tx.$queryRaw`SELECT id FROM "PartnerPortalChallenge" WHERE id = ${input.challengeId} FOR UPDATE`;
   const row=await tx.partnerPortalChallenge.findUnique({where:{id:input.challengeId}});
   if(!row||row.mobileHash!==mobileHash||row.status!=='PENDING'||row.consumedAt||row.expiresAt<=new Date()||row.attempts>=5||!row.smsChallengeId)return null;
   await tx.partnerPortalChallenge.update({where:{id:row.id},data:{status:'VERIFYING',attempts:{increment:1}}});return row;
  });
  unavailable(challenge);
  let verified:any;
  try{const gateway=this.identity as any;unavailable(typeof gateway.verifySmsChallenge==='function');verified=await gateway.verifySmsChallenge({challengeId:challenge.smsChallengeId,mobile:input.mobile,code:input.code});unavailable(verified.mobile===input.mobile);}
  catch{
   await db.partnerPortalChallenge.updateMany({where:{id:challenge.id,status:'VERIFYING'},data:{status:challenge.attempts+1>=5?'FAILED':'PENDING'}});unavailable(false);
  }
  const rawToken=token(),csrfToken=token(),expiresAt=new Date(Date.now()+8*3600000);
  const result=await this.db.serial(async(tx:any)=>{
   await tx.$queryRaw`SELECT id FROM "PartnerPortalChallenge" WHERE id = ${challenge.id} FOR UPDATE`;
   const current=await tx.partnerPortalChallenge.findUnique({where:{id:challenge.id}}),{scopes,mode}=await this.resolve(tx,input.mobile,input.purpose,input.invitationToken);
   const valid=current?.status==='VERIFYING'&&!current.consumedAt&&current.expiresAt>new Date()&&current.mobileHash===mobileHash&&current.scopeDigest===loginScopeDigest(scopes,input.purpose,input.invitationToken,mode)&&scopes.length>0;
   if(!valid){await tx.partnerPortalChallenge.updateMany({where:{id:challenge.id,status:'VERIFYING'},data:{status:'REJECTED',consumedAt:new Date()}});return null;}
   const docs=await currentDocuments(tx,['terms','privacy']);
   if(!docs.every(doc=>input.consents.some(c=>c.documentId===doc.id&&c.version===doc.version))){await tx.partnerPortalChallenge.update({where:{id:challenge.id},data:{status:'REJECTED',consumedAt:new Date()}});return null;}
   await tx.partnerPortalChallenge.update({where:{id:challenge.id},data:{status:'CONSUMED',consumedAt:new Date()}});
   const old=request.cookies?.[OWNER_H5_COOKIE];if(typeof old==='string'){await tx.partnerPortalSession.deleteMany({where:{id:tokenHash(old)}});await tx.ownerH5Session.deleteMany({where:{id:tokenHash(old)}});}
   if(mode==='ELECTRONIC_LEGAL'){
    const eligible=await ownerLegalLoginEligibility(tx,input.mobile,input.invitationToken);unavailable(eligible);
    const customer=eligible.customer??(eligible.invite?await tx.customer.create({data:{mobile:input.mobile}}):null);unavailable(customer);
    if(eligible.invite)await claimEligibleOwnerInvitation(tx,customer.id,eligible.invite);
    if(typeof old==='string')await tx.ownerH5Session.deleteMany({where:{id:tokenHash(old)}});
    const session=await tx.ownerH5Session.create({data:{id:tokenHash(rawToken),customerId:customer.id,csrfToken,expiresAt,identitySnapshot:{mode:'ELECTRONIC_LEGAL',owners:scopes}}});
    await audit(tx,customer.id,'OWNER_LEGAL_LOGIN','owner-h5',session.id,{owners:scopes},'CUSTOMER');return session;
   }
   const session=await tx.partnerPortalSession.create({data:{id:tokenHash(rawToken),mode:'PARTNER_READONLY',mobileHash,maskedMobile:challenge.maskedMobile,scopeSnapshot:scopes,csrfToken,expiresAt,consentSnapshot:docs.map(doc=>({documentId:doc.id,type:doc.type,version:doc.version,acceptedAt:new Date().toISOString(),source:'PARTNER_PORTAL_LOGIN'}))}});
   await tx.partnerPortalAccess.updateMany({where:{id:{in:scopes.map((s:any)=>s.accessId)}},data:{lastLoginAt:new Date()}});
   await audit(tx,session.id,'PARTNER_PORTAL_LOGIN','partner-portal',session.id,{scopes},'PARTNER_PORTAL');return session;
  });
  unavailable(result);response.cookie(OWNER_H5_COOKIE,rawToken,{...OWNER_H5_COOKIE_OPTIONS,expires:expiresAt});return (result as any).identitySnapshot?.mode==='ELECTRONIC_LEGAL'?legalSessionView(db,result):portalSessionDto(db,result);
 }
 @Get('owner-h5/auth/me')me(@Req()request:any){return request.ownerH5Session?legalSessionView(this.db,request.ownerH5Session):portalSessionDto(this.db,request.partnerPortalSession);}
 @Post('owner-h5/auth/logout')async logout(@Body()body:unknown,@Req()request:any,@Res({passthrough:true})response:any){
  empty.parse(body);if(request.ownerH5Session)await this.db.ownerH5Session.deleteMany({where:{id:request.ownerH5Session.id}});else await (this.db as any).partnerPortalSession.deleteMany({where:{id:request.partnerPortalSession.id}});response.clearCookie(OWNER_H5_COOKIE,OWNER_H5_COOKIE_OPTIONS);return{success:true};
 }
}
