import {changeIdentityMaterials} from '../owner-signing/identity-materials';
import {readPartnerEnterpriseVerifications} from './enterprise-verification';
import {enterpriseContractProfileInput} from '../contract-terms/types';
import {ensure} from '../common/errors';
import {z} from 'zod';
import {audit,hash} from '../common/data';
import {archiveCommand} from '../offline-documents/command';
import {requireSimplePartnerOperator} from './simple-access';
import type {PartnerActor} from './types';
import {readableFileName} from '../files/filename';
import {assertNotAssetFiles} from '../files/asset-files';
import {electronicCooperationMode,electronicCooperationMissingFields,saveElectronicCooperationDraft,requireElectronicCooperationProof} from '../electronic-documents/cooperation';

export type SimpleAgreementRange={startDate:string;endDate:string};
export type SimpleAgreementSnapshot={mode:'SIMPLE_AGREEMENT';ownerId:string;agreementId:string;agreementVersionId:string;versionId:string;contentHash:string;title:string;partnerRateBps:number;vehicleId:string;modelId:string|null;modelName:string;plateNumber:string;validFrom:string|null;validUntil:string|null};
const validFile=(file:any)=>!!file?.adminId&&!file.customerId&&['contract','evidence','offline-archive'].includes(file.purpose)&&['application/pdf','image/png','image/jpeg'].includes(file.mimeType)&&/^[a-f0-9]{64}$/.test(file.sha256||'');
const id=z.string().trim().min(1).max(128),command={revision:z.number().int().nonnegative(),idempotencyKey:z.string().min(8).max(128)};
const optionalText=(max:number)=>z.string().trim().max(max).optional().default('');
export const simplePartnerProfileInput=z.object({contractProfile:enterpriseContractProfileInput.optional(),name:z.string().trim().min(1).max(200),subjectType:z.enum(['ENTERPRISE','INDIVIDUAL']).default('ENTERPRISE'),creditCode:z.union([z.string().regex(/^[A-Z0-9]{18}$/),z.literal(''),z.null()]).optional().transform(value=>value||null),address:optionalText(300),contactPhone:z.string().trim().refine(v=>!v||/^[+\d ()-]{5,30}$/.test(v),'联系电话格式不正确').optional().default(''),ordinaryContactPhone:optionalText(30)}).strict().refine(value=>value.subjectType!=='INDIVIDUAL'||value.creditCode===null,'个人主体不能填写企业信用代码');
export const simpleAgreementInput=z.object({...command,agreementId:id.optional(),status:z.enum(['ACTIVE','DRAFT']),title:optionalText(200),referenceNumber:optionalText(100),fileIds:z.array(id).max(30).default([]),vehicleIds:z.array(id).max(500).default([]),partnerRateBps:z.number().int().min(0).max(10000).nullable().optional(),validFrom:z.iso.date().nullable().optional(),validUntil:z.iso.date().nullable().optional(),notes:optionalText(2000),replacements:z.array(z.object({vehicleId:id,agreementId:id,revision:z.number().int().nonnegative()}).strict()).max(500).default([])}).strict().refine(value=>!value.validFrom||!value.validUntil||value.validUntil>=value.validFrom,'协议结束日期不得早于开始日期').refine(value=>new Set(value.fileIds).size===value.fileIds.length&&new Set(value.vehicleIds).size===value.vehicleIds.length&&new Set(value.replacements.map(r=>r.vehicleId)).size===value.replacements.length,'文件、车辆或替换确认不能重复');
export function simpleAgreementMissingFields(version:any):string[]{if(version?.executionMode==='ELECTRONIC')return electronicCooperationMissingFields(version);return[...(!version?.fileIds?.length?['fileIds']:[]),...(version?.partnerRateBps===undefined||version?.partnerRateBps===null?['partnerRateBps']:[]),...(!version?.vehicleIds?.length?['vehicleIds']:[])];}

