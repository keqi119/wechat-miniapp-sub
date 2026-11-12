import {ownerVerificationDisplay,type OwnerVerificationDisplay} from '../owner-h5/verification-display';
import {materialsChanged} from '../owner-signing/identity-materials';

type IdentityState='COMPLETED'|'REAUTH_REQUIRED'|'PROCESSING'|'PENDING'|'FAILED'|'NOT_STARTED'|'UNKNOWN'|'NOT_APPLICABLE';
export type PartnerEnterpriseVerification={
 applicable:boolean;
 identity:{state:IdentityState;complete:boolean;label:string;message:string;companyName:string|null;creditCode:string|null;legalName:string|null;verifiedAt:string|null;previous?:{companyName:string;legalName:string;capturedAt:string}};
 certification:OwnerVerificationDisplay['certification'];
 seal:OwnerVerificationDisplay['seal']&{selected:boolean;selectedAt:string|null;checkedAt:string|null};
 checkedAt:string|null;
};
const descriptions:Record<IdentityState,{label:string;message:string}>={
 COMPLETED:{label:'企业已实名',message:'当前企业与法人资料已有匹配的实名认证记录；证书、印章和签署权限分别核验。'},
 REAUTH_REQUIRED:{label:'资料已变更，需重新认证',message:'企业或法人认证材料已变更，请由当前法人按新资料重新认证。'},
 PROCESSING:{label:'实名认证处理中',message:'现有企业实名认证任务正在处理，请由法人本人查询现有认证进度。'},
 PENDING:{label:'实名认证待完成',message:'已发起当前企业实名认证，请由法人本人完成现有认证流程。'},
 FAILED:{label:'实名认证未通过',message:'当前企业实名认证未通过，请由法人本人核对认证结果。'},
 NOT_STARTED:{label:'未发起企业实名',message:'尚无本企业实名认证记录，请由法人本人办理。'},
 UNKNOWN:{label:'实名状态待核对',message:'当前实名认证证据缺失或无法确认，请由法人本人核对现有认证结果。'},
 NOT_APPLICABLE:{label:'不适用企业实名',message:'当前合作商为个人主体，企业实名认证状态不适用。'},
};
const text=(value:unknown,max:number)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max?value.trim():null;
const time=(value:unknown,now:number)=>{
 if(!(value instanceof Date)&&typeof value!=='string')return null;
 const millis=new Date(value).getTime();return Number.isFinite(millis)&&millis<=now?new Date(millis).toISOString():null;
};
const identity=(state:IdentityState):PartnerEnterpriseVerification['identity']=>({state,complete:false,...descriptions[state],companyName:null,creditCode:null,legalName:null,verifiedAt:null});
function unavailable(state:IdentityState='UNKNOWN'):PartnerEnterpriseVerification{
 return{applicable:state!=='NOT_APPLICABLE',identity:identity(state),certification:{state:'INCOMPLETE',label:'证书状态待核对',message:state==='NOT_APPLICABLE'?'企业签署证书不适用于个人主体。':'当前企业签署证书状态尚无法确认。'},seal:{state:'UNAVAILABLE',label:'印章状态待核对',message:state==='NOT_APPLICABLE'?'企业印章不适用于个人主体。':'当前企业印章状态尚无法确认。',selected:false,selectedAt:null,checkedAt:null},checkedAt:null};
}

