import {assertMaterialsCurrent,materialsChanged,identityMaterials,frozenMaterials} from './identity-materials';
import {ownerVerificationDisplay} from '../owner-h5/verification-display';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Prisma} from '@prisma/client';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,hash} from '../common/data';
import {acceptConsents,consentInput,currentDocuments} from '../auth/consents';
import {FadadaSettings} from '../esign/esign.settings';
import {decryptIdentity,encryptIdentity,verifiedCallback} from '../esign/fadada/fadada-safety';
import {FadadaOwnerClient,ownerLegalPolicy,runOwnerH5} from './fadada-owner.client';
import {OwnerService} from './owner.service';
import {requireOwnerLegalRepresentative} from '../owner-h5/legal-representative';
import {assertNewEsignAllowed,runBoundElectronicOperation} from '../offline-documents/mode';
import {requireVirtualEnterpriseOrDefault} from '../virtual-acceptance/actors';
import {CustomerESignOnboardingService} from '../esign/customer-esign-onboarding.service';
import {NativeAwareFadadaClient,NativeAwareFadadaHttp} from '../esign/native-fadada-adapter';
import {bindIndividualOwnerIdentity} from '../electronic-documents/identities';
import {ownerH5ReturnUrl} from '../common/platform-origins';

const startInput=z.object({accepted:z.literal(true),consents:consentInput}).strict();
const personalInput=z.object({accepted:z.literal(true),consents:consentInput,identity:z.object({name:z.string().trim().min(2).max(50),idCardNo:z.string().regex(/^\d{17}[\dXx]$/)}).strict().optional()}).strict();
export class OwnerIdentityService {
 private personal:CustomerESignOnboardingService;
 constructor(private db:Db,private owners:OwnerService,private config:FadadaSettings,private api:FadadaOwnerClient,personal?:CustomerESignOnboardingService){this.personal=personal??new CustomerESignOnboardingService(db,config,new NativeAwareFadadaClient(config,new NativeAwareFadadaHttp(config)));}
 private enabled(){ensure(process.env.OWNER_ONBOARDING_ENABLED==='true'&&this.config.enabled&&this.config.accountRegisterEnabled&&this.config.realNameVerifyEnabled,503,'OWNER_ONBOARDING_DISABLED','企业车主实名认证入口尚未开放');}
 private available(){ensure(this.config.enabled,503,'FADADA_DISABLED','历史企业电子实名渠道未配置，无法核验原交易');}
 private enterpriseCreditCode(owner:{subjectType:string;creditCode:string|null}){const creditCode=owner.creditCode;ensure(owner.subjectType==='ENTERPRISE'&&typeof creditCode==='string'&&creditCode.trim().length>0,409,'OWNER_ENTERPRISE_REQUIRED','企业电子实名及签章仅适用于已登记统一社会信用代码的企业合作商');return creditCode;}
 private encrypt(value:unknown,ownerId:string,purpose:string){return encryptIdentity(value,'owner:'+ownerId+':'+purpose,this.config.identityEncryptionKey);}
 private decrypt(value:string,ownerId:string,purpose:string){return decryptIdentity(value,'owner:'+ownerId+':'+purpose,this.config.identityEncryptionKey);}
 private async legalAccount(ownerId:string){const account=await this.db.ownerESignAccount.findUnique({where:{ownerId},select:{consentSnapshot:true}});return(account?.consentSnapshot as any)?.channel==='OWNER_LEGAL_H5'||!!(account?.consentSnapshot as any)?.materials;}
 async start(customerId:string,ownerId:string,raw:unknown){
  assertNewEsignAllowed();
  if((await this.db.vehicleOwner.findUnique({where:{id:ownerId}}))?.subjectType==='INDIVIDUAL')return this.startIndividual(customerId,ownerId,raw);
  if(ownerLegalPolicy()||await this.legalAccount(ownerId))return this.startLegal(customerId,ownerId,raw);
  this.enabled();const input=startInput.parse(raw);this.enterpriseCreditCode((await this.owners.member(customerId,ownerId)).owner);
  const account=await this.db.serial(async tx=>{
   ensure(!await this.owners.usesLegalPolicy(ownerId,tx),409,'OWNER_H5_REQUIRED','企业已转入法人中心，请由法人本人重新办理');
   const member=await tx.ownerMember.findUnique({where:{ownerId_customerId:{ownerId,customerId}},include:{owner:true}});
   ensure(member&&member.status!=='SUSPENDED'&&member.owner.status!=='SUSPENDED',404,'NOT_FOUND','企业成员不可用');
   this.enterpriseCreditCode(member.owner);
   const old=await tx.ownerESignAccount.findUnique({where:{ownerId}});
   ensure(!old?.leaseUntil||old.leaseUntil<=new Date(),409,'OWNER_PROCESSING','企业认证正在处理中，请稍后再试');
   ensure(!old?.managerCustomerId||old.managerCustomerId===customerId,409,'OWNER_MANAGER_BOUND','当前企业认证已绑定其他经办人，请联系运营核对');
   await acceptConsents(tx,customerId,input.consents,['terms','privacy','owner-identity'],'OWNER_IDENTITY');
   const docs=await currentDocuments(tx,['terms','privacy','owner-identity']);
   const consentSnapshot={ownerId,name:member.owner.name,creditCode:member.owner.creditCode,customerId,documents:docs.map(d=>({id:d.id,type:d.type,version:d.version,hash:hash(d.content)}))};
   return tx.ownerESignAccount.upsert({where:{ownerId},create:{ownerId,managerCustomerId:customerId,consentSnapshot,consentedAt:new Date()},update:{consentSnapshot,consentedAt:new Date(),managerCustomerId:customerId}});
  });
  if(account.verificationTransactionNo&&account.verificationUrlCiphertext)return{url:this.decrypt(account.verificationUrlCiphertext,ownerId,'url').url,status:account.realNameStatus};
  ensure(!['VERIFY_STARTING','VERIFY_UNKNOWN'].includes(account.realNameStatus),409,'OWNER_VERIFY_UNKNOWN','企业认证请求结果尚待核对，请联系运营；系统不会重复创建认证');
  const token=randomUUID();
  const claimed=await this.db.ownerESignAccount.updateMany({where:{id:account.id,updatedAt:account.updatedAt,consentSnapshot:{equals:account.consentSnapshot??Prisma.AnyNull},managerCustomerId:customerId,verificationTransactionNo:null,realNameStatus:account.realNameStatus,OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},data:{leaseToken:token,leaseUntil:new Date(Date.now()+120000)}});
  ensure(claimed.count===1,409,'OWNER_PROCESSING','企业认证准备中，请稍后读取状态');
  let started=false;
  try{
   const owner=await this.db.vehicleOwner.findUniqueOrThrow({where:{id:ownerId}});ensure(owner.status!=='SUSPENDED',409,'OWNER_SUSPENDED','企业已停用');const creditCode=this.enterpriseCreditCode(owner);
   let providerCustomerId=account.providerCustomerId;
   if(!providerCustomerId){const result=await this.api.registerEnterprise(createHash('sha256').update('miniapp-owner:'+ownerId).digest('hex').slice(0,32));providerCustomerId=result.customerId;
    const saved=await this.db.ownerESignAccount.updateMany({where:{id:account.id,leaseToken:token},data:{providerCustomerId}});ensure(saved.count===1,409,'OWNER_ATTEMPT_CHANGED','企业认证任务已变更');}
   // Persist intent before the non-idempotent provider call. An ambiguous response is never retried automatically.
   const intent=await this.db.ownerESignAccount.updateMany({where:{id:account.id,leaseToken:token,leaseUntil:{gt:new Date()}},data:{realNameStatus:'VERIFY_STARTING'}});ensure(intent.count===1,409,'OWNER_ATTEMPT_CHANGED','企业认证任务已变更');started=true;
   const result=await this.api.createVerification({customerId:providerCustomerId,name:owner.name,creditCode});
   await this.db.serial(async tx=>{ensure(!await this.owners.usesLegalPolicy(ownerId,tx),409,'OWNER_H5_REQUIRED','企业已转入法人中心，请由法人本人重新办理');const changed=await tx.ownerESignAccount.updateMany({where:{id:account.id,leaseToken:token,leaseUntil:{gt:new Date()},realNameStatus:'VERIFY_STARTING'},data:{verificationTransactionNo:result.serialNo,verificationUrlCiphertext:this.encrypt({url:result.url},ownerId,'url'),realNameStatus:'PENDING',leaseToken:null,leaseUntil:null}});ensure(changed.count===1,409,'OWNER_ATTEMPT_CHANGED','企业认证任务已变更');await audit(tx,customerId,'OWNER_VERIFICATION_STARTED','vehicle-owners',ownerId,{},'CUSTOMER');});
   return{url:result.url,status:'PENDING'};
  }catch(error){if(started)await this.db.ownerESignAccount.updateMany({where:{id:account.id,leaseToken:token},data:{realNameStatus:'VERIFY_UNKNOWN'}});throw error;}
  finally{await this.db.ownerESignAccount.updateMany({where:{id:account.id,leaseToken:token},data:{leaseToken:null,leaseUntil:null}});}
 }
 async refresh(customerId:string,ownerId:string,expectedTransactionNo?:string){
  if((await this.db.vehicleOwner.findUnique({where:{id:ownerId}}))?.subjectType==='INDIVIDUAL')return this.refreshIndividual(customerId,ownerId);
  if(ownerLegalPolicy()||await this.legalAccount(ownerId))return this.refreshLegal(customerId,ownerId,expectedTransactionNo);
  this.available();this.enterpriseCreditCode((await this.owners.member(customerId,ownerId)).owner);
  const account=await this.db.ownerESignAccount.findUnique({where:{ownerId}});
  ensure(expectedTransactionNo===undefined||account?.verificationTransactionNo===expectedTransactionNo,409,'OWNER_CALLBACK_CHANGED','回调对应的认证任务已被替换，不能查询或更新其他认证任务');
  ensure(!ownerLegalPolicy()&&(account?.consentSnapshot as any)?.channel!=='OWNER_LEGAL_H5',409,'OWNER_H5_REQUIRED','企业已转入法人中心，请由法人本人重新核验');
  ensure(account?.providerCustomerId&&account.verificationTransactionNo&&account.consentedAt,409,'OWNER_VERIFY_MISSING','请先由本人发起企业认证');
  ensure(account.managerCustomerId===customerId,403,'OWNER_MANAGER_BOUND','请由当前认证经办人核验');
  const token=randomUUID(),ownership={id:account.id,providerCustomerId:account.providerCustomerId,verificationTransactionNo:account.verificationTransactionNo,managerCustomerId:customerId};
  const claim=await this.db.ownerESignAccount.updateMany({where:{...ownership,updatedAt:account.updatedAt,consentSnapshot:{equals:account.consentSnapshot??Prisma.AnyNull},OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},data:{leaseToken:token,leaseUntil:new Date(Date.now()+120000)}});ensure(claim.count===1,409,'OWNER_PROCESSING','企业认证核验中，请稍后读取状态');
  try{
   const owner=await this.db.vehicleOwner.findUniqueOrThrow({where:{id:ownerId}}),customer=await this.db.customer.findUniqueOrThrow({where:{id:customerId}});
   const creditCode=this.enterpriseCreditCode(owner);
   const proof=await this.api.queryEnterprise({customerId:account.providerCustomerId,serialNo:account.verificationTransactionNo,name:owner.name,creditCode});
   ensure(!proof.verified||proof.manager?.mobile===customer.mobile,409,'OWNER_MANAGER_MISMATCH','认证经办人与当前登录手机号不一致，请联系运营核对');
   const cert=proof.verified?await this.api.queryCertificate(account.providerCustomerId):null;
   const seals=proof.verified&&cert?.bound?await this.api.querySeals(account.providerCustomerId):[];
   await this.db.serial(async tx=>{
    ensure(!await this.owners.usesLegalPolicy(ownerId,tx),409,'OWNER_H5_REQUIRED','企业已转入法人中心，请由法人本人重新核验');
    const member=await tx.ownerMember.findUnique({where:{ownerId_customerId:{ownerId,customerId}},include:{owner:true}});ensure(member&&member.status!=='SUSPENDED'&&member.owner.status!=='SUSPENDED',409,'OWNER_SUSPENDED','企业或经办人已停用');
    const now=new Date();const changed=await tx.ownerESignAccount.updateMany({where:{...ownership,leaseToken:token,leaseUntil:{gt:now}},data:{realNameStatus:proof.verified?'VERIFIED':'PENDING',certStatus:cert?.bound?'BOUND':'UNKNOWN',certSerialNo:cert?.serialNo||null,certValidFrom:cert?.validFrom?new Date(cert.validFrom):null,certValidUntil:cert?.validUntil?new Date(cert.validUntil):null,certEvidenceHash:cert?.evidenceHash||null,certSubjectHash:cert?.subjectHash||null,certCheckedAt:cert?.bound?now:null,managerCiphertext:proof.manager?this.encrypt(proof.manager,ownerId,'manager'):null,verifiedAt:proof.verified?account.verifiedAt||now:null,checkedAt:now,evidenceHash:hash({proof,cert,seals:seals.map(s=>s.imageHash)}),leaseToken:null,leaseUntil:null}});ensure(changed.count===1,409,'OWNER_ATTEMPT_CHANGED','企业认证任务已变更');
    await tx.ownerMember.update({where:{id:member.id},data:{status:proof.verified?'VERIFIED':'CLAIMED',verifiedAt:proof.verified?now:null,verifiedSerialNo:proof.verified?account.verificationTransactionNo:null}});
    await tx.vehicleOwner.update({where:{id:ownerId},data:{status:proof.verified?'VERIFIED':'DRAFT'}});
    await tx.ownerSeal.updateMany({where:{ownerId,providerSignatureId:{notIn:seals.map(s=>s.signatureId)}},data:{status:'UNAVAILABLE'}});
    for(const seal of seals){const existing=await tx.ownerSeal.findUnique({where:{providerCustomerId_providerSignatureId:{providerCustomerId:seal.customerId,providerSignatureId:seal.signatureId}}});ensure(!existing||existing.ownerId===ownerId,409,'OWNER_SEAL_BINDING','印章归属不一致');
     const data={imageCiphertext:this.encrypt({imageBase64:seal.imageBase64,imageType:seal.imageType},ownerId,'seal:'+seal.signatureId),imageHash:seal.imageHash,checkedAt:now};
     await tx.ownerSeal.upsert({where:{providerCustomerId_providerSignatureId:{providerCustomerId:seal.customerId,providerSignatureId:seal.signatureId}},create:{ownerId,providerCustomerId:seal.customerId,providerSignatureId:seal.signatureId,...data},update:{...data,status:existing?.status==='ACTIVE'&&existing.imageHash===seal.imageHash?'ACTIVE':'DISCOVERED'}});
    }
    await audit(tx,customerId,'OWNER_VERIFICATION_QUERIED','vehicle-owners',ownerId,{verified:proof.verified,certBound:!!cert?.bound,seals:seals.length},'CUSTOMER');
   });
   return this.owners.memberDetail(customerId,ownerId);
  }catch(error){
   // A failed or contradictory query must not leave yesterday's certificate usable.
   await this.db.ownerESignAccount.updateMany({where:{...ownership,leaseToken:token},data:{certStatus:'UNKNOWN',certSerialNo:null,checkedAt:null}});throw error;
  }finally{await this.db.ownerESignAccount.updateMany({where:{...ownership,leaseToken:token},data:{leaseToken:null,leaseUntil:null}});}
 }
 async startLegal(customerId:string,ownerId:string,raw:unknown){
  const scoped=await requireVirtualEnterpriseOrDefault(this.db,customerId,ownerId);
  if((await this.db.vehicleOwner.findUnique({where:{id:ownerId}}))?.subjectType==='INDIVIDUAL')return this.startIndividual(customerId,ownerId,raw);
  const operation=()=>runOwnerH5(()=>this.legalVerification(customerId,ownerId,startInput.parse(raw)));
  return scoped?runBoundElectronicOperation(async()=>{await requireVirtualEnterpriseOrDefault(this.db,customerId,ownerId);},operation):operation();
 }
 async refreshLegal(customerId:string,ownerId:string,expectedTransactionNo?:string){
  if((await this.db.vehicleOwner.findUnique({where:{id:ownerId}}))?.subjectType==='INDIVIDUAL')return this.refreshIndividual(customerId,ownerId);
  await runOwnerH5(()=>this.legalVerification(customerId,ownerId,undefined,expectedTransactionNo));
  return this.owners.memberDetail(customerId,ownerId);
 }
 async startIndividual(customerId:string,ownerId:string,raw:unknown){
  assertNewEsignAllowed();this.enabled();const input=personalInput.parse(raw);
  const context=await this.db.serial(async tx=>{
   const c=await requireOwnerLegalRepresentative(tx,customerId,ownerId);
   ensure(c.owner.subjectType==='INDIVIDUAL'&&c.owner.name===c.profile.name&&(!input.identity||input.identity.name===c.owner.name)&&(!c.customer.name||c.customer.name===c.owner.name),409,'ELECTRONIC_OWNER_IDENTITY_REQUIRED','请使用登记自然人本人身份办理');
   await acceptConsents(tx,customerId,input.consents,['terms','privacy','owner-identity'],'OWNER_PERSONAL_H5_IDENTITY');
   if(!c.customer.name&&input.identity)await tx.customer.update({where:{id:customerId},data:{name:input.identity.name}});
   return c;
  });
  await this.personal.register(customerId);
  const account=await this.db.eSignAccount.findUnique({where:{customerId}});
  if(account?.realNameStatus==='VERIFIED')return this.refreshIndividual(customerId,ownerId);
  ensure(input.identity,400,'IDENTITY_INPUT','请填写本人姓名和身份证号');
  ensure(context.owner.name===input.identity.name,409,'ELECTRONIC_OWNER_IDENTITY_REQUIRED','实名姓名与合作商不一致');
  return this.personal.verify(customerId,input.identity,ownerH5ReturnUrl());
 }
 async refreshIndividual(customerId:string,ownerId:string){
  await requireOwnerLegalRepresentative(this.db,customerId,ownerId);await this.personal.refresh(customerId);
  return this.db.serial(tx=>bindIndividualOwnerIdentity(tx,customerId,ownerId));
 }
 private async legalVerification(customerId:string,ownerId:string,input?:z.infer<typeof startInput>,expectedTransactionNo?:string){
  if(input)this.enabled();else this.available();const token=randomUUID();
  const attempt=await this.db.serial(async tx=>{
   const context=await requireOwnerLegalRepresentative(tx,customerId,ownerId),creditCode=this.enterpriseCreditCode(context.owner),old=await tx.ownerESignAccount.findUnique({where:{ownerId}});
   ensure(expectedTransactionNo===undefined||old?.verificationTransactionNo===expectedTransactionNo,409,'OWNER_CALLBACK_CHANGED','回调对应的认证任务已被替换，不能查询或更新其他认证任务');
   ensure(!old||old.verificationTransactionNo||!['VERIFY_STARTING','VERIFY_UNKNOWN'].includes(old.realNameStatus),409,'OWNER_VERIFY_UNKNOWN','企业认证请求结果尚待核对，系统不会重复创建认证');
   const reauth=materialsChanged(context.owner,context.profile,old,customerId);
   if(!input)assertMaterialsCurrent(context.owner,context.profile,old,customerId);
   ensure(!reauth||!old||!old.leaseToken&&!['PENDING','VERIFY_STARTING','VERIFY_UNKNOWN'].includes(old.realNameStatus),409,'OWNER_MATERIALS_BUSY','原认证任务尚未解决，请先完成或联系运营核对');
   ensure(!input||!ownerVerificationDisplay({...context.owner,esignAccount:old},context.member,customerId).identity.complete,409,'OWNER_IDENTITY_COMPLETED','当前企业与法人认证已完成，请查询更新证书与印章状态');
   ensure(!old?.leaseUntil||old.leaseUntil<=new Date(),409,'OWNER_PROCESSING','企业认证正在处理中，请稍后再试');
   ensure(!old||old.verificationTransactionNo||!['VERIFY_STARTING','VERIFY_UNKNOWN'].includes(old.realNameStatus),409,'OWNER_VERIFY_UNKNOWN','企业认证请求结果尚待核对，请联系运营；系统不会重复创建认证');
   let consent=old?.consentSnapshot as any;
   if(input){
    if(reauth){await tx.ownerMember.updateMany({where:{ownerId,status:'VERIFIED'},data:{status:'CLAIMED',verifiedAt:null,verifiedSerialNo:null}});await tx.ownerSeal.updateMany({where:{ownerId,status:'ACTIVE'},data:{status:'DISCOVERED',selectedBy:null,selectedAt:null}});await tx.ownerAutoAuthority.updateMany({where:{ownerId,enabled:true},data:{enabled:false,disabledAt:new Date(),revision:{increment:1}}});await tx.electronicAutoAuthority.updateMany({where:{ownerId,enabled:true},data:{enabled:false,revision:{increment:1}}});}
    if(reauth)await audit(tx,customerId,'OWNER_IDENTITY_REAUTH_STARTED','vehicle-owners',ownerId,{previousMaterials:consent?.materials||null,previousProof:{transactionNo:old?.verificationTransactionNo,providerCustomerId:old?.providerCustomerId,evidenceHash:old?.evidenceHash,consentSnapshot:consent||null}},'CUSTOMER');
    await acceptConsents(tx,customerId,input.consents,['terms','privacy','owner-identity'],'OWNER_LEGAL_H5_IDENTITY');
    const docs=await currentDocuments(tx,['terms','privacy','owner-identity']);
    consent={materials:{...frozenMaterials(context.owner,context.profile),status:'PENDING',...(consent?.materials?{previous:consent.materials.previous||consent.materials}:{})},channel:'OWNER_LEGAL_H5',ownerId,customerId,legalRevision:context.profile.revision,legalName:context.profile.name,legalMobileHash:context.profile.mobileHash,documents:docs.map(d=>({id:d.id,type:d.type,version:d.version,hash:hash(d.content)}))};
   }else ensure(old?.consentedAt&&consent?.channel==='OWNER_LEGAL_H5'&&consent.customerId===customerId&&consent.legalRevision===context.profile.revision&&consent.legalName===context.profile.name&&consent.legalMobileHash===context.profile.mobileHash,409,'OWNER_LEGAL_CONSENT_REQUIRED','请先点击“由法人本人办理认证”并同意当前企业认证说明');
   ensure(input||old?.providerCustomerId&&old.verificationTransactionNo,409,'OWNER_VERIFY_MISSING','请先由法人本人办理认证');
   const data={consentSnapshot:input?consent:{...consent,materials:consent?.materials||frozenMaterials(context.owner,context.profile,'LEGACY_MATCHING_REFRESH')},consentedAt:input?new Date():old!.consentedAt,leaseToken:token,leaseUntil:new Date(Date.now()+120000),...(reauth?{managerCustomerId:customerId,realNameStatus:'NOT_STARTED',verificationTransactionNo:null,verificationUrlCiphertext:null,verifiedAt:null,certStatus:'UNKNOWN',certSerialNo:null,checkedAt:null}:{})};
   let account;
   if(old){
    const changed=await tx.ownerESignAccount.updateMany({where:{id:old.id,updatedAt:old.updatedAt,OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},data});
    ensure(changed.count===1,409,'OWNER_ATTEMPT_CHANGED','企业认证任务已变更');account={...old,...data};
   }else account=await tx.ownerESignAccount.create({data:{ownerId,managerCustomerId:customerId,...data}});
   return{...context,account,creditCode,materialHash:identityMaterials(context.owner,context.profile).hash};
  });
  const {account,profile,owner,customer,creditCode,materialHash}=attempt;
  const ownership={id:account.id,providerCustomerId:account.providerCustomerId,verificationTransactionNo:account.verificationTransactionNo,managerCustomerId:account.managerCustomerId};
  let started=false;
  try{
   if(!account.verificationTransactionNo){
    ensure(input,409,'OWNER_VERIFY_MISSING','请先由法人本人办理认证');
    const intent=await this.db.ownerESignAccount.updateMany({where:{...ownership,leaseToken:token,leaseUntil:{gt:new Date()}},data:{realNameStatus:'VERIFY_STARTING'}});
    ensure(intent.count===1,409,'OWNER_ATTEMPT_CHANGED','企业认证任务已变更');started=true;
    let providerCustomerId=account.providerCustomerId;
    if(!providerCustomerId){
     const registered=await this.api.registerEnterprise(createHash('sha256').update('miniapp-owner:'+ownerId).digest('hex').slice(0,32));providerCustomerId=registered.customerId;
     const saved=await this.db.ownerESignAccount.updateMany({where:{id:account.id,leaseToken:token,leaseUntil:{gt:new Date()}},data:{providerCustomerId}});ensure(saved.count===1,409,'OWNER_ATTEMPT_CHANGED','企业认证任务已变更');
    }
    await this.assertLegalAttempt(customerId,ownerId,profile,owner.revision,this.db,materialHash);
    const result=await this.api.createVerification({customerId:providerCustomerId,name:owner.name,creditCode,channel:'owner-h5',legalRepresentative:{name:profile.name,mobile:customer.mobile}});
    await this.db.serial(async tx=>{
     await this.assertLegalAttempt(customerId,ownerId,profile,owner.revision,tx,materialHash);
     const changed=await tx.ownerESignAccount.updateMany({where:{id:account.id,leaseToken:token,leaseUntil:{gt:new Date()},realNameStatus:'VERIFY_STARTING'},data:{verificationTransactionNo:result.serialNo,verificationUrlCiphertext:this.encrypt({url:result.url,channel:'owner-h5',customerId,legalRevision:profile.revision,materialHash},ownerId,'url'),realNameStatus:'PENDING',leaseToken:null,leaseUntil:null}});
     ensure(changed.count===1,409,'OWNER_ATTEMPT_CHANGED','企业认证任务已变更');
     await audit(tx,customerId,'OWNER_LEGAL_VERIFICATION_STARTED','vehicle-owners',ownerId,{legalRevision:profile.revision},'CUSTOMER');
    });
    return{url:result.url,status:'PENDING'};
   }
   ensure(account.providerCustomerId,409,'OWNER_VERIFY_MISSING','企业认证账号未就绪，请联系运营核对');
   const proof=await this.api.queryEnterprise({customerId:account.providerCustomerId,serialNo:account.verificationTransactionNo,name:owner.name,creditCode});
   ensure(!proof.verified||proof.manager?.type==='1'&&proof.manager.name===profile.name&&proof.manager.mobile===customer.mobile,409,'OWNER_LEGAL_MISMATCH','法大大认证信息与当前法人姓名或手机号不一致，请联系运营核对');
   const cert=proof.verified?await this.api.queryCertificate(account.providerCustomerId):null,seals=proof.verified&&cert?.bound?await this.api.querySeals(account.providerCustomerId):[];
   const rebinding=account.managerCustomerId!==customerId;
   await this.db.serial(async tx=>{
    const current=await this.assertLegalAttempt(customerId,ownerId,profile,owner.revision,tx,materialHash),now=new Date();
    const changed=await tx.ownerESignAccount.updateMany({where:{...ownership,leaseToken:token,leaseUntil:{gt:now}},data:{consentSnapshot:{...(account.consentSnapshot as any),materials:{...((account.consentSnapshot as any)?.materials||frozenMaterials(owner,profile,'LEGACY_MATCHING_REFRESH')),status:proof.verified?'CURRENT':'PENDING'}},...(proof.verified?{managerCustomerId:customerId}:{}),realNameStatus:proof.verified?'VERIFIED':'PENDING',certStatus:cert?.bound?'BOUND':'UNKNOWN',certSerialNo:cert?.serialNo||null,certValidFrom:cert?.validFrom?new Date(cert.validFrom):null,certValidUntil:cert?.validUntil?new Date(cert.validUntil):null,certEvidenceHash:cert?.evidenceHash||null,certSubjectHash:cert?.subjectHash||null,certCheckedAt:cert?.bound?now:null,managerCiphertext:proof.manager?this.encrypt(proof.manager,ownerId,'manager'):null,verifiedAt:proof.verified?account.verifiedAt||now:null,checkedAt:now,evidenceHash:hash({proof,cert,seals:seals.map(s=>s.imageHash),legalRevision:profile.revision}),leaseToken:null,leaseUntil:null}});
    ensure(changed.count===1,409,'OWNER_ATTEMPT_CHANGED','企业认证任务已变更');
    const ownerChanged=await tx.vehicleOwner.updateMany({where:{id:ownerId,revision:current.owner.revision,status:{not:'SUSPENDED'}},data:{status:proof.verified?'VERIFIED':'DRAFT',revision:{increment:1}}});ensure(ownerChanged.count===1,409,'OWNER_LEGAL_CHANGED','企业资料已变化，请重新办理认证');
    await tx.ownerMember.update({where:{id:current.member.id},data:{status:proof.verified?'VERIFIED':'CLAIMED',verifiedAt:proof.verified?now:null,verifiedSerialNo:proof.verified?account.verificationTransactionNo:null}});
    if(proof.verified){
     await tx.ownerMember.updateMany({where:{ownerId,customerId:{not:customerId},status:{not:'SUSPENDED'}},data:{status:'SUSPENDED'}});
     await tx.ownerInvitation.updateMany({where:{ownerId,mobileHash:{not:profile.mobileHash},revokedAt:null},data:{revokedAt:now}});
     await tx.ownerAutoAuthority.updateMany({where:{ownerId,...(rebinding?{}:{requestedBy:{not:customerId}})},data:{enabled:false,disabledAt:now,revision:{increment:1}}});
    }
    await tx.ownerSeal.updateMany({where:{ownerId,providerSignatureId:{notIn:seals.map(s=>s.signatureId)}},data:{status:'UNAVAILABLE'}});
    for(const seal of seals){
     const existing=await tx.ownerSeal.findUnique({where:{providerCustomerId_providerSignatureId:{providerCustomerId:seal.customerId,providerSignatureId:seal.signatureId}}});ensure(!existing||existing.ownerId===ownerId,409,'OWNER_SEAL_BINDING','印章归属不一致');
     const data={imageCiphertext:this.encrypt({imageBase64:seal.imageBase64,imageType:seal.imageType},ownerId,'seal:'+seal.signatureId),imageHash:seal.imageHash,checkedAt:now};
     await tx.ownerSeal.upsert({where:{providerCustomerId_providerSignatureId:{providerCustomerId:seal.customerId,providerSignatureId:seal.signatureId}},create:{ownerId,providerCustomerId:seal.customerId,providerSignatureId:seal.signatureId,...data},update:{...data,status:!rebinding&&existing?.status==='ACTIVE'&&existing.selectedBy===customerId&&existing.imageHash===seal.imageHash?'ACTIVE':'DISCOVERED',...(rebinding?{selectedBy:null,selectedAt:null}:{})}});
    }
    await audit(tx,customerId,proof.verified&&rebinding?'OWNER_LEGAL_MANAGER_REBOUND':'OWNER_LEGAL_VERIFICATION_QUERIED','vehicle-owners',ownerId,{previousManagerCustomerId:account.managerCustomerId,legalRevision:profile.revision,verified:proof.verified,certBound:!!cert?.bound,seals:seals.length},'CUSTOMER');
   });
   if(proof.verified)return{status:'VERIFIED'};
   const savedUrl=account.verificationUrlCiphertext?this.decrypt(account.verificationUrlCiphertext,ownerId,'url'):null;
   ensure(savedUrl?.channel==='owner-h5'&&savedUrl.customerId===customerId&&savedUrl.legalRevision===profile.revision&&(!savedUrl.materialHash||savedUrl.materialHash===materialHash),409,'OWNER_LEGACY_VERIFY_PENDING','既有小程序认证尚未完成，请联系运营核对；系统不会重复发起认证');
   return{url:savedUrl.url as string,status:'PENDING'};
  }catch(error){
   await this.db.ownerESignAccount.updateMany({where:{id:account.id,leaseToken:token},data:{certStatus:'UNKNOWN',certSerialNo:null,checkedAt:null,...(started?{realNameStatus:'VERIFY_UNKNOWN'}:{})}});
   throw error;
  }finally{await this.db.ownerESignAccount.updateMany({where:{id:account.id,leaseToken:token},data:{leaseToken:null,leaseUntil:null}});}
 }
 private async assertLegalAttempt(customerId:string,ownerId:string,profile:any,ownerRevision:number,db:any=this.db,materialHash?:string){
  const current=await requireOwnerLegalRepresentative(db,customerId,ownerId);
  ensure(current.profile.revision===profile.revision&&current.profile.name===profile.name&&current.profile.mobileHash===profile.mobileHash&&(materialHash?identityMaterials(current.owner,current.profile).hash===materialHash:current.owner.revision===ownerRevision),409,'OWNER_LEGAL_CHANGED','法人或企业资料已变化，请重新办理认证');return current;
 }
 async selectSeal(customerId:string,ownerId:string,sealId:string,imageHash?:string){
  await requireVirtualEnterpriseOrDefault(this.db,customerId,ownerId);
  this.enabled();await this.owners.requireSigningMember(customerId,ownerId);
  await this.db.serial(async tx=>{
   await this.owners.requireLegalSigningMember(customerId,ownerId,tx);
   const member=await tx.ownerMember.findUnique({where:{ownerId_customerId:{ownerId,customerId}},include:{owner:{include:{esignAccount:true}}}});const account=member?.owner.esignAccount;
   ensure(member?.status==='VERIFIED'&&member.owner.status==='VERIFIED'&&account?.managerCustomerId===customerId&&account.realNameStatus==='VERIFIED'&&account.certStatus==='BOUND'&&account.checkedAt&&Date.now()-account.checkedAt.getTime()<86400000,409,'OWNER_NOT_READY','请先核验当前企业身份和证书');
   const seal=await tx.ownerSeal.findFirst({where:{id:sealId,ownerId,providerCustomerId:account.providerCustomerId!,status:{in:['DISCOVERED','ACTIVE']},checkedAt:{gt:new Date(Date.now()-86400000)}}});ensure(seal,409,'OWNER_SEAL_UNAVAILABLE','该印章未经当前企业核验');
   ensure(imageHash===undefined||seal.imageHash===imageHash,409,'OWNER_SEAL_CHANGED','印模已变化，请重新预览并确认当前印章');
   await tx.ownerSeal.updateMany({where:{ownerId,status:'ACTIVE'},data:{status:'DISCOVERED'}});await tx.ownerSeal.update({where:{id:seal.id},data:{status:'ACTIVE',selectedBy:customerId,selectedAt:new Date()}});
   await audit(tx,customerId,'OWNER_SEAL_SELECTED','vehicle-owners',ownerId,{sealId},'CUSTOMER');
  });return this.owners.memberDetail(customerId,ownerId);
 }
 async sealImage(customerId:string,ownerId:string,sealId:string){await this.owners.requireSigningMember(customerId,ownerId);const seal=await this.db.ownerSeal.findFirst({where:{id:sealId,ownerId}});ensure(seal,404,'NOT_FOUND','印章不存在');return this.decrypt(seal.imageCiphertext,ownerId,'seal:'+seal.providerSignatureId);}
 async callback(raw:unknown){this.available();const event=verifiedCallback(raw,this.config);const account=await this.db.ownerESignAccount.findUnique({where:{verificationTransactionNo:event.transactionId}});ensure(account?.managerCustomerId&&account.providerCustomerId,404,'NOT_FOUND','企业认证任务不存在');ensure(!event.record.customer_id||event.record.customer_id===account.providerCustomerId,409,'OWNER_CALLBACK_BINDING','企业认证回调身份不匹配');await this.refresh(account.managerCustomerId,account.ownerId,event.transactionId);return{accepted:true};}
}
