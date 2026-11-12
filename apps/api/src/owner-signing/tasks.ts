import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,hash} from '../common/data';
import {OwnerService} from './owner.service';
import {evaluateOwnerSigning,SigningFacts} from './rules';
import {assertNewEsignAllowed} from '../offline-documents/mode';

/** Persists the one chosen owner transaction before any provider side effect. */
export class OwnerSigningTasks {
 constructor(private db:Db,private owners:OwnerService){}
 private async load(tx:any,id:string){const task=await tx.ownerSigningTask.findUnique({where:{id},include:{parties:true,owner:{include:{esignAccount:true,seals:true,members:true,authorities:{where:{enabled:true}}}}}});ensure(task,404,'NOT_FOUND','车主签署任务不存在');return task;}
 private async newSigningMode(tx:any,task:any){const resource=await tx.contract.findUnique({where:{id:task.resourceId},include:{order:true}});ensure(resource,404,'NOT_FOUND','签署合同不存在');assertNewEsignAllowed({executionMode:resource.executionMode,contractMode:resource.order?.contractMode});ensure(resource.id===task.resourceId&&resource.providerTaskId===task.id,409,'DOCUMENT_MISMATCH','合同与当前车主签署任务绑定已变化');}
 private async facts(tx:any,t:any):Promise<SigningFacts>{
  const s=t.snapshot||{},account=t.owner.esignAccount,seal=t.owner.seals.find((x:any)=>x.id===t.ownerSealId),a=t.owner.authorities.find((x:any)=>!t.authorityId||x.id===t.authorityId),member=t.owner.members.find((m:any)=>m.customerId===account?.managerCustomerId);
  let vehicleOwnershipApproved=false,templateVerified=false;
  {
   const binding=typeof s.vehicleId==='string'?await tx.ownerVehicle.findUnique({where:{vehicleId:s.vehicleId}}):null;
   vehicleOwnershipApproved=!!(binding?.ownerId===t.ownerId&&binding.status==='APPROVED'&&binding.reviewedBy&&binding.reviewedAt);
   const template=typeof s.template?.id==='string'?await tx.legalDocument.findUnique({where:{id:s.template.id}}):null;
   const resource=t.kind==='AMENDMENT'?await tx.contract.findUnique({where:{id:t.resourceId},include:{delayQuote:{include:{change:true}}}}):null;
   const expectedType=t.kind==='AMENDMENT'?(resource?.delayQuote?.change?.kind==='VEHICLE_CHANGE'?'owner-vehicle-change':'owner-delivery-delay'):'owner-rental-contract';
   templateVerified=!!(template?.type===expectedType&&template.status==='PUBLISHED'&&template.confirmedBy&&template.confirmedAt&&template.version===s.template.version&&hash(template.content)===s.template.hash);
  }
  return{ownerId:t.ownerId,sealId:t.ownerSealId,certificateSerialNo:account?.certSerialNo||'',ownerVerified:t.owner.status==='VERIFIED'&&account?.realNameStatus==='VERIFIED'&&s.lessor?.ownerId===t.ownerId&&s.lessor?.providerCustomerId===account?.providerCustomerId,memberVerified:member?.status==='VERIFIED'&&!!member.verifiedAt&&member.verifiedSerialNo===account?.verificationTransactionNo,certificateValid:account?.certStatus==='BOUND'&&account?.certSerialNo===s.lessor?.certificateSerialNo,sealCurrent:seal?.status==='ACTIVE'&&seal.providerSignatureId===s.lessor?.providerSignatureId&&seal.providerCustomerId===s.lessor?.providerCustomerId&&seal.imageHash===s.lessor?.sealImageHash&&Date.now()-seal.checkedAt.getTime()<86400000,identityCheckedAt:account?.checkedAt,kind:t.kind,vehicleId:s.vehicleId,templateId:s.template?.id,templateVersion:s.template?.version,templateHash:s.template?.hash,templateType:s.template?.type,delegate:s.delegate,documentKind:s.documentKind,vehicleOwnershipApproved,templateVerified,monthlyFeeAmount:s.monthlyFeeAmount,depositAmount:s.depositAmount,months:s.months,customerSigned:t.parties.some((p:any)=>p.role==='CUSTOMER'&&p.status==='SIGNED'&&p.verifiedAt&&p.queryEvidenceHash),reviewed:!!t.reviewedAt&&!!t.reviewedBy,authority:a?{method:a.method,ownerId:a.ownerId,sealId:a.sealId,certificateSerialNo:a.certificateSerialNo,enabled:a.enabled,status:a.status,providerAuthorized:a.method!=='UNILATERAL_LETTER'&&a.status==='AUTHORIZED',providerCheckedAt:a.checkedAt,scope:a.scope}:null};
 }
 private mutable(task:any){ensure(!task.ownerDispatchAt&&!task.parties.some((p:any)=>p.role==='OWNER'&&p.attemptedAt),409,'OWNER_ALREADY_DISPATCHED','本份企业签署请求已发出或结果待核验，请查询原交易');ensure(!['ARCHIVED','REJECTED','EXPIRED','CANCELLED'].includes(task.status),409,'STATE_CONFLICT','当前文件不可发起签署');}
 private manager(task:any,customerId:string){const m=task.owner.members.find((m:any)=>m.customerId===customerId);ensure(m?.status==='VERIFIED'&&task.owner.esignAccount?.managerCustomerId===customerId&&task.owner.status!=='SUSPENDED',403,'OWNER_MEMBER_NOT_VERIFIED','当前企业经办人权限尚未核验');}
 private requireManualEvidence(t:any,facts:SigningFacts){
  ensure(facts.customerSigned,409,'OWNER_CUSTOMER_SIGNATURE_REQUIRED','请先等待客户签署并核验签署结果');
  ensure(t.uploadedAt&&facts.reviewed,409,'OWNER_DOCUMENT_NOT_READY','请先完成文件上传及运营复核');
  ensure(facts.vehicleOwnershipApproved&&facts.templateVerified,409,'OWNER_DOCUMENT_BINDING','车辆归属或已批准合同版本已变化，请联系运营核对');
  ensure(evaluateOwnerSigning(facts).decision!=='BLOCKED',409,'OWNER_NOT_READY','企业身份、证书或本份合同印章已变化，请重新核验');
 }
 async manualReadiness(customerId:string,ownerId:string,id:string){
  const t=await this.load(this.db,id);ensure(t.ownerId===ownerId,404,'NOT_FOUND','本企业合同不存在');const facts=await this.facts(this.db,t),blockers:string[]=[];
  if(['ARCHIVED','REJECTED','EXPIRED','CANCELLED'].includes(t.status))blockers.push('本份文件已结束，不能继续签署');
  if(!facts.customerSigned)blockers.push('等待客户签署并核验签署结果');
  if(!t.uploadedAt||!facts.reviewed)blockers.push('等待运营准备并复核完整合同文件');
  if(!facts.vehicleOwnershipApproved||!facts.templateVerified)blockers.push('车辆归属或已批准合同版本已变化，请联系运营核对');
  if(evaluateOwnerSigning(facts).decision==='BLOCKED')blockers.push('企业身份、证书或本份合同印章已变化，请重新核验');
  if(t.owner.esignAccount?.managerCustomerId!==customerId)blockers.push('请由当前核验法人本人签署');
  if(t.parties.some((p:any)=>p.role==='OWNER'&&p.status==='SIGNED'))blockers.push('本企业已签署，请查询双方签署及归档结果');
  if(t.status==='UNKNOWN'||t.parties.some((p:any)=>p.role==='OWNER'&&p.attemptedAt&&['UNKNOWN','SUBMITTING'].includes(p.status)))blockers.push('原企业签署结果待核验，请先查询原交易');
  if((t.ownerDispatchAt||t.parties.some((p:any)=>p.role==='OWNER'&&p.attemptedAt))&&(t.ownerMode!=='MANUAL'||t.manualBy!==customerId))blockers.push('本份企业签署已发出，请查询原交易');
  if(t.processingUntil&&t.processingUntil>new Date())blockers.push('签署结果正在核验，请稍后查询');
  return{blockers};
 }
 async claimManual(customerId:string,ownerId:string,id:string){
  await this.owners.requireSigningMember(customerId,ownerId);
  return this.db.serial(async tx=>{const t=await this.load(tx,id);ensure(t.ownerId===ownerId,404,'NOT_FOUND','本企业签署任务不存在');await this.newSigningMode(tx,t);this.manager(t,customerId);this.mutable(t);this.requireManualEvidence(t,await this.facts(tx,t));await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});const result=await tx.ownerSigningTask.update({where:{id},data:{ownerMode:'MANUAL',authorityId:null,manualBy:customerId,revision:{increment:1}}});await audit(tx,customerId,'OWNER_TASK_MANUAL','vehicle-owners',ownerId,{taskId:id},'CUSTOMER');return{id:result.id,ownerMode:result.ownerMode};});
 }
 async claimAuto(id:string){
  ensure(process.env.OWNER_AUTO_SIGNING_ENABLED==='true',503,'OWNER_AUTO_DISABLED','自动签署已停用');
  return this.db.serial(async tx=>{const t=await this.load(tx,id);this.mutable(t);ensure(t.ownerMode!=='MANUAL',409,'OWNER_MANUAL_SELECTED','本份文件已选择手动确认');const decision=evaluateOwnerSigning(await this.facts(tx,t));ensure(decision.decision==='AUTO_ALLOWED',409,'OWNER_AUTO_NOT_ALLOWED','本份文件不符合当前自动授权范围');const a=t.owner.authorities.find((a:any)=>!t.authorityId||a.id===t.authorityId);await tx.vehicleOwner.update({where:{id:t.ownerId},data:{revision:{increment:1}}});const result=await tx.ownerSigningTask.update({where:{id},data:{ownerMode:'AUTO',authorityId:a.id,revision:{increment:1}}});return{id:result.id,ownerMode:result.ownerMode};});
 }
 async beginAuto(id:string){ensure(process.env.OWNER_AUTO_SIGNING_ENABLED==='true',503,'OWNER_AUTO_DISABLED','自动签署已停用');return this.begin(id);}
 async beginManual(customerId:string,ownerId:string,id:string){await this.owners.requireSigningMember(customerId,ownerId);return this.begin(id,{customerId,ownerId});}
 async assertManualReentry(customerId:string,ownerId:string,id:string){await this.owners.requireSigningMember(customerId,ownerId);const t=await this.load(this.db,id);ensure(t.ownerId===ownerId&&t.ownerMode==='MANUAL'&&t.manualBy===customerId&&t.ownerDispatchAt&&!['ARCHIVED','REJECTED','EXPIRED','CANCELLED'].includes(t.status),409,'OWNER_ALREADY_DISPATCHED','不能重开本份企业签署');this.manager(t,customerId);this.requireManualEvidence(t,await this.facts(this.db,t));}
 private async begin(id:string,manual?:{customerId:string;ownerId:string}){
  return this.db.serial(async tx=>{
   const t=await this.load(tx,id);await this.newSigningMode(tx,t);this.mutable(t);
   if(manual){ensure(t.ownerId===manual.ownerId,404,'NOT_FOUND','本企业签署任务不存在');this.manager(t,manual.customerId);ensure(t.ownerMode==='MANUAL'&&t.manualBy===manual.customerId,409,'OWNER_MANUAL_REQUIRED','请先将本份文件选择为手动确认');}
   else ensure(t.ownerMode==='AUTO',409,'OWNER_MANUAL_SELECTED','本份文件未选择自动签署');
   const facts=await this.facts(tx,t);if(manual)this.requireManualEvidence(t,facts);const decision=evaluateOwnerSigning(facts);ensure(manual?decision.decision!=='BLOCKED':decision.decision==='AUTO_ALLOWED',409,manual?'OWNER_NOT_READY':'OWNER_AUTO_NOT_ALLOWED','企业身份、证书或当前授权条件未通过核验');
   ensure(t.uploadedAt&&t.reviewedAt&&t.reviewedBy,409,'OWNER_DOCUMENT_NOT_READY','请先完成文件上传及运营复核');
   const party=t.parties.find((p:any)=>p.role==='OWNER');ensure(party&&party.providerCustomerId===t.snapshot.lessor.providerCustomerId&&party.providerSignatureId===t.snapshot.lessor.providerSignatureId,409,'OWNER_PARTY_BINDING','合同签署主体不一致');
   // This row serializes mode selection/disable with the durable dispatch intent.
   await tx.vehicleOwner.update({where:{id:t.ownerId},data:{revision:{increment:1}}});
   const now=new Date();const changed=await tx.ownerSigningTask.updateMany({where:{id,revision:t.revision,ownerMode:manual?'MANUAL':'AUTO',ownerDispatchAt:null},data:{ownerDispatchAt:now,status:'SIGNING',revision:{increment:1}}});ensure(changed.count===1,409,'OWNER_ALREADY_DISPATCHED','企业签署已经发起，请查询原交易');
   await tx.ownerSigningParty.update({where:{id:party.id},data:{status:'SUBMITTING',attemptedAt:now}});await audit(tx,manual?.customerId||'SYSTEM','OWNER_DISPATCH_INTENT','vehicle-owners',t.ownerId,{taskId:id,mode:t.ownerMode,authorityId:t.authorityId},manual?'CUSTOMER':'SYSTEM');
   return{taskId:id,ownerMode:t.ownerMode,providerContractId:t.providerContractId,transactionId:party.transactionId,providerCustomerId:party.providerCustomerId,providerSignatureId:party.providerSignatureId,snapshot:t.snapshot};
  });
 }
}
