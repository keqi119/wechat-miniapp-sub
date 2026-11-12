import {readCustomerIdentityEvidence,type CustomerIdentityEvidence} from '../esign/customer-identity';

export interface AdminCustomerIdentity {
 status:'VERIFIED'|'NOT_STARTED'|'PENDING'|'FAILED'|'UNKNOWN';
 verified:boolean;
 locked:boolean;
 name?:string;
 maskedIdCardNo?:string;
 verifiedAt?:string|null;
}

const accountSelect={customerId:true,providerCustomerId:true,registrationStatus:true,realNameStatus:true,identityVersion:true,verificationSource:true,identityCiphertext:true,verifiedIdentityHash:true,verifiedSerialNo:true,verificationTransactionNo:true,verificationLeaseToken:true,verifiedAt:true};
const unavailable=():AdminCustomerIdentity=>({status:'UNKNOWN',verified:false,locked:true});
function display(evidence:CustomerIdentityEvidence):AdminCustomerIdentity {
 if(evidence.verified===true){
  const name=typeof evidence.verifiedName==='string'?evidence.verifiedName.trim():'';
  if(!name||name.length>40||typeof evidence.maskedIdCardNo!=='string'||!/^\d{6}\*{8}\d{3}[\dX]$/.test(evidence.maskedIdCardNo)||typeof evidence.verifiedAt!=='string'||!Number.isFinite(Date.parse(evidence.verifiedAt)))return unavailable();
  return{status:'VERIFIED',verified:true,locked:true,name,maskedIdCardNo:evidence.maskedIdCardNo,verifiedAt:evidence.verifiedAt};
 }
 const locked=evidence.identityLocked===true;
 const status=evidence.realNameStatus==='STARTING'||evidence.realNameStatus==='PENDING'?'PENDING':evidence.realNameStatus==='FAILED'?'FAILED':evidence.realNameStatus==='NOT_STARTED'&&!locked?'NOT_STARTED':'UNKNOWN';
 return{status,verified:false,locked};
}

/** Read-only presentation of existing proof. No provider queries, writes or raw proof fields. */
export async function withAdminCustomerIdentity(tx:any,customers:any[],role:string):Promise<any[]> {
 if(!['ADMIN','OPERATIONS'].includes(role)||customers.length===0)return customers;
 let accounts:any[];
 try{accounts=await tx.eSignAccount.findMany({where:{customerId:{in:customers.map(customer=>customer.id)}},select:accountSelect});}
 catch{return customers.map(customer=>({...customer,identity:unavailable()}));}
 const byCustomer=new Map(accounts.map(account=>[account.customerId,account]));
 // Reuse the evidence checks against the current page's batch without per-row database reads.
 const evidenceReader={eSignAccount:{findUnique:async({where}:any)=>byCustomer.get(where.customerId)||null}};
 return Promise.all(customers.map(async customer=>{
  let identity:AdminCustomerIdentity;
  try{identity=display(await readCustomerIdentityEvidence(evidenceReader,customer.id,'',{displayOnly:true}));}
  catch{identity=unavailable();}
  return{...customer,identity};
 }));
}
