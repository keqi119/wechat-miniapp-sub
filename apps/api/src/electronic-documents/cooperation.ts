import {assertNoUnclosedSigning} from './repository';
import {cooperationSourcesInput,V31_COOPERATION_CALENDAR} from '../contract-terms/types';
import {z} from 'zod';
import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {canonicalHash} from '../customers/types';
import {archiveCommand} from '../offline-documents/command';
import {requireSimplePartnerOperator} from '../partners/simple-access';
import type {PartnerActor} from '../partners/types';
import {loadElectronicArchiveProof} from './archive';

const id=z.string().trim().min(1).max(128),text=(n:number)=>z.string().trim().max(n).default('');
const draftInput=z.object({v31Sources:cooperationSourcesInput.optional(),revision:z.number().int().nonnegative(),idempotencyKey:z.string().min(8).max(128),agreementId:id.optional(),status:z.enum(['DRAFT','ACTIVE']),title:text(100),referenceNumber:text(100),fileIds:z.array(id).default([]),vehicleIds:z.array(id).max(500).default([]),partnerRateBps:z.number().int().min(0).max(10000).nullable().optional(),validFrom:z.iso.date().nullable().optional(),validUntil:z.iso.date().nullable().optional(),notes:text(2000),replacements:z.array(z.object({vehicleId:id,agreementId:id,revision:z.number().int().nonnegative()}).strict()).max(500).default([]),documentKind:z.enum(['COOPERATION','COOPERATION_AMENDMENT','COOPERATION_TERMINATION']).optional(),terminationDate:z.iso.date().optional(),terminationReason:z.string().trim().min(1).max(1000).optional()}).strict().refine(v=>!v.validFrom||!v.validUntil||v.validFrom<=v.validUntil,'合作有效期不正确').refine(v=>new Set(v.vehicleIds).size===v.vehicleIds.length&&new Set(v.replacements.map(r=>r.vehicleId)).size===v.replacements.length,'车辆或替换确认重复');
export const electronicCooperationMode=()=>process.env.NEW_ORDER_CONTRACT_MODE==='ELECTRONIC';
export function cooperationContentHash(v:any){return canonicalHash({executionMode:'ELECTRONIC',ownerId:v.ownerId,agreementId:v.agreementId,title:v.title,referenceNumber:v.referenceNumber,vehicleIds:[...v.vehicleIds].sort(),partnerRateBps:v.partnerRateBps??null,validFrom:v.validFrom??null,validUntil:v.validUntil??null,notes:v.notes,electronicTerms:v.electronicTerms});}
export function electronicCooperationMissingFields(v:any){return[...(Number.isInteger(v?.partnerRateBps)?[]:['partnerRateBps']),...(v?.vehicleIds?.length?[]:['vehicleIds'])];}

