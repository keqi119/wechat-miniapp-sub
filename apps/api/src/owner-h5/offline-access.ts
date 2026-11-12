import {ensure} from '../common/errors';
import {requirePartnerIdentity,PartnerSession} from '../partners/identity';
export async function partnerLoginEligibility(tx:any,value:string){
 const customer=await tx.customer.findUnique({where:{mobile:value}});if(!customer)return null;
 const bindings=await tx.partnerIdentityBinding.findMany({where:{customerId:customer.id,status:'APPROVED',revokedAt:null}}),choices=[];
 for(const binding of bindings){
  const owner=await tx.vehicleOwner.findUnique({where:{id:binding.ownerId}}),verification=await tx.partnerVerification.findFirst({where:{ownerId:binding.ownerId},orderBy:{revision:'desc'}});
  if(!owner||owner.status==='SUSPENDED'||binding.profileRevision!==owner.revision||!binding.reviewedAt||!binding.reviewedBy||binding.relationship!==(owner.subjectType==='INDIVIDUAL'?'SELF':'ENTERPRISE_REPRESENTATIVE')||verification?.status!=='APPROVED'||verification.profileRevision!==owner.revision||!verification.reviewedBy||!verification.reviewedAt||verification.identityBindingId!==binding.id||verification.identityBindingRevision!==binding.revision)continue;
  choices.push({ownerId:owner.id,revision:binding.revision,ownerRevision:owner.revision,bindingId:binding.id,bindingRevision:binding.revision,profileRevision:owner.revision,verificationRevision:verification.revision});
 }
 return choices.length?{customer,invite:null,choices}:null;
}
export async function requireOfflinePartnerCustomer(tx:any,customerId:string,ownerId:string){const customer=await tx.customer.findUnique({where:{id:customerId}});const eligible=customer&&await partnerLoginEligibility(tx,customer.mobile),choice=eligible?.choices.find((c:any)=>c.ownerId===ownerId);ensure(choice,403,'PARTNER_IDENTITY_REQUIRED','当前合作商本人或经办关系不可用');return tx.partnerIdentityBinding.findUnique({where:{id:choice.bindingId}});}
export async function requireOfflineSession(tx:any,session:PartnerSession,ownerId?:string){
 if(ownerId)return requirePartnerIdentity(tx,session,ownerId);
 const choices=Array.isArray(session.identitySnapshot)?session.identitySnapshot:[];
 for(const choice of choices)try{return await requirePartnerIdentity(tx,session,choice.ownerId);}catch{}
 ensure(false,401,'SESSION_EXPIRED','合作商关系或资料已变化，请重新登录');
}
