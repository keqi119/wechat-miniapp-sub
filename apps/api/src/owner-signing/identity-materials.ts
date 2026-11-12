import {hash,audit} from '../common/data';
import {ensure} from '../common/errors';

export function identityMaterials(owner:any,profile=owner.legalRepresentative){
 const values={subjectType:owner.subjectType||'ENTERPRISE',name:owner.name,creditCode:owner.creditCode??null,legal:profile?{name:profile.name,mobileHash:profile.mobileHash,evidenceHash:profile.evidenceHash??null,revision:profile.revision}:null};
 return {version:1,hash:hash(values),values};
}
export function materialsChanged(owner:any,profile=owner.legalRepresentative,account=owner.esignAccount,customerId?:string){
 if((owner.subjectType||'ENTERPRISE')!=='ENTERPRISE'||!account)return false;
 const consent=account.consentSnapshot as any,m=consent?.materials;
 if(customerId&&account.managerCustomerId&&account.managerCustomerId!==customerId)return true;
 if(account.realNameStatus==='REAUTH_REQUIRED'||m?.status==='REAUTH_REQUIRED')return true;
 // Missing legacy snapshot is not evidence of a change. Positive old proof mismatch is.
 if(consent?.channel==='OWNER_LEGAL_H5'&&!!profile&&(consent.customerId!==account.managerCustomerId||consent.legalRevision!==profile.revision||consent.legalName!==profile.name||consent.legalMobileHash!==profile.mobileHash))return true;
 return !!m?.hash&&m.hash!==identityMaterials(owner,profile).hash;
}
export function frozenMaterials(owner:any,profile=owner.legalRepresentative,provenance='INITIATION'){
 return {...identityMaterials(owner,profile),status:'CURRENT',capturedAt:new Date().toISOString(),provenance};
}
export function assertMaterialsCurrent(owner:any,profile=owner.legalRepresentative,account=owner.esignAccount,customerId?:string){ensure(!materialsChanged(owner,profile,account,customerId),409,'OWNER_MATERIALS_CHANGED','资料已变更，需重新认证；请由当前法人按新资料重新办理企业认证');}

/** Called inside the actual writer transaction, before values are replaced. */
export async function changeIdentityMaterials(tx:any,actorId:string,ownerId:string,nextOwner:any,nextProfile?:any){
 const owner=await tx.vehicleOwner.findUnique({where:{id:ownerId},include:{legalRepresentative:true,esignAccount:true}});
 if(!owner||(owner.subjectType||'ENTERPRISE')!=='ENTERPRISE')return false;
 const profile=owner.legalRepresentative,account=owner.esignAccount;
 const next={...owner,...nextOwner},nextLegal=nextProfile===undefined?profile:nextProfile;
 if(account?.providerCustomerId)ensure(next.subjectType===owner.subjectType&&next.creditCode===owner.creditCode,409,'OWNER_SUBJECT_IMMUTABLE','已登记认证的企业信用代码不能原位更换，请新建合作商主体；原合同和资产不自动迁移');
 if(identityMaterials(owner,profile).hash===identityMaterials(next,nextLegal).hash)return false;
 if(!account)return true;
 ensure(!account.leaseToken&&(!account.leaseUntil||account.leaseUntil<=new Date())&&!['PENDING','VERIFY_STARTING','VERIFY_UNKNOWN'].includes(account.realNameStatus),409,'OWNER_MATERIALS_BUSY','已有认证任务尚未解决，请先完成原认证或联系运营核对，不能并行变更认证材料');
 const consent=account.consentSnapshot as any||{},previous=consent.materials?.status==='REAUTH_REQUIRED'&&consent.materials.previous?consent.materials.previous:consent.materials?{version:consent.materials.version,hash:consent.materials.hash,values:consent.materials.values,status:consent.materials.status,capturedAt:consent.materials.capturedAt,provenance:consent.materials.provenance}:frozenMaterials(owner,profile,'LEGACY_BEFORE_FIRST_MUTATION');
 await audit(tx,actorId,'OWNER_IDENTITY_MATERIALS_CHANGED','vehicle-owners',ownerId,{previous,previousProof:{transactionNo:account.verificationTransactionNo,providerCustomerId:account.providerCustomerId,evidenceHash:account.evidenceHash,verifiedAt:account.verifiedAt,consentSnapshot:consent},nextHash:identityMaterials(next,nextLegal).hash});
 const materials={...identityMaterials(next,nextLegal),status:'REAUTH_REQUIRED',capturedAt:new Date().toISOString(),provenance:'MATERIAL_EDIT',previous,reason:'企业或法人认证材料发生变更'};
 await tx.ownerESignAccount.update({where:{ownerId},data:{consentSnapshot:{...consent,materials},realNameStatus:'REAUTH_REQUIRED',certStatus:'UNKNOWN',certSerialNo:null,certCheckedAt:null,checkedAt:null}});
 await tx.ownerMember.updateMany({where:{ownerId,status:'VERIFIED'},data:{status:'CLAIMED',verifiedAt:null,verifiedSerialNo:null}});
 await tx.ownerSeal.updateMany({where:{ownerId,status:'ACTIVE'},data:{status:'DISCOVERED',selectedBy:null,selectedAt:null}});
 await tx.ownerAutoAuthority.updateMany({where:{ownerId,enabled:true},data:{enabled:false,disabledAt:new Date(),revision:{increment:1}}});
 await tx.ownerAutoAuthority.updateMany({where:{ownerId,scope:{path:['version'],equals:3},status:{notIn:['REVOKED','REVOKING','SUPERSEDED','INVALIDATED']}},data:{enabled:false,status:'INVALIDATED',disabledAt:new Date(),revision:{increment:1}}});
 await tx.electronicAutoAuthority.updateMany({where:{ownerId,enabled:true},data:{enabled:false,revision:{increment:1}}});
 await tx.vehicleOwner.update({where:{id:ownerId},data:{status:'DRAFT'}});
 return true;
}