export async function saveElectronicCooperationDraft(tx:any,actor:PartnerActor,ownerId:string,raw:unknown){
 await requireSimplePartnerOperator(tx,actor);const input=draftInput.parse(raw);
 if(input.v31Sources?.virtualAcceptanceScopeId){const scope=await tx.virtualAcceptanceScope.findUnique({where:{id:input.v31Sources.virtualAcceptanceScopeId},include:{vehicle:true}});ensure(scope&&scope.status==='DRAFT'&&scope.expiresAt>new Date()&&scope.ownerId===ownerId&&input.vehicleIds.length===1&&input.vehicleIds[0]===scope.vehicle?.id&&input.v31Sources.vehicleScopes[0].vehicleId===scope.vehicle.id&&input.partnerRateBps===0,409,'VIRTUAL_SCOPE_MISMATCH','虚拟合作须属于当前指定验收范围');}
 else for(const vehicleId of input.vehicleIds){const v=await tx.vehicle.findUnique({where:{id:vehicleId}});ensure(!v?.virtualAcceptanceScopeId,409,'VIRTUAL_SCOPE_REQUIRED','虚拟车辆不得进入普通合作授权');}
 ensure(input.status==='DRAFT'&&!input.fileIds.length,409,'ELECTRONIC_COOPERATION_REQUIRED','合作协议请保存条款草稿，双方电子签归档后生效');
 const commandKey=`electronic-cooperation:${actor.id}:${ownerId}:${input.idempotencyKey}`;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${commandKey}))`;
 return archiveCommand(tx,actor,ownerId,'ELECTRONIC_COOPERATION_DRAFT',input,async()=>{
  for(const vehicleId of [...input.vehicleIds].sort())await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${vehicleId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id=${ownerId} FOR UPDATE`;
  const owner=await tx.vehicleOwner.findUnique({where:{id:ownerId}});ensure(owner&&owner.status!=='SUSPENDED',409,'PARTNER_SUSPENDED','合作商不存在或已停用');
  let agreement=input.agreementId?await tx.partnerAgreement.findUnique({where:{id:input.agreementId}}):null;
  ensure(!input.agreementId||agreement?.ownerId===ownerId,404,'NOT_FOUND','合作协议不存在');ensure((agreement?.revision||0)===input.revision,409,'REVISION_CONFLICT','合作协议已变化，请刷新');
  if(agreement)await assertNoUnclosedSigning(tx,'PARTNER_AGREEMENT',agreement.id);
  const previous=agreement?.status==='ACTIVE'?await tx.partnerAgreementVersion.findUnique({where:{id:agreement.currentVersionId}}):null;
  if(previous)await requireElectronicCooperationProof(tx,previous);
  const latest=agreement?await tx.partnerAgreementVersion.findFirst({where:{agreementId:agreement.id},orderBy:{version:'desc'},include:{electronicTask:true}}):null;
  ensure(latest?.status!=='SIGNED',409,'ELECTRONIC_COOPERATION_PENDING_EFFECTIVE','已有签后待生效合作约定，请先处理该约定');
  ensure(!latest?.electronicTask||['WITHDRAWN','DECLINED','EXPIRED','RETIRED','ARCHIVED'].includes(latest.electronicTask.status),409,'ELECTRONIC_COOPERATION_IN_PROGRESS','本协议已有待签版本，请先处理原任务');
  const kind=input.documentKind||(previous?'COOPERATION_AMENDMENT':'COOPERATION');
  ensure(previous?kind!=='COOPERATION':kind==='COOPERATION',409,'ELECTRONIC_COOPERATION_SOURCE','合作变更或终止须引用已生效电子合作协议');
  ensure(kind!=='COOPERATION_TERMINATION'||input.terminationDate&&input.terminationReason,409,'ELECTRONIC_COOPERATION_SOURCE','合作终止须填写约定日期及原因');
  ensure(input.replacements.every(r=>input.vehicleIds.includes(r.vehicleId)),400,'VALIDATION','替换确认须属于本次车辆范围');
  for(const vehicleId of input.vehicleIds)ensure(await tx.vehicle.findUnique({where:{id:vehicleId}}),404,'NOT_FOUND','关联车辆不存在');
  if(!agreement)agreement=await tx.partnerAgreement.create({data:{ownerId,createdBy:actor.id}});
  const content={agreementId:agreement.id,ownerId,executionMode:'ELECTRONIC',title:input.title||'车辆合作协议',referenceNumber:input.referenceNumber,vehicleIds:kind==='COOPERATION_TERMINATION'?previous.vehicleIds:[...input.vehicleIds].sort(),partnerRateBps:kind==='COOPERATION_TERMINATION'?previous.partnerRateBps:input.partnerRateBps??null,validFrom:kind==='COOPERATION_TERMINATION'?previous.validFrom:input.validFrom??null,validUntil:kind==='COOPERATION_TERMINATION'?previous.validUntil:input.validUntil??null,notes:input.notes,electronicTerms:{...(input.v31Sources?{v31Sources:input.v31Sources,calendarPolicy:V31_COOPERATION_CALENDAR}:{}),schema:'NINDA_COOPERATION_V1',kind,previousVersionId:previous?.id??null,previousHash:previous?.contentHash??null,replacements:input.replacements,...(kind==='COOPERATION_TERMINATION'?{terminationDate:input.terminationDate,terminationReason:input.terminationReason}:{})}};
  const version=await tx.partnerAgreementVersion.create({data:{...content,version:(latest?.version||0)+1,status:'DRAFT',contentHash:cooperationContentHash(content),createdBy:actor.id}});
  const result=await tx.partnerAgreement.update({where:{id:agreement.id},data:{revision:{increment:1},...(!previous?{status:'DRAFT',currentVersionId:version.id}:{})}});
  await audit(tx,actor.id,'ELECTRONIC_COOPERATION_DRAFT','partner-agreements',agreement.id,{ownerId,versionId:version.id,contentHash:version.contentHash,kind});return{agreement:result,version};
 });
}

