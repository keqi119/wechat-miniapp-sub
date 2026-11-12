import {materialsChanged} from '../owner-signing/identity-materials';
type Timestamp=Date|string|null|undefined;
type VerificationAccount={realNameStatus:string;certStatus:string;certSerialNo?:string|null;providerCustomerId?:string|null;verifiedAt?:Timestamp;checkedAt?:Timestamp;consentedAt?:Timestamp;managerCustomerId?:string|null;verificationTransactionNo?:string|null;consentSnapshot?:unknown;leaseToken?:string|null;leaseUntil?:Timestamp};
type VerificationProfile={name:string;mobileHash:string;evidenceHash?:string|null;revision:number};
type VerificationMember={status:string;verifiedSerialNo?:string|null};
type VerificationSeal={status:string;checkedAt?:Timestamp;providerCustomerId?:string|null};
type VerificationOwner={subjectType?:string;name?:string;creditCode?:string|null;address?:string;status:string;esignAccount?:VerificationAccount|null;legalRepresentative?:VerificationProfile|null;seals?:VerificationSeal[]};
type CertificationDisplay={state:'VERIFIED'|'REFRESH_REQUIRED'|'INCOMPLETE';label:string;message:string};
type SealDisplay={state:'READY'|'REFRESH_REQUIRED'|'NOT_SELECTED'|'UNAVAILABLE';label:string;message:string};
export type OwnerVerificationDisplay={identity:{complete:boolean;currentAttempt:boolean;state:'COMPLETED'|'PROCESSING'|'PENDING'|'FAILED'|'NOT_STARTED'|'REAUTH_REQUIRED';previous?:{companyName:string;legalName:string;capturedAt:string};verifiedAt:string|null};state:'READY'|'REFRESH_REQUIRED'|'INCOMPLETE'|'PROCESSING';label:string;message:string;certification:CertificationDisplay;seal:SealDisplay;checkedAt:string|null};

const timestamp=(value:Timestamp)=>value==null?NaN:new Date(value).getTime();
const fresh=(value:Timestamp,now:number)=>Number.isFinite(timestamp(value))&&timestamp(value)<=now&&timestamp(value)>now-86400000;

