export type CustomerResource='applications'|'orders';
export type CustomerSource='APPLICATION_SNAPSHOT'|'ORDER_SNAPSHOT'|'CURRENT_SUPPLEMENT';
export type ProfileFile={id:string;name:string;mimeType:string;size:number;url:string};
export type ClassifiedFiles={identityFront:ProfileFile|null;identityBack:ProfileFile|null;drivingLicense:ProfileFile|null};
export type SnapshotIdentity={provider:'FADADA';identityVersion:number;verifiedAt:string;identityHash:string};
export type CustomerIdentityPolicy='MANUAL_REVIEW'|'PROVIDER_REQUIRED';
type ProfileSnapshotFields={captureStage:'APPLICATION_SUBMISSION'|'APPLICATION_AMENDMENT'|'ORDER_CONFIRMATION';capturedAt:string;profileRevision:number;profileHash:string;name:string;mobile:string;drivingYears:number;documents:Record<string,{id:string;sha256:string}>};
export type ProfileSnapshot=ProfileSnapshotFields&({version:1;identity:SnapshotIdentity}|{version:2;identityPolicy:'MANUAL_REVIEW';identity:null});
export type CustomerDossier={customerId:string;source:CustomerSource;snapshot:ProfileSnapshot|null;capturedAt:string|null;currentProfile:{revision:number;profileHash:string;name:string;mobile:string;drivingYears:number|null;readiness:{identityPolicy?:CustomerIdentityPolicy;profileComplete:boolean;realNameVerified:boolean;readyForApplication:boolean;missingFields:string[];blockers:{code:string;message:string}[]}};files:{snapshot:ClassifiedFiles|null;current:ClassifiedFiles&{legacy:ProfileFile[]}};identity:{identityPolicy?:CustomerIdentityPolicy;snapshot:SnapshotIdentity|null;current:{verified:boolean;realNameStatus?:string;verifiedAt?:string|null;blocker?:{code:string;message:string}|null}};qualificationStatus:{status:string;revision:number|null;valid:boolean}};
export function customerIdentityStatus({identityPolicy,verified}:{identityPolicy?:string;verified:boolean}){
 return identityPolicy==='MANUAL_REVIEW'?'未进行线上实名认证，由运营审核资料':verified?'已实名':'尚无可信实名记录';
}
export type ProfileQualificationEvidence={profileHash:string;profileRevision:number;identityFileIds:string[];drivingLicenseFileIds:string[]};
export function profileQualificationEvidence(data:CustomerDossier):ProfileQualificationEvidence|null{
 const current=data.files.current;
 return data.currentProfile.profileHash&&current.identityFront&&current.identityBack&&current.drivingLicense?{profileHash:data.currentProfile.profileHash,profileRevision:data.currentProfile.revision,identityFileIds:[current.identityFront.id,current.identityBack.id],drivingLicenseFileIds:[current.drivingLicense.id]}:null;
}
export function canReadCustomerProfile(role?:string){return role==='ADMIN'||role==='OPERATIONS';}
export function customerSourceLabel(source:CustomerSource){return source==='APPLICATION_SNAPSHOT'?'申请时冻结的客户资料':source==='ORDER_SNAPSHOT'?'本订单冻结的客户资料':'当前补充资料，非下单时快照';}
export function customerFilePath(resource:CustomerResource,recordId:string,file:Pick<ProfileFile,'id'|'url'>){
 const path=`/admin/${resource}/${encodeURIComponent(recordId)}/customer-profile/files/${encodeURIComponent(file.id)}`;
 if(!file.id||file.url!=='/api'+path)throw new Error('附件地址与当前审核记录不一致，请刷新资料');
 return path;
}

