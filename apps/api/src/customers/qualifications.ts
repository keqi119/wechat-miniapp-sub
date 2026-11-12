import {assertOrdinaryReview} from '../auth/ordinary-review';
import {assertNotAssetFiles} from '../files/asset-files';
import {audit} from '../common/data';
import {ensure} from '../common/errors';
import {archiveCommand} from '../offline-documents/command';
import {requireCurrentStaff} from '../auth/staff-session';
import {canonicalHash,CustomerQualificationView,qualificationReviewInput,qualificationSubmitInput,requireRiskOperator,ReviewActor,safeReviewProjection} from './types';
import {normalizeQualificationValidity,qualificationValidityCurrent} from './qualification-validity';
import {captureQualificationProfile,qualificationProfileReasons,rawProfileHash,parseQualificationProfile,assertQualificationDocuments,type RecheckReason} from './qualification-profile';
import {replaceQualificationDocuments} from './qualification-documents';

export const customerProfileHash=rawProfileHash;
async function customerRecord(tx:any,customerId:string,lock=false){
 if(lock)await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;
 const customer=await tx.customer.findUnique({where:{id:customerId}});ensure(customer,404,'NOT_FOUND','客户不存在');return customer;
}
export async function qualificationEvidence(tx:any,customerId:string,record:any){
 const ids=[...new Set<string>([...record.identityFileIds,...record.drivingLicenseFileIds])];
 const files=await tx.storedFile.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}});
 ensure(files.length===ids.length&&files.every((f:any)=>(f.customerId===customerId||(!f.customerId&&f.adminId))&&['identity','profile','evidence'].includes(f.purpose)&&['application/pdf','image/png','image/jpeg'].includes(f.mimeType)&&/^[a-f0-9]{64}$/.test(f.sha256)),409,'QUALIFICATION_MATERIALS_REQUIRED','身份及驾驶资格材料不完整或不属于本客户');
 await assertNotAssetFiles(tx,ids);
 return{files,evidenceHash:canonicalHash(files.map((f:any)=>({id:f.id,sha256:f.sha256,customerId:f.customerId,adminId:f.adminId})).sort((a:any,b:any)=>a.id.localeCompare(b.id)))};
}
export function qualificationView(q:any):CustomerQualificationView{return{id:q.id,customerId:q.customerId,revision:q.revision,profileHash:q.profileHash,status:q.status,verificationSource:q.verificationSource,identityFileIds:q.identityFileIds,drivingLicenseFileIds:q.drivingLicenseFileIds,identityExpiresAt:q.identityExpiresAt??null,drivingLicenseExpiresAt:q.drivingLicenseExpiresAt??null,identityLongTerm:q.identityLongTerm===true,drivingLicenseLongTerm:q.drivingLicenseLongTerm===true,submittedBy:q.submittedBy,reviewedBy:q.reviewedBy||null,reviewedAt:q.reviewedAt||null,reasonCodes:q.reasonCodes||[],supplementaryInstructions:q.supplementaryInstructions||''};}
export async function requireCurrentQualification(tx:any,customerId:string,qualificationId?:string,now=new Date()){
 const customer=await customerRecord(tx,customerId),q=await tx.customerQualificationVersion.findFirst({where:{customerId},orderBy:{revision:'desc'}});
 ensure(q&&q.customerId===customerId&&(!qualificationId||q.id===qualificationId)&&q.status==='APPROVED'&&q.reviewedBy&&q.reviewedAt,409,'CUSTOMER_QUALIFICATION_REQUIRED','最新身份与驾驶资格资料尚未审核通过');
 ensure(qualificationValidityCurrent(q,now),409,'CUSTOMER_QUALIFICATION_REQUIRED','身份证或驾驶证已过期，或有效期登记不完整，请更新资格资料');
 const reasons=await qualificationProfileReasons(tx,customer,q);ensure(!reasons.length,409,'CUSTOMER_QUALIFICATION_REQUIRED',reasons.map(r=>r.message).join('；'));
 if(q.profileSnapshot){const snapshot=parseQualificationProfile(q.profileSnapshot);ensure(snapshot,409,'CUSTOMER_QUALIFICATION_REQUIRED','资格资料快照不完整，请重新核对');assertQualificationDocuments(q,snapshot);}
 const evidence=await qualificationEvidence(tx,customerId,q);ensure(evidence.evidenceHash===q.evidenceHash,409,'CUSTOMER_QUALIFICATION_REQUIRED','资格材料已变化，须重新独立审核');
 const participants=[q.submittedBy,...evidence.files.map((f:any)=>f.adminId)];
 if(participants.includes(q.reviewedBy)){const reviewer=await tx.adminUser.findUnique({where:{id:q.reviewedBy}});assertOrdinaryReview({id:q.reviewedBy,role:reviewer?.role||''},participants,'CUSTOMER_QUALIFICATION_REQUIRED');}
 return q;
}
export class QualificationService {
 constructor(private readonly clock:()=>Date=()=>new Date()){}
 async submit(tx:any,ctx:ReviewActor,customerId:string,body:unknown):Promise<CustomerQualificationView>{
  const input=qualificationSubmitInput.parse(body);await requireRiskOperator(tx,ctx);const customer=await customerRecord(tx,customerId,true);
  const result=await archiveCommand(tx,ctx,`customer-qualification:${customerId}`,'SUBMIT',input,async()=>{
   const latest=await tx.customerQualificationVersion.findFirst({where:{customerId},orderBy:{revision:'desc'}});
   ensure(input.revision===(latest?.revision||0)&&input.profileHash===customerProfileHash(customer),409,'REVISION_CONFLICT','客户资料或资格版本已改变，请刷新');
   const validity=normalizeQualificationValidity(input);
   ensure(qualificationValidityCurrent(validity,this.clock()),409,'QUALIFICATION_EXPIRED','身份证件及驾驶资格须在有效期内');
   const current=input.documents?await replaceQualificationDocuments(tx,ctx,customer,input.documents):customer;
   const evidence=input.documents?{identityFileIds:[current.profile.identityFrontFileId,current.profile.identityBackFileId],drivingLicenseFileIds:[current.profile.drivingLicenseFileId]}:input;
   const {evidenceHash}=await qualificationEvidence(tx,customerId,evidence);
   const profileSnapshot=await captureQualificationProfile(tx,current);
   assertQualificationDocuments(evidence,profileSnapshot);
   const q=await tx.customerQualificationVersion.create({data:{customerId,revision:input.revision+1,profileHash:customerProfileHash(current),profileSnapshot,verificationSource:input.verificationSource,identityFileIds:evidence.identityFileIds,drivingLicenseFileIds:evidence.drivingLicenseFileIds,evidenceHash,...validity,status:'SUBMITTED',submittedBy:ctx.id,idempotencyKey:input.idempotencyKey,requestHash:canonicalHash(input)}});
   await audit(tx,ctx.id,'QUALIFICATION_SUBMITTED','customers',customerId,{qualificationId:q.id,revision:q.revision,verificationSource:q.verificationSource});return qualificationView(q);
  });
  await assertNotAssetFiles(tx,[...(result.identityFileIds||[]),...(result.drivingLicenseFileIds||[])]);return result;
 }
 async review(tx:any,ctx:ReviewActor,customerId:string,body:unknown):Promise<CustomerQualificationView>{
  const input=qualificationReviewInput.parse(body);await requireRiskOperator(tx,ctx);const customer=await customerRecord(tx,customerId,true);
  const result=await archiveCommand(tx,ctx,`customer-qualification:${customerId}`,'REVIEW',input,async()=>{
   const q=await tx.customerQualificationVersion.findFirst({where:{customerId},orderBy:{revision:'desc'}});
   ensure(q&&q.customerId===customerId&&q.id===input.qualificationId&&q.revision===input.revision,409,'REVISION_CONFLICT','资格版本已变化，请刷新');
   const evidence=await qualificationEvidence(tx,customerId,q);
   assertOrdinaryReview(ctx,[q.submittedBy,...evidence.files.map((f:any)=>f.adminId)],'QUALIFICATION_SELF_REVIEW');
   ensure(q.status==='SUBMITTED',409,'STATE_CONFLICT','该资格版本已审核，请提交新版本');
   ensure(q.profileHash===customerProfileHash(customer)&&q.evidenceHash===evidence.evidenceHash,409,'REVISION_CONFLICT','客户资料或证据已变化，请重新提交');
   if(q.profileSnapshot){const snapshot=parseQualificationProfile(q.profileSnapshot);ensure(snapshot,409,'REVISION_CONFLICT','资格资料快照不完整，请重新提交');assertQualificationDocuments(q,snapshot);}
   if(input.decision==='APPROVED')ensure(qualificationValidityCurrent(q,this.clock()),409,'QUALIFICATION_EXPIRED','身份证件或驾驶资格已到期');
   const updated=await tx.customerQualificationVersion.update({where:{id:q.id},data:{status:input.decision,reasonCodes:input.reasonCodes,supplementaryInstructions:input.supplementaryInstructions,reviewedBy:ctx.id,reviewedAt:new Date()}});
   await audit(tx,ctx.id,'QUALIFICATION_REVIEWED','customers',customerId,{qualificationId:q.id,revision:q.revision,decision:input.decision,reasonCodes:input.reasonCodes});return qualificationView(updated);
  });
  await assertNotAssetFiles(tx,[...(result.identityFileIds||[]),...(result.drivingLicenseFileIds||[])]);return result;
 }
 async status(tx:any,customerId:string){
  await customerRecord(tx,customerId);const q=await tx.customerQualificationVersion.findFirst({where:{customerId},orderBy:{revision:'desc'}});
  if(q)await assertNotAssetFiles(tx,[...q.identityFileIds,...q.drivingLicenseFileIds]);
  if(q?.status==='APPROVED'){try{await requireCurrentQualification(tx,customerId,q.id);}catch(error:any){if(error?.getStatus?.()!==409)throw error;const customer=await customerRecord(tx,customerId);let recheckReasons:RecheckReason[]=[];try{recheckReasons=await qualificationProfileReasons(tx,customer,q);}catch{}if(!qualificationValidityCurrent(q))recheckReasons.push({code:'QUALIFICATION_EXPIRED',message:'身份证或驾驶证已过期，或有效期登记不完整'});if(!recheckReasons.length)recheckReasons=[{code:'QUALIFICATION_RECHECK_REQUIRED',message:error.getResponse?.()?.error?.message||'资格资料需要重新核对'}];return{status:'RECHECK_REQUIRED',supplementaryInstructions:'',recheckReasons};}}
  return safeReviewProjection(q);
 }
 async list(tx:any,ctx:ReviewActor,customerId:string){
  await requireCurrentStaff(tx,ctx,'customers',false);
  if(ctx.role==='SUPPORT')return{customerId,...await this.status(tx,customerId)};
  await requireRiskOperator(tx,ctx);const customer=await customerRecord(tx,customerId),items=await tx.customerQualificationVersion.findMany({where:{customerId},orderBy:{revision:'desc'},take:100});
  await assertNotAssetFiles(tx,items.flatMap((q:any)=>[...q.identityFileIds,...q.drivingLicenseFileIds]));
  return{customerId,profileHash:customerProfileHash(customer),revision:items[0]?.revision||0,current:await this.status(tx,customerId),items:items.map(qualificationView),total:items.length};
 }
}
