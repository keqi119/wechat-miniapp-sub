import {approvedReturnUrl} from '../h5-sign/config';
import {approvedPlatformCallback} from '../common/platform-origins';
import { createHash, randomUUID } from 'node:crypto';
import { Db } from '../common/db';
import { ensure } from '../common/errors';
import { audit, hash } from '../common/data';
import { FadadaApiClient } from './fadada/fadada-api.client';
import { FadadaSettings } from './esign.settings';
import { accountReadiness, certificateCurrentlyValid, encryptIdentity, verifiedCallback } from './fadada/fadada-safety';
import {certificateEvidence,certificateSubjectEvidence} from './fadada/certificate-evidence';
import {assertNewEsignAllowed,newOrderContractMode,runBoundElectronicOperation} from '../offline-documents/mode';
import {requireCustomerIdentity} from './native-signing';
import {readCustomerIdentityEvidence,hasEstablishedCustomerIdentity} from './customer-identity';
import {requireProviderIdentity} from '../customers/identity-policy';
import {virtualActorScope} from '../virtual-acceptance/actors';
export class CustomerESignOnboardingService {
  constructor(private db: Db, private config: FadadaSettings, private api: FadadaApiClient) {}
  async readiness(customerId: string) { return accountReadiness(await this.db.eSignAccount.findUnique({ where: { customerId } })); }
  async identityReadiness(customerId:string){const customer=await this.db.customer.findUniqueOrThrow({where:{id:customerId}}),scope=await virtualActorScope(this.db,customerId,{current:false});const evidence=await readCustomerIdentityEvidence(this.db,customerId,customer.name,{requireProvider:!!scope});const{snapshot,...view}=evidence;return{...view,...(scope?{identityPolicy:'SIGNING_REQUIRED'}:{})};}
  private async admission(customerId:string,identityOnly:boolean){const scope=await virtualActorScope(this.db,customerId);if(scope){requireCustomerIdentity(true);return false;}requireProviderIdentity();if(identityOnly)requireCustomerIdentity();else assertNewEsignAllowed();return identityOnly;}
  private async newOperation<T>(customerId:string,identityOnly:boolean,operation:()=>Promise<T>){if(!await virtualActorScope(this.db,customerId))return operation();return runBoundElectronicOperation(async()=>{await this.admission(customerId,identityOnly);},operation);}
  async register(customerId: string, identityOnly=false) {
    identityOnly=await this.admission(customerId,identityOnly);
    ensure(this.config.enabled && this.config.accountRegisterEnabled, 503, 'FADADA_REGISTRATION_DISABLED', '法大大账号注册尚未启用');
    ensure(await this.db.customer.count({ where: { id: customerId } }), 404, 'NOT_FOUND', '客户不存在');
    let account = await this.db.eSignAccount.upsert({ where: { customerId }, create: { customerId }, update: {} });
    if (account.registrationStatus === 'REGISTERED' && account.providerCustomerId) return this.readiness(customerId);
    const claimed = await this.db.eSignAccount.updateMany({ where: { id: account.id, OR: [{ registrationLeaseUntil: null }, { registrationLeaseUntil: { lt: new Date() } }] }, data: { registrationLeaseUntil: new Date(Date.now()+60000) } });
    ensure(claimed.count === 1, 409, 'ONBOARDING_PROCESSING', '账号注册处理中，请稍后查询');
    try {
      await this.admission(customerId,identityOnly);
      const provider = await this.newOperation(customerId,identityOnly,()=>this.api.registerAccount({ accountType: 'PERSONAL', openId: createHash('sha256').update('independent-miniapp:'+customerId).digest('hex').slice(0,32) }));
      ensure(['1','1000','success'].includes(provider.resultCode || '') && provider.providerCustomerId, 502, 'FADADA_ACCOUNT_RESPONSE', '供应商未确认账号注册');
      await this.db.serial(async tx => { await tx.eSignAccount.update({ where: { id: account.id }, data: { registrationStatus: 'REGISTERED', providerCustomerId: provider.providerCustomerId, registrationLeaseUntil: null } }); await tx.customer.update({ where: { id: customerId }, data: { providerCustomerId: provider.providerCustomerId } }); await audit(tx, customerId, 'FADADA_ACCOUNT_REGISTERED', 'customers', customerId, {}, 'CUSTOMER'); });
    } catch (error) { await this.db.eSignAccount.updateMany({ where: { id: account.id }, data: { registrationLeaseUntil: null } }); throw error; }
    return this.readiness(customerId);
  }
  async verify(customerId: string, input: { name: string; idCardNo: string }, returnUrl?:string,identityOnly=false) {
    identityOnly=await this.admission(customerId,identityOnly);
    ensure(this.config.enabled && this.config.realNameVerifyEnabled, 503, 'FADADA_VERIFICATION_DISABLED', '法大大实名核验尚未启用');
    ensure(input.name?.trim().length >= 2 && input.name.length <= 50 && /^\d{17}[\dXx]$/.test(input.idCardNo || ''),400,'IDENTITY_INPUT','请提供有效实名信息');
    const account = await this.db.eSignAccount.findUnique({ where: { customerId } });
    ensure(account?.providerCustomerId && account.registrationStatus === 'REGISTERED',409,'FADADA_ACCOUNT_MISSING','请先完成法大大账号注册');
    ensure(!hasEstablishedCustomerIdentity(account),409,'IDENTITY_ALREADY_VERIFIED','实名身份已固定，请查询原实名结果');
    const customer = await this.db.customer.findUniqueOrThrow({ where: { id: customerId } });
    const ciphertext = encryptIdentity({ name: input.name.trim(), idCardNo: input.idCardNo.toUpperCase() }, customerId, this.config.identityEncryptionKey);
    approvedPlatformCallback(this.config.verifyNotifyUrl,'fadada-identity');
    const verifiedReturnUrl=approvedReturnUrl(returnUrl||this.config.verifyReturnUrl);
    const token=randomUUID(),version=account.identityVersion+1,leaseUntil=new Date(Date.now()+60000);
    const claimed=await this.db.eSignAccount.updateMany({where:{id:account.id,providerCustomerId:account.providerCustomerId,identityVersion:account.identityVersion,realNameStatus:{not:'VERIFIED'},verifiedAt:null,verifiedIdentityHash:null,OR:[{verificationLeaseUntil:null},{verificationLeaseUntil:{lt:new Date()}}]},data:{identityVersion:version,verificationLeaseToken:token,verificationLeaseUntil:leaseUntil,identityCiphertext:ciphertext,realNameStatus:'STARTING',verificationSource:'UNKNOWN',verificationTransactionNo:null,verifiedSerialNo:null,verifiedIdentityHash:null,certStatus:'UNKNOWN',certSerialNo:null,verifiedAt:null,checkedAt:null}});
    ensure(claimed.count===1,409,'IDENTITY_PROCESSING','实名任务准备中或身份状态已变化，请稍后查询');
    const ownership={id:account.id,identityVersion:version,verificationLeaseToken:token,identityCiphertext:ciphertext};
    try{
      await this.admission(customerId,identityOnly);
      const result = await this.newOperation(customerId,identityOnly,()=>this.api.getPersonVerifyUrl({ customerId: account.providerCustomerId!, name: input.name.trim(), idCardNo: input.idCardNo.toUpperCase(), mobile: customer.mobile, notifyUrl: this.config.verifyNotifyUrl!, returnUrl: verifiedReturnUrl, certFlag: !identityOnly }));
      ensure(['1','1000','success'].includes(result.resultCode || '') && result.transactionNo && result.verifyUrl.startsWith('https://'),502,'FADADA_VERIFICATION_RESPONSE','供应商未确认实名任务');
      await this.db.serial(async tx=>{const changed=await tx.eSignAccount.updateMany({where:{...ownership,verificationLeaseUntil:{gt:new Date()}},data:{realNameStatus:'PENDING',verificationTransactionNo:result.transactionNo,verifiedSerialNo:result.transactionNo,verificationLeaseToken:null,verificationLeaseUntil:null}});ensure(changed.count===1,409,'IDENTITY_ATTEMPT_CHANGED','实名任务已变更，请查询最新任务');await audit(tx,customerId,'FADADA_VERIFICATION_STARTED','customers',customerId,{identityVersion:version,returnUrl:verifiedReturnUrl},'CUSTOMER');});
      return { url: result.verifyUrl, status: 'PENDING' };
    }catch(error){await this.db.eSignAccount.updateMany({where:ownership,data:{verificationLeaseToken:null,verificationLeaseUntil:null,realNameStatus:'FAILED'}});throw error;}
  }
  async refresh(customerId: string,identityOnly=false) {
    const scope=await virtualActorScope(this.db,customerId,{current:false});if(scope)identityOnly=false;else requireProviderIdentity();
    return this.refreshExisting(customerId,identityOnly);
  }
  /** Only a verified callback may recover its original task while new customer activity is paused. */
  private async refreshExisting(customerId:string,identityOnly:boolean){
    ensure(this.config.enabled,503,'FADADA_DISABLED','历史电子实名渠道未配置，无法核验原交易');
    const account = await this.db.eSignAccount.findUnique({ where: { customerId } });
    ensure(account?.providerCustomerId && account.verifiedSerialNo && account.verificationTransactionNo && account.identityCiphertext,409,'FADADA_VERIFICATION_MISSING','请先发起并等待当前实名任务准备完成');
    const token=randomUUID();
    const ownership={id:account.id,providerCustomerId:account.providerCustomerId,identityVersion:account.identityVersion,verifiedSerialNo:account.verifiedSerialNo,verificationTransactionNo:account.verificationTransactionNo,identityCiphertext:account.identityCiphertext};
    const claimed=await this.db.eSignAccount.updateMany({where:{...ownership,OR:[{verificationLeaseToken:null,verificationLeaseUntil:null},{verificationLeaseUntil:{lt:new Date()}}]},data:{verificationLeaseToken:token,verificationLeaseUntil:new Date(Date.now()+60000)}});
    ensure(claimed.count===1,409,'IDENTITY_PROCESSING','实名核验处理中，请稍后查询');
    try{
    const real = await this.api.findPersonCertInfo({ verifiedSerialNo: account.verifiedSerialNo });
    const status = real.realNameStatus?.trim().toLowerCase();
    const verified = ['2','verified','success','passed','pass','true','3000'].includes(status || '');
    let cert = verified&&!identityOnly ? await this.api.queryCert({ customerId: account.providerCustomerId }) : null;
    // Recovery only verifies the original attempt. A missing certificate is not an instruction to apply for one.
    const next = verified ? 'VERIFIED' : ['3','failed','fail','3001'].includes(status || '') ? 'FAILED' : ['4','expired','3003'].includes(status || '') ? 'EXPIRED' : 'PENDING';
    const certEvidence=cert?.certBound&&cert.certSerialNo?certificateEvidence(cert.raw):null;
    const validCert = !!certEvidence;
    await this.db.serial(async tx=>{const changed=await tx.eSignAccount.updateMany({where:{...ownership,verificationLeaseToken:token,verificationLeaseUntil:{gt:new Date()},checkedAt:account.checkedAt,realNameStatus:account.realNameStatus},data:{realNameStatus:next,verificationSource:verified||!hasEstablishedCustomerIdentity(account)?'QUERY':account.verificationSource,verifiedIdentityHash:verified?createHash('sha256').update(account.identityCiphertext!).digest('hex'):account.verifiedIdentityHash,verifiedAt:verified?account.verifiedAt||new Date():account.verifiedAt,...(!identityOnly?{certStatus:validCert?'BOUND':'UNKNOWN',certSerialNo:validCert?cert!.certSerialNo:null,certValidFrom:certEvidence?new Date(certEvidence.validFrom):null,certValidUntil:certEvidence?new Date(certEvidence.validUntil):null,certEvidenceHash:certEvidence?.evidenceHash||null,certSubjectHash:cert?.certSerialNo?certificateSubjectEvidence(cert.raw,account.providerCustomerId!,cert.certSerialNo):null,certCheckedAt:certEvidence?new Date():null}:{}),checkedAt:new Date(),verificationLeaseToken:null,verificationLeaseUntil:null}});ensure(changed.count===1,409,'IDENTITY_ATTEMPT_CHANGED','实名任务已变化，请重新查询当前身份');await audit(tx,customerId,'FADADA_READINESS_QUERIED','customers',customerId,{realNameStatus:next,...(!identityOnly?{certBound:validCert}:{}),identityVersion:account.identityVersion},'CUSTOMER');});
    return this.readiness(customerId);
    }finally{await this.db.eSignAccount.updateMany({where:{...ownership,verificationLeaseToken:token},data:{verificationLeaseToken:null,verificationLeaseUntil:null}});}
  }
  async callback(payload: unknown) {
    ensure(this.config.enabled,503,'FADADA_DISABLED','法大大回调尚未启用');
    const verified = verifiedCallback(payload, this.config);
    const eventId = hash(verified.record);
    const existing = await this.db.providerEvent.findUnique({ where: { provider_eventId: { provider: 'FADADA_IDENTITY', eventId } } });
    if (existing?.status === 'PROCESSED') return { accepted: true, replayed: true };
    const account = await this.db.eSignAccount.findUnique({ where: { verificationTransactionNo: verified.transactionId } });
    ensure(account?.providerCustomerId,404,'FADADA_ACCOUNT_MISSING','实名回调任务不存在');
    ensure(!verified.record.customer_id || verified.record.customer_id === account.providerCustomerId,409,'CALLBACK_IDENTITY','实名回调身份不匹配');
    await this.db.providerEvent.upsert({ where: { provider_eventId: { provider: 'FADADA_IDENTITY', eventId } }, create: { provider: 'FADADA_IDENTITY', eventId, resourceId: account.customerId, payloadHash: eventId, status: 'PROCESSING' }, update: {} });
    await this.refreshExisting(account.customerId,newOrderContractMode()==='OFFLINE'&&!await virtualActorScope(this.db,account.customerId,{current:false}));
    await this.db.providerEvent.update({ where: { provider_eventId: { provider: 'FADADA_IDENTITY', eventId } }, data: { status: 'PROCESSED' } });
    return { accepted: true, replayed: false };
  }
}
