import {createHash} from 'node:crypto';
import {encryptIdentity} from '../src/esign/fadada/fadada-safety';

/** Synthetic prerequisites for tests of later business steps. Never calls a provider. */
export function trustedProfileFixture(customer:any){
 const key=process.env.ESIGN_IDENTITY_ENCRYPTION_KEY||Buffer.alloc(32,37).toString('base64');process.env.ESIGN_IDENTITY_ENCRYPTION_KEY=key;
 const files=['identityFront','identityBack','drivingLicense'].map((slot,index)=>({id:customer.id+'-'+slot,customerId:customer.id,name:'synthetic-'+slot+'.png',mimeType:'image/png',purpose:'identity',sha256:String(index+1).repeat(64),storagePath:'synthetic-never-read',size:10}));
 const profile={...(customer.profile||{}),revision:1,identityFrontFileId:files[0].id,identityBackFileId:files[1].id,drivingLicenseFileId:files[2].id};
 const complete={...customer,name:customer.name||'合成客户',mobile:customer.mobile||'13900000001',drivingYears:customer.drivingYears??2,profile};
 const ciphertext=encryptIdentity({name:complete.name,idCardNo:'110101199001010000'},customer.id,key);
 const account={customerId:customer.id,providerCustomerId:'synthetic-provider-'+customer.id,registrationStatus:'REGISTERED',realNameStatus:'VERIFIED',identityVersion:1,identityCiphertext:ciphertext,verifiedIdentityHash:createHash('sha256').update(ciphertext).digest('hex'),verifiedSerialNo:'synthetic-serial-'+customer.id,verificationTransactionNo:'synthetic-transaction-'+customer.id,verificationSource:'QUERY',verifiedAt:new Date(),verificationLeaseToken:null};
 return{customer:complete,files,account};
}
export async function seedTrustedCustomerProfile(db:any,customerId:string,overrides:any={}){
 const customer=await db.customer.findUniqueOrThrow({where:{id:customerId}}),f=trustedProfileFixture({...customer,...overrides});
 for(const file of f.files)await db.storedFile.upsert({where:{id:file.id},create:file,update:file});
 await db.customer.update({where:{id:customerId},data:{name:f.customer.name,drivingYears:f.customer.drivingYears,profile:f.customer.profile}});
 await db.eSignAccount.upsert({where:{customerId},create:f.account,update:f.account});return f;
}