// Display evidence only. Business actions retain their existing service gates.
// Never return provider identifiers, certificate serials or consent identity data.
export function ownerVerificationDisplay(owner:VerificationOwner,member:VerificationMember,customerId:string,now=Date.now()):OwnerVerificationDisplay{
 const account=owner.esignAccount,profile=owner.legalRepresentative,consent=account?.consentSnapshot as Record<string,unknown>|null;
 const consentCurrent=!!profile&&!!account?.consentedAt&&consent?.channel==='OWNER_LEGAL_H5'&&consent.customerId===customerId&&consent.legalRevision===profile.revision&&consent.legalName===profile.name&&consent.legalMobileHash===profile.mobileHash;
 const changed=materialsChanged(owner,profile,account,customerId);
 const verified=!changed&&consentCurrent&&member.status==='VERIFIED'&&member.verifiedSerialNo===account?.verificationTransactionNo&&owner.status==='VERIFIED'&&account?.managerCustomerId===customerId&&account.realNameStatus==='VERIFIED';
 const checkedAtMs=timestamp(account?.checkedAt),checkedAt=Number.isFinite(checkedAtMs)?new Date(checkedAtMs).toISOString():null;
 let certification:CertificationDisplay;
 if(!consentCurrent)certification={state:'INCOMPLETE',label:'待法人核验',message:'请由当前法人本人办理认证并同意当前企业认证说明。'};
 else if(!verified)certification={state:'INCOMPLETE',label:'待完成认证',message:'企业或当前法人身份尚未通过认证核验，请由法人本人查询现有认证结果。'};
 else if(account?.certStatus!=='BOUND'||!account.certSerialNo)certification={state:'INCOMPLETE',label:'待核验证书',message:'尚未确认有效企业签署证书，请由法人本人重新核验，以最新查询结果为准。'};
 else if(!fresh(account.checkedAt,now))certification={state:'REFRESH_REQUIRED',label:'待更新核验',message:Number.isFinite(checkedAtMs)&&checkedAtMs<=now-86400000?'企业与法人已有认证记录，本地核验已超过24小时，请由法人本人重新核验企业与证书状态。':'企业与法人已有认证记录，当前核验时间不可用，请由法人本人重新核验企业与证书状态。'};
 else certification={state:'VERIFIED',label:'已核验',message:'企业、当前法人及签署证书的核验记录已就绪。'};
 const seals=owner.seals||[],selected=seals.filter(seal=>seal.status==='ACTIVE');
 let seal:SealDisplay;
 if(selected.length>1)seal={state:'UNAVAILABLE',label:'印章待核对',message:'存在多枚已选印章，请联系运营核对后由法人本人确认选用印章。'};
 else if(selected.length===1&&(!account?.providerCustomerId||selected[0].providerCustomerId!==account.providerCustomerId))seal={state:'UNAVAILABLE',label:'印章归属待核对',message:'已选印章与当前认证企业的归属不匹配，请由法人本人重新核验并联系运营核对。'};
 else if(selected.length===1){
  seal=certification.state==='VERIFIED'&&fresh(selected[0].checkedAt,now)?{state:'READY',label:'已选用，已核验',message:'已选用印章的核验记录已就绪。'}:{state:'REFRESH_REQUIRED',label:'已选用，待更新核验',message:'已选用本企业印章，当前核验记录需要更新；请先重新核验企业与证书状态，原选择会按最新结果核对。'};
 }else if(seals.some(seal=>seal.status==='DISCOVERED'))seal={state:'NOT_SELECTED',label:'尚未选用',message:'尚未选用本企业印章，请在企业与证书核验就绪后由法人本人选用。'};
 else seal={state:'UNAVAILABLE',label:seals.length?'印章待核验':'尚未发现印章',message:seals.length?'原印章当前不可用，请重新核验企业与证书状态后核对可用印章。':'尚未发现可用企业印章，请由法人本人完成认证并查询印章状态。'};
 let state:OwnerVerificationDisplay['state'],label:string,message:string;
 if(account?.leaseToken||timestamp(account?.leaseUntil)>now){state='PROCESSING';label='核验处理中';message='存在尚未完成的企业核验任务，请稍后重新读取企业资料。';}
 else if(changed){state='INCOMPLETE';label='资料已变更，需重新认证';message='企业或法人认证材料已变更，请由当前法人按新资料重新认证。';}
 else if(certification.state==='INCOMPLETE'){state='INCOMPLETE';label='待完善核验';message=certification.message;}
 else if(certification.state==='REFRESH_REQUIRED'||seal.state==='REFRESH_REQUIRED'){state='REFRESH_REQUIRED';label='待更新核验';message=certification.state==='REFRESH_REQUIRED'?certification.message:seal.message;}
 else if(seal.state!=='READY'){state='INCOMPLETE';label='待完善核验';message=seal.message;}
 else{state='READY';label='已核验';message='企业、法人、证书及已选印章的核验记录均已就绪。';}
 const verifiedTime=timestamp(account?.verifiedAt);
 const currentAttempt=!changed&&consentCurrent&&account?.managerCustomerId===customerId&&!!account.providerCustomerId&&!!account.verificationTransactionNo;
 const previous=(consent?.materials as any)?.previous;
 const identity={...(previous?{previous:{companyName:previous.values?.name||'',legalName:previous.values?.legal?.name||'',capturedAt:previous.capturedAt||''}}:{}),complete:verified,currentAttempt,state:verified?'COMPLETED' as const:account?.leaseToken?'PROCESSING' as const:changed?'REAUTH_REQUIRED' as const:account?.realNameStatus==='FAILED'?'FAILED' as const:account?.verificationTransactionNo?'PENDING' as const:'NOT_STARTED' as const,verifiedAt:verified&&Number.isFinite(verifiedTime)?new Date(verifiedTime).toISOString():null};
 return{identity,state,label,message,certification,seal,checkedAt};
}