/** Display only. Keep certificate freshness and signing authorization out of identity completion. */
function project(owner:any,now:number):PartnerEnterpriseVerification{
 if(owner.subjectType==='INDIVIDUAL')return unavailable('NOT_APPLICABLE');
 if(owner.subjectType!=='ENTERPRISE')return unavailable();
 const account=owner.esignAccount,profile=owner.legalRepresentative,managerId=text(account?.managerCustomerId,128);
 const member=owner.members?.find((row:any)=>row.customerId===managerId)||{status:'UNKNOWN',verifiedSerialNo:null};
 const changed=materialsChanged(owner,profile,account,managerId||undefined);
 const display=ownerVerificationDisplay(owner,member,managerId||'',now);
 const companyName=text(owner.name,200),legalName=text(profile?.name,40),creditCode=typeof owner.creditCode==='string'&&/^[A-Z0-9]{18}$/.test(owner.creditCode)?owner.creditCode:null;
 const verifiedAt=time(account?.verifiedAt,now),consent=account?.consentSnapshot;
 const currentAttempt=!!managerId&&!!text(account?.providerCustomerId,200)&&!!text(account?.verificationTransactionNo,200)&&!!time(account?.consentedAt,now)&&consent?.channel==='OWNER_LEGAL_H5'&&consent.ownerId===owner.id&&consent.customerId===managerId&&!!text(profile?.mobileHash,200)&&!!text(profile?.evidenceHash,200)&&Number.isInteger(profile?.revision)&&profile.revision>0&&consent.legalRevision===profile.revision&&consent.legalName===profile.name&&consent.legalMobileHash===profile.mobileHash;
 let state:IdentityState='UNKNOWN';
 if(changed)state='REAUTH_REQUIRED';
 else if(display.identity.complete&&currentAttempt&&companyName&&creditCode&&legalName&&verifiedAt)state='COMPLETED';
 else if(!account)state=owner.status==='VERIFIED'?'UNKNOWN':'NOT_STARTED';
 else if(account.realNameStatus==='NOT_STARTED'&&!account.providerCustomerId&&!account.verificationTransactionNo)state='NOT_STARTED';
 else if(currentAttempt){
  if(account.realNameStatus==='VERIFY_UNKNOWN')state='UNKNOWN';
  else if(account.leaseToken||new Date(account.leaseUntil).getTime()>now||account.realNameStatus==='VERIFY_STARTING')state='PROCESSING';
  else if(account.realNameStatus==='PENDING')state='PENDING';
  else if(account.realNameStatus==='FAILED')state='FAILED';
 }
 const result=unavailable(state);result.checkedAt=time(account?.checkedAt,now);
 if(state==='COMPLETED')result.identity={...identity(state),complete:true,companyName,creditCode,legalName,verifiedAt};
 const previous=consent?.materials?.previous,previousName=text(previous?.values?.name,200),previousLegalName=text(previous?.values?.legal?.name,40),capturedAt=time(previous?.capturedAt,now);
 if(previousName&&previousLegalName&&capturedAt)result.identity.previous={companyName:previousName,legalName:previousLegalName,capturedAt};
 result.certification=state==='COMPLETED'?display.certification:{state:'INCOMPLETE',label:'待完成当前实名核验',message:descriptions[state].message};
 const certificateWindowInvalid=(account?.certValidUntil!=null&&(!Number.isFinite(new Date(account.certValidUntil).getTime())||new Date(account.certValidUntil).getTime()<=now))||(account?.certValidFrom!=null&&(!Number.isFinite(new Date(account.certValidFrom).getTime())||new Date(account.certValidFrom).getTime()>now));
 if(state==='COMPLETED'&&certificateWindowInvalid)result.certification={state:'INCOMPLETE',label:'证书有效期待核验',message:'企业已有实名认证记录，签署证书的有效期当前不可用，请由法人本人重新核验。'};
 const selected=(owner.seals||[]).filter((seal:any)=>seal.status==='ACTIVE'),single=selected.length===1?selected[0]:null;
 result.seal={...display.seal,selected:!!single,selectedAt:time(single?.selectedAt,now),checkedAt:time(single?.checkedAt,now)};
 if(state!=='COMPLETED'&&result.seal.state==='READY')result.seal={...result.seal,state:'REFRESH_REQUIRED',label:'已选用，待核验当前实名',message:'已有印章选择记录，需先核对当前企业与法人的实名认证证据。'};
 else if(result.certification.state!=='VERIFIED'&&result.seal.state==='READY')result.seal={...result.seal,state:'REFRESH_REQUIRED',label:'已选用，待更新核验',message:'已有本企业印章选择记录，请先重新核验企业签署证书状态。'};
 return result;
}

/** One scoped evidence read for list/detail. Never load seal images, encrypted identities or channel URLs. */
export async function readPartnerEnterpriseVerifications(tx:any,owners:Array<{id:string;subjectType?:string}>,now=Date.now()){
 const result=new Map<string,PartnerEnterpriseVerification>();
 if(!owners.length)return result;
 const rows=await tx.vehicleOwner.findMany({where:{id:{in:owners.map(owner=>owner.id)}},select:{
  id:true,subjectType:true,name:true,creditCode:true,status:true,
  legalRepresentative:{select:{name:true,mobileHash:true,evidenceHash:true,revision:true}},
  esignAccount:{select:{realNameStatus:true,certStatus:true,certSerialNo:true,certValidFrom:true,certValidUntil:true,providerCustomerId:true,verifiedAt:true,checkedAt:true,consentedAt:true,managerCustomerId:true,verificationTransactionNo:true,consentSnapshot:true,leaseToken:true,leaseUntil:true}},
  members:{select:{customerId:true,status:true,verifiedSerialNo:true}},
  seals:{select:{status:true,providerCustomerId:true,checkedAt:true,selectedAt:true}},
 }});
 const evidence=new Map<string,any>(rows.map((row:any)=>[row.id,row]));
 for(const owner of owners){
  const row=evidence.get(owner.id);
  try{result.set(owner.id,row?project(row,now):unavailable(owner.subjectType==='INDIVIDUAL'?'NOT_APPLICABLE':'UNKNOWN'));}
  catch{result.set(owner.id,unavailable(owner.subjectType==='INDIVIDUAL'?'NOT_APPLICABLE':'UNKNOWN'));}
 }
 return result;
}
