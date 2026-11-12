import {ensure} from '../common/errors';
import {customerIdentityPolicy} from './identity-policy';
import {readCustomerIdentityEvidence} from '../esign/customer-identity';
import {customerProfileHash,QualificationService} from './qualifications';
import {requireRiskOperator,ReviewActor} from './types';
import {parseCustomerProfileSnapshot,profileSlots,profileFileMeta,readCustomerProfile,validProfileFile} from './profile';

async function record(tx:any,resource:string,id:string,actor:ReviewActor){
 ensure(['applications','orders'].includes(resource),404,'NOT_FOUND','记录不存在');await requireRiskOperator(tx,actor);
 const value=await tx[resource==='applications'?'application':'order'].findUnique({where:{id}});ensure(value,404,'NOT_FOUND','记录不存在');
 const snapshot=parseCustomerProfileSnapshot(resource==='applications'?value.profile?.customerProfileSnapshot:value.finalPlanSnapshot?.customerProfileSnapshot);
 return{value,snapshot};
}
export async function readRecordCustomerProfile(tx:any,resource:string,id:string,actor:ReviewActor){
 const {value,snapshot}=await record(tx,resource,id,actor),url=(fileId:string)=>`/api/admin/${resource}/${encodeURIComponent(id)}/customer-profile/files/${encodeURIComponent(fileId)}`;
 // Keep displayed documents and the qualification hash on one profile version.
 // Use the same lock order as profile saves and snapshot capture.
 await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${value.customerId} FOR UPDATE`;
 if(customerIdentityPolicy()==='PROVIDER_REQUIRED')await tx.$queryRaw`SELECT id FROM "ESignAccount" WHERE "customerId"=${value.customerId} FOR UPDATE`;
 const current=await readCustomerProfile(tx,value.customerId,url),{files:currentFiles,...basicProfile}=current;
 const customer=await tx.customer.findUnique({where:{id:value.customerId}}),currentProfile={...basicProfile,profileHash:customerProfileHash(customer)};
 const identity=await readCustomerIdentityEvidence(tx,value.customerId,current.name);
 let frozenFiles:any=null;
 if(snapshot){const ids=profileSlots.map(slot=>snapshot.documents[slot].id),rows=await tx.storedFile.findMany({where:{id:{in:ids},customerId:value.customerId}});frozenFiles=Object.fromEntries(profileSlots.map(slot=>{const ref=snapshot.documents[slot],file=rows.find((file:any)=>file.id===ref.id);return[slot,validProfileFile(file,value.customerId)&&file.sha256===ref.sha256?profileFileMeta(file,url(file.id)):null];}));}
 const qualification=await tx.customerQualificationVersion.findFirst({where:{customerId:value.customerId},orderBy:{revision:'desc'}});
 const qualificationState=await new QualificationService().status(tx,value.customerId);
 return{customerId:value.customerId,source:snapshot?(resource==='applications'?'APPLICATION_SNAPSHOT':'ORDER_SNAPSHOT'):'CURRENT_SUPPLEMENT',snapshot,capturedAt:snapshot?.capturedAt||null,currentProfile,files:{snapshot:frozenFiles,current:currentFiles},identity:{snapshot:snapshot?.identity||null,current:{verified:identity.verified,realNameStatus:identity.realNameStatus,verifiedAt:identity.verifiedAt,...(identity.blocker?{blocker:identity.blocker}:{})}},qualificationStatus:{status:qualificationState.status,revision:qualification?.revision||null,valid:qualificationState.status==='APPROVED'}};
}
export async function readRecordCustomerProfileFile(tx:any,resource:string,id:string,fileId:string,actor:ReviewActor){
 const {value,snapshot}=await record(tx,resource,id,actor);
 const frozen=profileSlots.map(slot=>snapshot?.documents[slot]).find(ref=>ref?.id===fileId);
 const current=await readCustomerProfile(tx,value.customerId);
 const allowed=[...profileSlots.map(slot=>(current.files as any)[slot]?.id),...current.files.legacy.map((file:any)=>file.id)];
 ensure(frozen||allowed.includes(fileId),404,'NOT_FOUND','附件不属于该客户资料');
 const file=await tx.storedFile.findUnique({where:{id:fileId}});ensure(validProfileFile(file,value.customerId),404,'NOT_FOUND','客户资料附件不存在');
 if(frozen)ensure(file.sha256===frozen.sha256,409,'PROFILE_FILE_CHANGED','冻结证件文件摘要已变化，请联系运营核查');
 return file;
}
