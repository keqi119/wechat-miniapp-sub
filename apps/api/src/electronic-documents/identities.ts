import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {canonicalHash} from '../customers/types';
import {NINDA_PLATFORM_LEGAL_ENTITY} from '../common/platform-legal-entity';
import {readCustomerIdentityEvidence} from '../esign/customer-identity';
import {requireOwnerLegalRepresentative} from '../owner-h5/legal-representative';
import {assertElectronicParties,electronicHash,electronicIdentityReady,requiredSignerRoles} from './policy';
import {readAutomaticSigningAuthority} from './authorization';
import type {SigningContext,SigningPartyInput,SignerRole} from './types';
const current=(date:any,now:Date,age=86400000)=>date instanceof Date&&Number.isFinite(date.getTime())&&date<=now&&now.getTime()-date.getTime()<age;

export async function requireElectronicCustomerIdentity(tx:any,customerId:string,now=new Date()){
 const customer=await tx.customer.findUnique({where:{id:customerId}}),account=await tx.eSignAccount.findUnique({where:{customerId}});
 const evidence=customer?await readCustomerIdentityEvidence(tx,customerId,customer.name,{requireProvider:true,now}):null;
 ensure(evidence?.verified&&evidence.snapshot&&account?.verifiedAt<=now&&current(account?.checkedAt,now)&&!account.verificationLeaseToken,409,'ELECTRONIC_IDENTITY_REQUIRED','请先完成本人法大大实名认证并刷新核验结果');
 return{customer,account,snapshot:evidence.snapshot};
}
function certificate(account:any,now:Date){
 ensure(account?.certStatus==='BOUND'&&account.certSerialNo&&electronicHash(account.certEvidenceHash)&&account.certValidFrom instanceof Date&&account.certValidUntil instanceof Date&&account.certValidFrom<=now&&account.certValidUntil>now&&current(account.certCheckedAt,now),409,'ELECTRONIC_CERTIFICATE_REQUIRED','签署证书缺少当前有效期核验，请重新核验法大大证书');
 return{serialNo:account.certSerialNo,status:'VALID',validFrom:account.certValidFrom.toISOString(),validUntil:account.certValidUntil.toISOString(),checkedAt:account.certCheckedAt.toISOString()};
}
export async function requireElectronicOwnerActor(tx:any,customerId:string,ownerId:string,now=new Date()){
 const context=await requireOwnerLegalRepresentative(tx,customerId,ownerId),{owner,member,profile}=context,a=owner.esignAccount,c=(a?.consentSnapshot??{}) as Record<string,unknown>;
 ensure(member.status==='VERIFIED'&&owner.status==='VERIFIED'&&member.verifiedAt&&member.verifiedAt<=now&&a?.realNameStatus==='VERIFIED'&&a.managerCustomerId===customerId&&a.verifiedAt&&a.verifiedAt<=now&&current(a.checkedAt,now)&&(!a.leaseUntil||a.leaseUntil<=now)&&a.verificationTransactionNo===member.verifiedSerialNo&&c?.ownerId===ownerId&&c.customerId===customerId&&c.legalRevision===profile.revision&&c.legalName===profile.name&&c.legalMobileHash===profile.mobileHash&&c.channel===(owner.subjectType==='INDIVIDUAL'?'OWNER_PERSONAL_H5':'OWNER_LEGAL_H5'),409,'ELECTRONIC_OWNER_IDENTITY_REQUIRED','请由当前登记本人重新核验合作商身份和签署权限');
 if(owner.subjectType==='INDIVIDUAL'){
  const personal=await requireElectronicCustomerIdentity(tx,customerId,now);
  ensure(owner.name===personal.customer.name&&a.providerCustomerId===personal.account.providerCustomerId&&a.evidenceHash===personal.snapshot.identityHash,409,'ELECTRONIC_OWNER_IDENTITY_REQUIRED','自然人合作商与当前实名身份不一致');
 }else ensure(owner.subjectType==='ENTERPRISE'&&owner.creditCode&&electronicHash(a.evidenceHash),409,'ELECTRONIC_OWNER_IDENTITY_REQUIRED','企业主体资料不完整');
 return context;
}
/** Called after the individual has completed the ordinary Fadada personal flow. */
export async function bindIndividualOwnerIdentity(tx:any,customerId:string,ownerId:string,now=new Date()){
 const {owner,member,profile}=await requireOwnerLegalRepresentative(tx,customerId,ownerId),personal=await requireElectronicCustomerIdentity(tx,customerId,now);
 ensure(owner.subjectType==='INDIVIDUAL'&&owner.name===personal.customer.name&&profile.name===personal.customer.name,409,'ELECTRONIC_OWNER_IDENTITY_REQUIRED','仅登记自然人本人可绑定该合作商');certificate(personal.account,now);
 const a=personal.account,consentSnapshot={channel:'OWNER_PERSONAL_H5',ownerId,customerId,legalRevision:profile.revision,legalName:profile.name,legalMobileHash:profile.mobileHash,identityVersion:a.identityVersion,identityHash:a.verifiedIdentityHash};
 const data={providerCustomerId:a.providerCustomerId,managerCustomerId:customerId,verificationTransactionNo:a.verificationTransactionNo,realNameStatus:'VERIFIED',certStatus:a.certStatus,certSerialNo:a.certSerialNo,certValidFrom:a.certValidFrom,certValidUntil:a.certValidUntil,certEvidenceHash:a.certEvidenceHash,certCheckedAt:a.certCheckedAt,evidenceHash:a.verifiedIdentityHash,consentSnapshot,consentedAt:now,verifiedAt:a.verifiedAt,checkedAt:a.checkedAt,leaseToken:null,leaseUntil:null};
 await tx.ownerESignAccount.upsert({where:{ownerId},create:{ownerId,...data},update:data});await tx.ownerMember.update({where:{id:member.id},data:{status:'VERIFIED',verifiedAt:now,verifiedSerialNo:a.verificationTransactionNo}});await tx.vehicleOwner.update({where:{id:ownerId},data:{status:'VERIFIED'}});
 await audit(tx,customerId,'ELECTRONIC_PERSONAL_OWNER_BOUND','vehicle-owners',ownerId,{identityVersion:a.identityVersion,identityHash:a.verifiedIdentityHash},'CUSTOMER');return{verified:true};
}
async function personalParty(tx:any,subjectId:string,customerId:string,role:SignerRole,now:Date):Promise<SigningPartyInput>{
 const {account,snapshot}=await requireElectronicCustomerIdentity(tx,customerId,now);
 return{role,subjectId,subjectType:'INDIVIDUAL',providerCustomerId:account.providerCustomerId,identityVersion:snapshot.identityVersion,identityHash:snapshot.identityHash,identityVerified:true,certificate:certificate(account,now)};
}
async function ownerParty(tx:any,subjectId:string,role:'OWNER'|'PLATFORM',now:Date):Promise<SigningPartyInput>{
 const owner=await tx.vehicleOwner.findUnique({where:{id:subjectId},include:{esignAccount:true,legalRepresentative:true}}),account=owner?.esignAccount;
 if(role==='PLATFORM')ensure(owner?.subjectType==='ENTERPRISE'&&owner.name===NINDA_PLATFORM_LEGAL_ENTITY&&process.env.FADADA_PLATFORM_CUSTOMER_ID&&account?.providerCustomerId===process.env.FADADA_PLATFORM_CUSTOMER_ID,409,'ELECTRONIC_PLATFORM_MISMATCH','平台账号必须独立绑定上海宁达信息科技有限公司');
 ensure(account?.managerCustomerId,409,'ELECTRONIC_OWNER_IDENTITY_REQUIRED','请先由合作商本人完成法大大实名认证');await requireElectronicOwnerActor(tx,account.managerCustomerId,subjectId,now);
 if(owner.subjectType==='INDIVIDUAL')return personalParty(tx,subjectId,account.managerCustomerId,role,now);
 const seals=await tx.ownerSeal.findMany({where:{ownerId:subjectId,status:'ACTIVE',providerCustomerId:account.providerCustomerId},take:2});
 const seal=seals.length===1?seals[0]:null;
 ensure(seal&&seal.selectedBy===account.managerCustomerId&&seal.selectedAt&&seal.selectedAt<=now&&current(seal.checkedAt,now)&&electronicHash(seal.imageHash)&&(role!=='PLATFORM'||process.env.FADADA_PLATFORM_SIGNATURE_ID&&seal.providerSignatureId===process.env.FADADA_PLATFORM_SIGNATURE_ID),409,'ELECTRONIC_SEAL_REQUIRED','请由企业本人核验并选择本企业当前印章');
 return{role,subjectId,subjectType:'ENTERPRISE',providerCustomerId:account.providerCustomerId,identityVersion:owner.legalRepresentative.revision,identityHash:canonicalHash({subjectId,name:owner.name,creditCode:owner.creditCode,identityEvidenceHash:account.evidenceHash,legalRevision:owner.legalRepresentative.revision,legalEvidenceHash:owner.legalRepresentative.evidenceHash,sealImageHash:seal.imageHash}),identityVerified:true,certificate:certificate(account,now),signatureId:seal.providerSignatureId};
}
export async function resolveSigningParties(tx:any,archiveVersionId:string,now=new Date(),completed:SigningPartyInput[]=[]):Promise<SigningPartyInput[]>{
 const version=await tx.archiveVersion.findUnique({where:{id:archiveVersionId},include:{archive:true}}),context:SigningContext=version?.scopeSnapshot?.electronicContext;
 ensure(version?.executionMode==='ELECTRONIC'&&!version.invalidatedAt&&context,409,'ELECTRONIC_SOURCE_REQUIRED','本版电子合同尚未准备');
 const frozen=version.partiesSnapshot;assertElectronicParties(Array.isArray(frozen)?frozen.map((p:any)=>({role:p.role,subjectId:p.partyId})):[],context.kind);
 const result:SigningPartyInput[]=[];
 for(const role of requiredSignerRoles(context.kind)){
  const p=frozen.find((item:any)=>item.role===role);
  const signed=completed.find(item=>item.role===role);
  if(signed){ensure(signed.subjectId===p.partyId&&signed.subjectType===p.subjectType,409,'ELECTRONIC_PARTIES_MISMATCH','历史已签主体不匹配');result.push(signed);continue;}
  if(role==='OWNER')ensure(p.partyId===version.archive.ownerId,409,'ELECTRONIC_PARTIES_MISMATCH','合作商归属不匹配');
  if(role==='PLATFORM')ensure(p.partyId===context.platformSubjectId,409,'ELECTRONIC_PLATFORM_MISMATCH','平台主体不匹配');
  const resolved=role==='CUSTOMER'?await personalParty(tx,p.partyId,p.partyId,role,now):await ownerParty(tx,p.partyId,role,now);
  ensure(resolved.subjectType===p.subjectType,409,'ELECTRONIC_PARTIES_MISMATCH','签署主体类型已变化');
  const actual=role==='CUSTOMER'?await tx.customer.findUnique({where:{id:p.partyId}}):await tx.vehicleOwner.findUnique({where:{id:p.partyId}});
  ensure(!p.name||p.name===actual?.name,409,'ELECTRONIC_PARTIES_MISMATCH','冻结合同主体名称与当前实名资料不一致');
  if(resolved.subjectType==='ENTERPRISE')resolved.autoAuthority=await readAutomaticSigningAuthority(tx,resolved,context,now);
  ensure(electronicIdentityReady(resolved,now),409,'ELECTRONIC_IDENTITY_REQUIRED','签署实名条件尚未齐备');result.push(resolved);
 }
 return result;
}
