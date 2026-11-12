import {accountReadiness,decryptIdentity} from './fadada/fadada-safety';
import {customerIdentityPolicy,CustomerIdentityPolicy} from '../customers/identity-policy';

export interface CustomerIdentitySnapshot{provider:'FADADA';identityVersion:number;verifiedAt:string;identityHash:string;}
export interface CustomerIdentityEvidence{identityPolicy:CustomerIdentityPolicy;verified:boolean;realNameStatus:string;verifiedAt:string|null;verificationSource:string;identityVersion:number;identityLocked?:boolean;verifiedName?:string;maskedIdCardNo?:string;blocker?:{code:string;message:string};snapshot?:CustomerIdentitySnapshot;}
/** First successful identity proof is retained even if a later query downgrades readiness.
 * Partial/unreadable established proof fails closed; it never grants a verified badge. */
export function hasEstablishedCustomerIdentity(account:any){
 return !!account&&(account.realNameStatus==='VERIFIED'||account.verifiedAt!=null||account.verifiedIdentityHash!=null);
}
/** Only persisted, task-bound provider evidence is read here. Never calls a provider. */
export async function readCustomerIdentityEvidence(tx:any,customerId:string,expectedName:string,options:{requireProvider?:boolean;now?:Date;displayOnly?:boolean}={}):Promise<CustomerIdentityEvidence>{
 const identityPolicy=customerIdentityPolicy();
 // This describes today's admission policy, not a rewrite of historical provider evidence.
 if(identityPolicy==='MANUAL_REVIEW'&&!options.requireProvider&&!options.displayOnly)return{identityPolicy,verified:false,realNameStatus:'NOT_STARTED',verifiedAt:null,verificationSource:'UNKNOWN',identityVersion:0};
 const account=await tx.eSignAccount.findUnique({where:{customerId}});
 const now=options.now??new Date(),raw=accountReadiness(options.displayOnly&&account?.realNameStatus==='VERIFIED'?{...account,verificationLeaseToken:null}:account,now),states=['NOT_STARTED','STARTING','PENDING','VERIFIED','FAILED','EXPIRED','UNKNOWN'];
 const state=states.includes(raw.realNameStatus)?raw.realNameStatus:'UNKNOWN';
 const source=['QUERY','CALLBACK'].includes(account?.verificationSource)?account.verificationSource:'UNKNOWN';
 const time=account?.verifiedAt?new Date(account.verifiedAt).getTime():NaN;
 const version=Number.isSafeInteger(account?.identityVersion)&&account.identityVersion>0?account.identityVersion:0;
 const evidence:CustomerIdentityEvidence={identityLocked:account?.customerId===customerId&&hasEstablishedCustomerIdentity(account),identityPolicy,verified:false,realNameStatus:state,verifiedAt:Number.isFinite(time)?new Date(time).toISOString():null,verificationSource:source,identityVersion:version};
 if(account?.customerId!==customerId||state!=='VERIFIED'||!version||!Number.isFinite(time)||time>now.getTime()+300000)return{...evidence,blocker:{code:'IDENTITY_REQUIRED',message:'请先完成本人实名认证'}};
 let identity:any;try{identity=decryptIdentity(account.identityCiphertext,customerId,process.env.ESIGN_IDENTITY_ENCRYPTION_KEY||'');}catch{return{...evidence,realNameStatus:'UNKNOWN',blocker:{code:'IDENTITY_UNAVAILABLE',message:'实名结果暂无法核实，请联系运营'}};}
 if(typeof identity?.name!=='string'||!/^\d{17}[\dX]$/.test(identity?.idCardNo||''))return{...evidence,realNameStatus:'UNKNOWN',blocker:{code:'IDENTITY_UNAVAILABLE',message:'实名资料不完整，请联系运营'}};
 const verifiedName=identity.name.trim().normalize('NFC');
 if(!options.displayOnly&&(!expectedName?.trim()||verifiedName!==expectedName.trim().normalize('NFC')))return{...evidence,verifiedName,blocker:{code:'IDENTITY_NAME_MISMATCH',message:'个人资料姓名与实名认证姓名不一致，请核对'}};
 return{...evidence,verified:true,verifiedName,...(options.displayOnly?{maskedIdCardNo:identity.idCardNo.slice(0,6)+'********'+identity.idCardNo.slice(-4)}:{}),snapshot:{provider:'FADADA',identityVersion:version,verifiedAt:evidence.verifiedAt!,identityHash:account.verifiedIdentityHash}};
}

/** Safe display/immutability fact, independent of admission policy and certificate freshness. */
export async function readCustomerIdentityDisplay(tx:any,customerId:string){
 const evidence=await readCustomerIdentityEvidence(tx,customerId,'',{displayOnly:true});
 return evidence.verified?{verified:true,locked:true,name:evidence.verifiedName!,maskedIdCardNo:evidence.maskedIdCardNo!,verifiedAt:evidence.verifiedAt}:{verified:false,locked:evidence.identityLocked===true};
}