async function commandRun(tx:any,actor:PartnerActor,ownerId:string,action:string,input:any,operation:()=>Promise<any>){
 await requireSimplePartnerOperator(tx,actor);
 const lockKey=`simple-partner:${actor.id}:${ownerId}:${action}:${input.idempotencyKey}`;
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
 const result=await archiveCommand(tx,actor,`simple-partner:${ownerId}`,action,input,operation);
 await assertNotAssetFiles(tx,[...new Set<string>((result.versions||[]).flatMap((v:any)=>v.fileIds||[]))]);return result;
}
async function ownerRecord(tx:any,ownerId:string,lock=false){
 if(lock)await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id = ${ownerId} FOR UPDATE`;
 const owner=await tx.vehicleOwner.findUnique({where:{id:ownerId}});ensure(owner,404,'NOT_FOUND','合作商不存在');return owner;
}
async function agreementDto(tx:any,agreement:any){
 // displayTitle is presentation only; title/contentHash retain the exact immutable version facts.
 const versions=(await tx.partnerAgreementVersion.findMany({where:{agreementId:agreement.id,ownerId:agreement.ownerId},orderBy:{version:'desc'}})).map((version:any)=>({...version,displayTitle:readableFileName(version.title)})),currentVersion=versions.find((row:any)=>row.id===agreement.currentVersionId)||null,latestVersion=versions[0]||null;
 const ids=[...new Set(versions.flatMap((row:any)=>row.fileIds))];
 await assertNotAssetFiles(tx,ids as string[]);
 const files=await tx.storedFile.findMany({where:{id:{in:ids}},select:{id:true,name:true,mimeType:true,size:true}});
 return{...agreement,currentVersion,latestVersion,versions,files:files.map((file:any)=>({...file,name:readableFileName(file.name)})),missingFields:simpleAgreementMissingFields(latestVersion)};
}
async function registrationFiles(tx:any,actor:PartnerActor,ownerId:string,ids:string[]){
 if(!ids.length)return[];
 const files=await tx.storedFile.findMany({where:{id:{in:ids}}});
 ensure(files.length===ids.length&&files.every(validFile),409,'SIMPLE_AGREEMENT_FILES','协议文件缺失或格式不受支持');
 for(const file of files){
  const references=await tx.partnerAgreementVersion.findMany({where:{fileIds:{has:file.id}},select:{ownerId:true}});
  ensure(references.every((row:any)=>row.ownerId===ownerId)&&((file.adminId===actor.id)||references.some((row:any)=>row.ownerId===ownerId)),403,'SIMPLE_AGREEMENT_FILE_SCOPE','请使用本人上传或本合作商已有的协议文件');
  if(file.purpose==='offline-archive')ensure(await tx.archiveFile.count({where:{fileId:file.id,version:{archive:{ownerId,kind:'OWNER_COOPERATION'}}}}),403,'SIMPLE_AGREEMENT_FILE_SCOPE','历史协议文件须属于本合作商');
 }
 await assertNotAssetFiles(tx,ids);
 return files;
}

/** Call only after the caller has established its admin role or portal company scope. */
export async function readSimpleAgreementFile(tx:any,ownerId:string,agreementId:string,fileId:string){
 const agreement=await tx.partnerAgreement.findFirst({where:{id:agreementId,ownerId}});
 ensure(agreement&&await tx.partnerAgreementVersion.count({where:{agreementId,ownerId,fileIds:{has:fileId}}}),404,'NOT_FOUND','协议文件不存在');
 const file=await tx.storedFile.findUnique({where:{id:fileId}});ensure(file&&validFile(file),404,'NOT_FOUND','协议文件不存在');await assertNotAssetFiles(tx,[fileId]);return file;
}

/** Administrative source registration only; drafts never become effective portal or revenue bindings. */
async function pendingPartnerVehicles(tx:any,owner:any,effectiveVehicleIds:Set<string>){
 if(owner.status==='SUSPENDED')return[];
 const agreements=await tx.partnerAgreement.findMany({where:{ownerId:owner.id,status:'DRAFT'},orderBy:{id:'asc'}}),pending=new Map<string,any>();
 for(const agreement of agreements){
  if(agreement.ownerId!==owner.id||agreement.status!=='DRAFT')continue;
  const [version]=await tx.partnerAgreementVersion.findMany({where:{agreementId:agreement.id},orderBy:{version:'desc'},take:1});
  if(!version||version.ownerId!==owner.id||version.agreementId!==agreement.id||version.status!=='DRAFT')continue;
  for(const vehicleId of new Set<string>(version.vehicleIds||[])){
   if(effectiveVehicleIds.has(vehicleId))continue;
   const row=pending.get(vehicleId)||{ownerId:owner.id,vehicleId,active:false,status:'DRAFT',agreements:[]};
   row.agreements.push({id:agreement.id,versionId:version.id,version:version.version,title:readableFileName(version.title)});pending.set(vehicleId,row);
  }
 }
 const rows=await Promise.all([...pending.values()].map(async row=>({...row,vehicle:await tx.vehicle.findUnique({where:{id:row.vehicleId},select:{id:true,title:true,model:true,brand:true,plateNumber:true,vin:true,status:true}})})));
 return rows.filter(row=>row.vehicle?.id===row.vehicleId).sort((a,b)=>a.vehicleId.localeCompare(b.vehicleId));
}

export class SimpleAgreementService{
 async list(tx:any,actor:PartnerActor){
  await requireSimplePartnerOperator(tx,actor);const owners=await tx.vehicleOwner.findMany({orderBy:{createdAt:'desc'},take:500});
  const verifications=await readPartnerEnterpriseVerifications(tx,owners);
  return Promise.all(owners.map(async(owner:any)=>{const bindings=await tx.partnerAgreementVehicle.findMany({where:{ownerId:owner.id}}),effective=await Promise.all(bindings.map((binding:any)=>readSimpleAgreementSnapshot(tx,binding.vehicleId))),pending=await pendingPartnerVehicles(tx,owner,new Set(effective.filter(Boolean).map((row:any)=>row.vehicleId)));return{...owner,enterpriseVerification:verifications.get(owner.id),agreementCount:await tx.partnerAgreement.count({where:{ownerId:owner.id,status:'ACTIVE'}}),vehicleCount:effective.filter(Boolean).length,pendingVehicleCount:pending.length};}));
 }
 async detail(tx:any,actor:PartnerActor,ownerId:string){
  await requireSimplePartnerOperator(tx,actor);const owner=await ownerRecord(tx,ownerId),agreements=await this.agreements(tx,actor,ownerId),bindings=await tx.partnerAgreementVehicle.findMany({where:{ownerId}});
  const vehicles=await Promise.all(bindings.map(async(binding:any)=>({...binding,vehicle:await tx.vehicle.findUnique({where:{id:binding.vehicleId},include:{modelDefinition:true}}),active:!!await readSimpleAgreementSnapshot(tx,binding.vehicleId)})));
  const assignments=await tx.partnerAgreementVehicle.findMany();
  const vehicleAssignments=await Promise.all(assignments.map(async(binding:any)=>{const [current,version,assignedOwner]=await Promise.all([tx.partnerAgreement.findUnique({where:{id:binding.agreementId}}),tx.partnerAgreementVersion.findUnique({where:{id:binding.agreementVersionId}}),tx.vehicleOwner.findUnique({where:{id:binding.ownerId}})]);return{vehicleId:binding.vehicleId,ownerId:binding.ownerId,ownerName:assignedOwner?.name||'',agreementId:binding.agreementId,agreementTitle:readableFileName(version?.title||''),revision:binding.revision,active:current?.status==='ACTIVE'&&current.currentVersionId===version?.id&&version?.status==='ACTIVE'&&version.vehicleIds.includes(binding.vehicleId)};}));
  const simpleVehicles=new Set(assignments.map((binding:any)=>binding.vehicleId)),legacy=await tx.ownerVehicle.findMany({where:{status:'APPROVED',reviewedBy:{not:null},reviewedAt:{not:null}},include:{owner:true}});
  for(const binding of legacy)if(!simpleVehicles.has(binding.vehicleId)&&binding.owner?.status!=='SUSPENDED')vehicleAssignments.push({vehicleId:binding.vehicleId,ownerId:binding.ownerId,ownerName:binding.owner?.name||'',agreementId:`legacy:${binding.id}`,agreementTitle:'历史有效合作关系',revision:binding.revision,active:true});
  const pendingVehicles=await pendingPartnerVehicles(tx,owner,new Set<string>(vehicles.filter((vehicle:any)=>vehicle.active).map((vehicle:any)=>vehicle.vehicleId)));
  const verifications=await readPartnerEnterpriseVerifications(tx,[owner]);
  return{...owner,authorizationScopeVersion:Number(process.env.OWNER_AUTHORIZATION_SCOPE_VERSION||1),enterpriseVerification:verifications.get(owner.id),agreements,vehicles,vehicleAssignments,pendingVehicles,pendingVehicleCount:pendingVehicles.length,agreementCount:agreements.filter((agreement:any)=>agreement.status==='ACTIVE').length,vehicleCount:vehicles.filter((vehicle:any)=>vehicle.active).length,allowedActions:{electronicCooperation:electronicCooperationMode(),editProfile:true,saveAgreement:owner.status!=='SUSPENDED',manageCompanyAdmin:true}};
 }
 async create(tx:any,actor:PartnerActor,raw:unknown){
  const input=z.object({profile:simplePartnerProfileInput,idempotencyKey:command.idempotencyKey}).strict().parse(raw);
  return commandRun(tx,actor,'NEW','CREATE',input,async()=>{const owner=await tx.vehicleOwner.create({data:{...input.profile,cooperationMode:'SIMPLE',createdBy:actor.id}});await audit(tx,actor.id,'PARTNER_SIMPLE_CREATED','partners',owner.id);return owner;});
 }
 async update(tx:any,actor:PartnerActor,ownerId:string,raw:unknown){
  const input=z.object({...command,profile:simplePartnerProfileInput}).strict().parse(raw);
  return commandRun(tx,actor,ownerId,'PROFILE',input,async()=>{const owner=await ownerRecord(tx,ownerId,true);ensure(owner.revision===input.revision,409,'REVISION_CONFLICT','合作商资料已变化');ensure(owner.subjectType===input.profile.subjectType,409,'PARTNER_SUBJECT_IMMUTABLE','主体类型不能原位修改');await changeIdentityMaterials(tx,actor.id,ownerId,input.profile);const result=await tx.vehicleOwner.update({where:{id:ownerId},data:{...input.profile,revision:{increment:1}}});await audit(tx,actor.id,'PARTNER_SIMPLE_PROFILE','partners',ownerId,{revision:result.revision});return result;});
 }
 async agreements(tx:any,actor:PartnerActor,ownerId:string){await requireSimplePartnerOperator(tx,actor);await ownerRecord(tx,ownerId);const rows=await tx.partnerAgreement.findMany({where:{ownerId},orderBy:{createdAt:'desc'}});return Promise.all(rows.map((row:any)=>agreementDto(tx,row)));}
 async save(tx:any,actor:PartnerActor,ownerId:string,raw:unknown){
  if(electronicCooperationMode()){const result=await saveElectronicCooperationDraft(tx,actor,ownerId,raw);return agreementDto(tx,result.agreement);}
  const input=simpleAgreementInput.parse(raw);
  return commandRun(tx,actor,ownerId,`SAVE:${input.agreementId||'new'}`,input,async()=>{
   // Every registration writer takes vehicle locks in the same order before the owner lock.
   for(const vehicleId of [...input.vehicleIds].sort())await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${vehicleId} FOR UPDATE`;
   const owner=await ownerRecord(tx,ownerId,true);ensure(owner.status!=='SUSPENDED',409,'PARTNER_SUSPENDED','合作商已停用');
   let agreement=input.agreementId?await tx.partnerAgreement.findUnique({where:{id:input.agreementId}}):null;
   ensure(!input.agreementId||agreement?.ownerId===ownerId,404,'NOT_FOUND','合作协议不存在');
   ensure((agreement?.revision||0)===input.revision,409,'REVISION_CONFLICT','合作协议已更新，请刷新');
   const missingFields=simpleAgreementMissingFields(input);ensure(input.status==='DRAFT'||missingFields.length===0,409,'SIMPLE_AGREEMENT_INCOMPLETE','有效协议须有协议文件、明确分润比例和关联车辆');
   const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());ensure(input.status==='DRAFT'||!input.validUntil||input.validUntil>=today,409,'SIMPLE_AGREEMENT_EXPIRED','已过期协议不能登记为当前有效协议');
   const files=await registrationFiles(tx,actor,ownerId,input.fileIds);
   for(const vehicleId of input.vehicleIds){
    ensure(await tx.vehicle.findUnique({where:{id:vehicleId}}),404,'NOT_FOUND','关联车辆不存在');
    if(input.status!=='ACTIVE')continue;
    const binding=await tx.partnerAgreementVehicle.findUnique({where:{vehicleId}}),replacement=input.replacements.find(row=>row.vehicleId===vehicleId);
    const legacy=!binding?await tx.ownerVehicle.findUnique({where:{vehicleId},include:{owner:true}}):null;
    if(replacement)ensure(binding?binding.agreementId===replacement.agreementId&&binding.revision===replacement.revision:legacy&&`legacy:${legacy.id}`===replacement.agreementId&&legacy.revision===replacement.revision,409,'REVISION_CONFLICT','车辆协议关系已变化，请重新确认替换');
    if(legacy?.status==='APPROVED'&&legacy.reviewedBy&&legacy.reviewedAt&&legacy.owner?.status!=='SUSPENDED')ensure(replacement,409,'SIMPLE_VEHICLE_CONFLICT','车辆已有历史有效合作归属，请明确确认替换');
    if(binding&&binding.agreementId!==agreement?.id){
     const existing=await tx.partnerAgreement.findUnique({where:{id:binding.agreementId}}),version=await tx.partnerAgreementVersion.findUnique({where:{id:binding.agreementVersionId}});
     const effective=existing?.status==='ACTIVE'&&existing.currentVersionId===version?.id&&version?.status==='ACTIVE'&&version.vehicleIds.includes(vehicleId)&&(!version.validUntil||version.validUntil>=today);
     ensure(!effective||replacement,409,'SIMPLE_VEHICLE_CONFLICT','车辆已关联其他有效协议，请确认当前关系后明确替换');
    }
   }
   if(!agreement)agreement=await tx.partnerAgreement.create({data:{ownerId,createdBy:actor.id}});
   const latest=await tx.partnerAgreementVersion.findFirst({where:{agreementId:agreement.id},orderBy:{version:'desc'}});
   const content={status:input.status,title:input.title||readableFileName(files[0]?.name||''),referenceNumber:input.referenceNumber,fileIds:input.fileIds,vehicleIds:input.vehicleIds,partnerRateBps:input.partnerRateBps??null,validFrom:input.validFrom||null,validUntil:input.validUntil||null,notes:input.notes};
   const version=await tx.partnerAgreementVersion.create({data:{agreementId:agreement.id,ownerId,version:(latest?.version||0)+1,...content,contentHash:hash({...content,fileHashes:input.fileIds.map(fileId=>({fileId,sha256:files.find((f:any)=>f.id===fileId)?.sha256}))}),createdBy:actor.id}});
   const preserveActive=input.status==='DRAFT'&&agreement.status==='ACTIVE';
   const result=await tx.partnerAgreement.update({where:{id:agreement.id},data:{revision:{increment:1},...(!preserveActive?{status:input.status,currentVersionId:version.id}:{})}});
   if(input.status==='ACTIVE'){
    await tx.vehicleOwner.update({where:{id:ownerId},data:{cooperationMode:'SIMPLE'}});
    for(const vehicleId of input.vehicleIds)await tx.partnerAgreementVehicle.upsert({where:{vehicleId},create:{vehicleId,ownerId,agreementId:agreement.id,agreementVersionId:version.id,assignedBy:actor.id},update:{ownerId,agreementId:agreement.id,agreementVersionId:version.id,assignedBy:actor.id,assignedAt:new Date(),revision:{increment:1}}});
    // Removed rows retain their last version as an invalid assignment and an ABA-safe revision.
   }
   await audit(tx,actor.id,'PARTNER_SIMPLE_AGREEMENT_SAVE','partner-agreements',agreement.id,{ownerId,versionId:version.id,status:input.status,replacements:input.replacements});return agreementDto(tx,result);
  });
 }
 async stop(tx:any,actor:PartnerActor,ownerId:string,agreementId:string,raw:unknown){
  ensure(!electronicCooperationMode(),409,'ELECTRONIC_COOPERATION_REQUIRED','合作终止请先准备双方电子终止协议');
  const input=z.object(command).strict().parse(raw);return commandRun(tx,actor,ownerId,`STOP:${agreementId}`,input,async()=>{await ownerRecord(tx,ownerId,true);const agreement=await tx.partnerAgreement.findUnique({where:{id:agreementId}});ensure(agreement?.ownerId===ownerId,404,'NOT_FOUND','合作协议不存在');ensure(agreement.revision===input.revision,409,'REVISION_CONFLICT','合作协议已变化');const result=await tx.partnerAgreement.update({where:{id:agreementId},data:{status:'STOPPED',revision:{increment:1}}});await audit(tx,actor.id,'PARTNER_SIMPLE_AGREEMENT_STOP','partner-agreements',agreementId,{ownerId});return agreementDto(tx,result);});
 }
 readFile(tx:any,ownerId:string,agreementId:string,fileId:string){return readSimpleAgreementFile(tx,ownerId,agreementId,fileId);}
}

