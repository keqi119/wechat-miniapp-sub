import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,hash} from '../common/data';
import {acceptConsents,consentInput,currentDocuments} from '../auth/consents';
import {FadadaSettings} from '../esign/esign.settings';
import {decryptIdentity,encryptIdentity,verifiedCallback} from '../esign/fadada/fadada-safety';
import {FadadaOwnerClient} from './fadada-owner.client';
import {OwnerService} from './owner.service';

const startInput=z.object({accepted:z.literal(true),consents:consentInput}).strict();
export class OwnerIdentityService {
 constructor(private db:Db,private owners:OwnerService,private config:FadadaSettings,private api:FadadaOwnerClient){}
 private enabled(){ensure(process.env.OWNER_ONBOARDING_ENABLED==='true'&&this.config.enabled&&this.config.accountRegisterEnabled&&this.config.realNameVerifyEnabled,503,'OWNER_ONBOARDING_DISABLED','企业车主实名认证入口尚未开放');}
 private encrypt(value:unknown,ownerId:string,purpose:string){return encryptIdentity(value,'owner:'+ownerId+':'+purpose,this.config.identityEncryptionKey);}
 private decrypt(value:string,ownerId:string,purpose:string){return decryptIdentity(value,'owner:'+ownerId+':'+purpose,this.config.identityEncryptionKey);}
 async start(customerId:string,ownerId:string,raw:unknown){
  this.enabled();const input=startInput.parse(raw);await this.owners.member(customerId,ownerId);
  const account=await this.db.serial(async tx=>{
   const member=await tx.ownerMember.findUnique({where:{ownerId_customerId:{ownerId,customerId}},include:{owner:true}});
   ensure(member&&member.status!=='SUSPENDED'&&member.owner.status!=='SUSPENDED',404,'NOT_FOUND','企业成员不可用');
   const old=await tx.ownerESignAccount.findUnique({where:{ownerId}});ensure(!old?.managerCustomerId||old.managerCustomerId===customerId,409,'OWNER_MANAGER_BOUND','当前企业认证已绑定其他经办人，请联系运营核对');
   await acceptConsents(tx,customerId,input.consents,['terms','privacy','owner-identity'],'OWNER_IDENTITY');
   const docs=await currentDocuments(tx,['terms','privacy','owner-identity']);
   const consentSnapshot={ownerId,name:member.owner.name,creditCode:member.owner.creditCode,customerId,documents:docs.map(d=>({id:d.id,type:d.type,version:d.version,hash:hash(d.content)}))};
   return tx.ownerESignAccount.upsert({where:{ownerId},create:{ownerId,managerCustomerId:customerId,consentSnapshot,consentedAt:new Date()},update:{consentSnapshot,consentedAt:new Date(),managerCustomerId:customerId}});
  });
  if(account.verificationTransactionNo&&account.verificationUrlCiphertext)return{url:this.decrypt(account.verificationUrlCiphertext,ownerId,'url').url,status:account.realNameStatus};
  ensure(!['VERIFY_STARTING','VERIFY_UNKNOWN'].includes(account.realNameStatus),409,'OWNER_VERIFY_UNKNOWN','企业认证请求结果尚待核对，请联系运营；系统不会重复创建认证');
  const token=randomUUID();
  const claimed=await this.db.ownerESignAccount.updateMany({where:{id:account.id,managerCustomerId:customerId,verificationTransactionNo:null,realNameStatus:account.realNameStatus,OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},data:{leaseToken:token,leaseUntil:new Date(Date.now()+120000)}});
  ensure(claimed.count===1,409,'OWNER_PROCESSING','企业认证准备中，请稍后读取状态');
  let started=false;
  try{
   let providerCustomerId=account.providerCustomerId;
   if(!providerCustomerId){const result=await this.api.registerEnterprise(createHash('sha256').update('miniapp-owner:'+ownerId).digest('hex').slice(0,32));providerCustomerId=result.customerId;
    const saved=await this.db.ownerESignAccount.updateMany({where:{id:account.id,leaseToken:token},data:{providerCustomerId}});ensure(saved.count===1,409,'OWNER_ATTEMPT_CHANGED','企业认证任务已变更');}
   const owner=await this.db.vehicleOwner.findUniqueOrThrow({where:{id:ownerId}});ensure(owner.status!=='SUSPENDED',409,'OWNER_SUSPENDED','企业已停用');
   // Persist intent before the non-idempotent provider call. An ambiguous response is never retried automatically.
   const intent=await this.db.ownerESignAccount.updateMany({where:{id:account.id,leaseToken:token,leaseUntil:{gt:new Date()}},data:{realNameStatus:'VERIFY_STARTING'}});ensure(intent.count===1,409,'OWNER_ATTEMPT_CHANGED','企业认证任务已变更');started=true;
   const result=await this.api.createVerification({customerId:providerCustomerId,name:owner.name,creditCode:owner.creditCode});
   await this.db.serial(async tx=>{const changed=await tx.ownerESignAccount.updateMany({where:{id:account.id,leaseToken:token,realNameStatus:'VERIFY_STARTING'},data:{verificationTransactionNo:result.serialNo,verificationUrlCiphertext:this.encrypt({url:result.url},ownerId,'url'),realNameStatus:'PENDING',leaseToken:null,leaseUntil:null}});ensure(changed.count===1,409,'OWNER_ATTEMPT_CHANGED','企业认证任务已变更');await audit(tx,customerId,'OWNER_VERIFICATION_STARTED','vehicle-owners',ownerId,{},'CUSTOMER');});
   return{url:result.url,status:'PENDING'};
  }catch(error){if(started)await this.db.ownerESignAccount.updateMany({where:{id:account.id,leaseToken:token},data:{realNameStatus:'VERIFY_UNKNOWN'}});throw error;}
  finally{await this.db.ownerESignAccount.updateMany({where:{id:account.id,leaseToken:token},data:{leaseToken:null,leaseUntil:null}});}
 }
 async refresh(customerId:string,ownerId:string){
  this.enabled();await this.owners.member(customerId,ownerId);
  const account=await this.db.ownerESignAccount.findUnique({where:{ownerId}});
  ensure(account?.providerCustomerId&&account.verificationTransactionNo&&account.consentedAt,409,'OWNER_VERIFY_MISSING','请先由本人发起企业认证');
  ensure(account.managerCustomerId===customerId,403,'OWNER_MANAGER_BOUND','请由当前认证经办人核验');
  const token=randomUUID(),ownership={id:account.id,providerCustomerId:account.providerCustomerId,verificationTransactionNo:account.verificationTransactionNo,managerCustomerId:customerId};
  const claim=await this.db.ownerESignAccount.updateMany({where:{...ownership,OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},data:{leaseToken:token,leaseUntil:new Date(Date.now()+120000)}});ensure(claim.count===1,409,'OWNER_PROCESSING','企业认证核验中，请稍后读取状态');
  try{
   const owner=await this.db.vehicleOwner.findUniqueOrThrow({where:{id:ownerId}}),customer=await this.db.customer.findUniqueOrThrow({where:{id:customerId}});
   const proof=await this.api.queryEnterprise({customerId:account.providerCustomerId,serialNo:account.verificationTransactionNo,name:owner.name,creditCode:owner.creditCode});
   ensure(!proof.verified||proof.manager?.mobile===customer.mobile,409,'OWNER_MANAGER_MISMATCH','认证经办人与当前登录手机号不一致，请联系运营核对');
   const cert=proof.verified?await this.api.queryCertificate(account.providerCustomerId):null;
   const seals=proof.verified&&cert?.bound?await this.api.querySeals(account.providerCustomerId):[];
   await this.db.serial(async tx=>{
    const member=await tx.ownerMember.findUnique({where:{ownerId_customerId:{ownerId,customerId}},include:{owner:true}});ensure(member&&member.status!=='SUSPENDED'&&member.owner.status!=='SUSPENDED',409,'OWNER_SUSPENDED','企业或经办人已停用');
    const now=new Date();const changed=await tx.ownerESignAccount.updateMany({where:{...ownership,leaseToken:token,leaseUntil:{gt:now}},data:{realNameStatus:proof.verified?'VERIFIED':'PENDING',certStatus:cert?.bound?'BOUND':'UNKNOWN',certSerialNo:cert?.serialNo||null,managerCiphertext:proof.manager?this.encrypt(proof.manager,ownerId,'manager'):null,verifiedAt:proof.verified?account.verifiedAt||now:null,checkedAt:now,evidenceHash:hash({proof,cert,seals:seals.map(s=>s.imageHash)}),leaseToken:null,leaseUntil:null}});ensure(changed.count===1,409,'OWNER_ATTEMPT_CHANGED','企业认证任务已变更');
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
 async selectSeal(customerId:string,ownerId:string,sealId:string){
  this.enabled();await this.owners.requireSigningMember(customerId,ownerId);
  await this.db.serial(async tx=>{
   const member=await tx.ownerMember.findUnique({where:{ownerId_customerId:{ownerId,customerId}},include:{owner:{include:{esignAccount:true}}}});const account=member?.owner.esignAccount;
   ensure(member?.status==='VERIFIED'&&member.owner.status==='VERIFIED'&&account?.managerCustomerId===customerId&&account.realNameStatus==='VERIFIED'&&account.certStatus==='BOUND'&&account.checkedAt&&Date.now()-account.checkedAt.getTime()<86400000,409,'OWNER_NOT_READY','请先核验当前企业身份和证书');
   const seal=await tx.ownerSeal.findFirst({where:{id:sealId,ownerId,providerCustomerId:account.providerCustomerId!,status:{in:['DISCOVERED','ACTIVE']},checkedAt:{gt:new Date(Date.now()-86400000)}}});ensure(seal,409,'OWNER_SEAL_UNAVAILABLE','该印章未经当前企业核验');
   await tx.ownerSeal.updateMany({where:{ownerId,status:'ACTIVE'},data:{status:'DISCOVERED'}});await tx.ownerSeal.update({where:{id:seal.id},data:{status:'ACTIVE',selectedBy:customerId,selectedAt:new Date()}});
   await audit(tx,customerId,'OWNER_SEAL_SELECTED','vehicle-owners',ownerId,{sealId},'CUSTOMER');
  });return this.owners.memberDetail(customerId,ownerId);
 }
 async sealImage(customerId:string,ownerId:string,sealId:string){await this.owners.requireSigningMember(customerId,ownerId);const seal=await this.db.ownerSeal.findFirst({where:{id:sealId,ownerId}});ensure(seal,404,'NOT_FOUND','印章不存在');return this.decrypt(seal.imageCiphertext,ownerId,'seal:'+seal.providerSignatureId);}
 async callback(raw:unknown){this.enabled();const event=verifiedCallback(raw,this.config);const account=await this.db.ownerESignAccount.findUnique({where:{verificationTransactionNo:event.transactionId}});ensure(account?.managerCustomerId&&account.providerCustomerId,404,'NOT_FOUND','企业认证任务不存在');ensure(!event.record.customer_id||event.record.customer_id===account.providerCustomerId,409,'OWNER_CALLBACK_BINDING','企业认证回调身份不匹配');await this.refresh(account.managerCustomerId,account.ownerId);return{accepted:true};}
}