export async function assertElectronicCooperationCurrent(tx:any,id:string,expectedHash:string,lock=false){
 const version=await tx.partnerAgreementVersion.findUnique({where:{id}});
 ensure(version?.executionMode==='ELECTRONIC'&&version.contentHash===expectedHash&&cooperationContentHash(version)===expectedHash&&!['VOID','RETIRED','TERMINATED'].includes(version.status),409,'ELECTRONIC_BUSINESS_CHANGED','电子合作协议条款已变化或不再有效');
 if(lock){for(const vehicleId of [...version.vehicleIds].sort())await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${vehicleId} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id=${version.ownerId} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "PartnerAgreement" WHERE id=${version.agreementId} FOR UPDATE`;}
 const [agreement,latest,owner]=await Promise.all([tx.partnerAgreement.findUnique({where:{id:version.agreementId}}),tx.partnerAgreementVersion.findFirst({where:{agreementId:version.agreementId},orderBy:{version:'desc'}}),tx.vehicleOwner.findUnique({where:{id:version.ownerId}})]);
 ensure(agreement?.ownerId===version.ownerId&&latest?.id===version.id&&owner&&owner.status!=='SUSPENDED'&&!['STOPPED','RETIRED'].includes(agreement.status),409,'ELECTRONIC_BUSINESS_CHANGED','合作协议已存在更新版本或已停止');
 const terms=version.electronicTerms;
 if(terms.previousVersionId)ensure(agreement.currentVersionId===terms.previousVersionId&&agreement.status==='ACTIVE'||agreement.currentVersionId===version.id&&version.status==='ACTIVE',409,'ELECTRONIC_BUSINESS_CHANGED','合作变更引用的原协议已变化');
 return{version,agreement,owner};
}
export async function requireElectronicCooperationProof(tx:any,version:any){
 ensure(version?.executionMode==='ELECTRONIC'&&cooperationContentHash(version)===version.contentHash,409,'ELECTRONIC_ARCHIVE_REQUIRED','须使用已核验电子合作协议');
 const task=await tx.electronicSigningTask.findUnique({where:{cooperationVersionId:version.id}}),proof=task?await loadElectronicArchiveProof(tx,task.archiveVersionId):null;
 ensure(proof&&task.ownerId===version.ownerId&&proof.businessHash===version.contentHash&&['COOPERATION','COOPERATION_AMENDMENT'].includes(proof.kind),409,'ELECTRONIC_ARCHIVE_REQUIRED','合作协议须由双方电子签署并归档');return proof;
}
export async function activateElectronicCooperation(tx:any,task:any,now=new Date()){
 const proof=await loadElectronicArchiveProof(tx,task.archiveVersionId);ensure(proof&&proof.taskId===task.id&&proof.businessHash===task.businessHash&&proof.kind===task.kind,409,'ELECTRONIC_ARCHIVE_REQUIRED','合作协议须完成本版双方电子签归档');
 const {version,agreement}=await assertElectronicCooperationCurrent(tx,task.cooperationVersionId,task.businessHash,true);
 ensure(version.ownerId===task.ownerId&&!electronicCooperationMissingFields(version).length,409,'ELECTRONIC_COOPERATION_SOURCE','合作车辆或分润条款不完整');
 if(agreement.currentVersionId===version.id&&version.status==='ACTIVE')return;
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now),effectiveDate=task.kind==='COOPERATION_TERMINATION'?version.electronicTerms.terminationDate:version.validFrom;
 if(effectiveDate&&effectiveDate>today){await tx.partnerAgreementVersion.update({where:{id:version.id},data:{status:'SIGNED'}});return;}
 if(task.kind==='COOPERATION_TERMINATION'){
  await tx.partnerAgreementVersion.update({where:{id:version.id},data:{status:'TERMINATED'}});
  await tx.partnerAgreement.update({where:{id:agreement.id},data:{status:'STOPPED',currentVersionId:version.id,revision:{increment:1}}});
 }else{
  ensure(!version.validUntil||version.validUntil>=today,409,'SIMPLE_AGREEMENT_EXPIRED','签署协议已过期，不能启用新合作');
  for(const vehicleId of version.vehicleIds){
   const binding=await tx.partnerAgreementVehicle.findUnique({where:{vehicleId}}),replacement=version.electronicTerms.replacements.find((r:any)=>r.vehicleId===vehicleId);
   if(replacement)ensure(binding?.agreementId===replacement.agreementId&&binding?.revision===replacement.revision,409,'REVISION_CONFLICT','车辆合作关系已变化，请重新核对协议');
   if(binding&&binding.agreementId!==agreement.id){const previous=await tx.partnerAgreement.findUnique({where:{id:binding.agreementId}});ensure(previous?.status!=='ACTIVE'||replacement,409,'SIMPLE_VEHICLE_CONFLICT','车辆已有其他有效合作协议');}
   const legacy=!binding?await tx.ownerVehicle.findUnique({where:{vehicleId}}):null;ensure(!legacy||legacy.status!=='APPROVED',409,'ELECTRONIC_LEGACY_COOPERATION','请先完成旧测试合作资料退役');
  }
  await tx.partnerAgreementVersion.update({where:{id:version.id},data:{status:'ACTIVE'}});
  await tx.partnerAgreement.update({where:{id:agreement.id},data:{status:'ACTIVE',currentVersionId:version.id,revision:{increment:1}}});
  await tx.vehicleOwner.update({where:{id:version.ownerId},data:{cooperationMode:'SIMPLE'}});
  for(const vehicleId of version.vehicleIds)await tx.partnerAgreementVehicle.upsert({where:{vehicleId},create:{vehicleId,ownerId:version.ownerId,agreementId:agreement.id,agreementVersionId:version.id,assignedBy:task.approvedBy},update:{ownerId:version.ownerId,agreementId:agreement.id,agreementVersionId:version.id,assignedBy:task.approvedBy,assignedAt:new Date(),revision:{increment:1}}});
 }
 await audit(tx,'ELECTRONIC_ARCHIVE','ELECTRONIC_COOPERATION_EFFECTIVE','partner-agreements',agreement.id,{taskId:task.id,versionId:version.id,kind:task.kind,businessHash:task.businessHash},'SYSTEM');
}
export async function reconcileElectronicCooperation(db:any,now=new Date()){
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now);
 const due=await db.$queryRaw`SELECT t.id FROM "ElectronicSigningTask" t JOIN "PartnerAgreementVersion" v ON v.id=t."cooperationVersionId" WHERE t.status='ARCHIVED' AND t."retiredAt" IS NULL AND t."withdrawnAt" IS NULL AND v.status='SIGNED' AND v."executionMode"='ELECTRONIC' AND COALESCE(CASE WHEN t.kind='COOPERATION_TERMINATION' THEN v."electronicTerms"->>'terminationDate' ELSE v."validFrom" END,'0001-01-01') <= ${today} ORDER BY t."updatedAt" ASC LIMIT 20`;
 for(const row of due)try{await db.serial(async(tx:any)=>{await tx.$queryRaw`SELECT id FROM "ElectronicSigningTask" WHERE id=${row.id} FOR UPDATE`;const task=await tx.electronicSigningTask.findUnique({where:{id:row.id}});await activateElectronicCooperation(tx,task,now);});}catch{
  await db.electronicSigningTask.updateMany({where:{id:row.id,status:'ARCHIVED',retiredAt:null},data:{lastErrorCode:'ELECTRONIC_COOPERATION_EFFECTIVE_CONFLICT',revision:{increment:1}}});
 }
}