/** Pure reads: an invalid or stopped simple assignment must never reactivate legacy approvals. */
export async function hasSimpleAgreementScope(tx:any,vehicleId:string){
 if(await tx.partnerAgreementVehicle?.findUnique({where:{vehicleId}}))return true;
 const binding=await tx.ownerVehicle?.findUnique({where:{vehicleId}});
 return !!binding&&(await tx.vehicleOwner.findUnique({where:{id:binding.ownerId}}))?.cooperationMode==='SIMPLE';
}

/** Paper orders keep their frozen source; new electronic business also rechecks a historical source's current binding. */
export async function requireFrozenSimpleAgreement(tx:any,vehicleId:string,lessor:any,revenue:any,range:SimpleAgreementRange){
 const version=typeof lessor.agreementVersionId==='string'?await tx.partnerAgreementVersion.findUnique({where:{id:lessor.agreementVersionId}}):null;
 ensure(lessor.version===4&&lessor.mode==='SIMPLE_AGREEMENT'&&version?.status==='ACTIVE'&&version.ownerId===lessor.ownerId&&version.agreementId===lessor.agreementId&&version.contentHash===lessor.agreementHash&&version.vehicleIds.includes(vehicleId)&&version.partnerRateBps===lessor.partnerRateBps&&revenue?.mode==='SIMPLE_AGREEMENT'&&revenue.ownerId===version.ownerId&&revenue.vehicleId===vehicleId&&revenue.agreementId===version.agreementId&&revenue.agreementVersionId===version.id&&revenue.versionId===version.id&&revenue.contentHash===version.contentHash&&revenue.partnerRateBps===version.partnerRateBps&&Number.isInteger(version.partnerRateBps)&&version.partnerRateBps>=0&&version.partnerRateBps<=10000&&(!version.validFrom||version.validFrom<=range.startDate)&&(!version.validUntil||version.validUntil>=range.endDate),409,'SIMPLE_AGREEMENT_SNAPSHOT_MISMATCH','订单冻结的合作协议或比例凭据不一致');
 if(version.executionMode==='ELECTRONIC'){await requireElectronicCooperationProof(tx,version);return version;}
 const files=await tx.storedFile.findMany({where:{id:{in:version.fileIds}}});ensure(version.fileIds.length>0&&files.length===version.fileIds.length&&files.every(validFile),409,'SIMPLE_AGREEMENT_FILES','订单冻结的合作协议文件缺失');
 await assertNotAssetFiles(tx,version.fileIds);
 if(lessor.executionMode==='ELECTRONIC'){
  const [current,binding]=await Promise.all([readSimpleAgreementSnapshot(tx,vehicleId,range),tx.partnerAgreementVehicle.findUnique({where:{vehicleId}})]);
  ensure(current&&current.ownerId===version.ownerId&&current.agreementVersionId===version.id&&current.contentHash===version.contentHash&&binding?.revision===lessor.bindingRevision,409,'SIMPLE_AGREEMENT_SNAPSHOT_MISMATCH','当前有效合作协议或车辆关联与订单冻结来源不一致');
 }
 return version;
}

export async function readSimpleAgreementSnapshot(tx:any,vehicleId:string,range?:SimpleAgreementRange):Promise<SimpleAgreementSnapshot|null>{
 const binding=await tx.partnerAgreementVehicle?.findUnique({where:{vehicleId}});if(!binding)return null;
 const [agreement,version,owner,vehicle]=await Promise.all([
  tx.partnerAgreement.findUnique({where:{id:binding.agreementId}}),tx.partnerAgreementVersion.findUnique({where:{id:binding.agreementVersionId}}),
  tx.vehicleOwner.findUnique({where:{id:binding.ownerId}}),tx.vehicle.findUnique({where:{id:vehicleId},include:{modelDefinition:true}})
 ]);
 if(!owner||owner.status==='SUSPENDED'||!vehicle||agreement?.status!=='ACTIVE'||agreement.ownerId!==owner.id||agreement.currentVersionId!==version?.id||version?.status!=='ACTIVE'||version.agreementId!==agreement.id||version.ownerId!==owner.id||!version.vehicleIds.includes(vehicleId)||!Number.isInteger(version.partnerRateBps)||version.partnerRateBps<0||version.partnerRateBps>10000)return null;
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()),start=range?.startDate||today,end=range?.endDate||today;
 if(version.validFrom&&version.validFrom>start||version.validUntil&&version.validUntil<end)return null;
 if(version.executionMode==='ELECTRONIC'){try{await requireElectronicCooperationProof(tx,version);}catch{return null;}}
 else{if(!version.fileIds.length)return null;const files=await tx.storedFile.findMany({where:{id:{in:version.fileIds}}});if(files.length!==version.fileIds.length||!files.every(validFile))return null;await assertNotAssetFiles(tx,version.fileIds);}
 return{mode:'SIMPLE_AGREEMENT',ownerId:owner.id,agreementId:agreement.id,agreementVersionId:version.id,versionId:version.id,contentHash:version.contentHash,title:version.title,partnerRateBps:version.partnerRateBps,vehicleId,modelId:vehicle.modelDefinitionId||null,modelName:vehicle.modelDefinition?.name||vehicle.model||vehicle.title,plateNumber:vehicle.plateNumber||'',validFrom:version.validFrom||null,validUntil:version.validUntil||null};
}
