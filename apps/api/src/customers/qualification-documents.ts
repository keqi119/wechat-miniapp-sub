import {z} from 'zod';
import {audit,key} from '../common/data';
import {ensure} from '../common/errors';
import {archiveCommand} from '../offline-documents/command';
import {assertNotAssetFiles} from '../files/asset-files';
import {saveFile,validMime} from '../files/storage';
import {profileFileMeta,profileRevision,validProfileFile} from './profile';
import {qualificationSlots} from './qualification-profile';
import {requireRiskOperator,type ReviewActor} from './types';

type Documents={identityFrontFileId:string;identityBackFileId:string;drivingLicenseFileId:string};
export const qualificationFileInput=z.object({idempotencyKey:key}).strict();
export async function uploadQualificationFile(db:any,actor:ReviewActor,customerId:string,raw:unknown,file:Express.Multer.File){
 const input=qualificationFileInput.parse(raw);
 ensure(file&&Buffer.isBuffer(file.buffer)&&file.buffer.length>0&&file.buffer.length<=10*1024*1024&&file.size===file.buffer.length&&validMime(file.buffer,file.mimetype),400,'FILE_TYPE','请上传10MiB以内内容有效的PDF、JPEG或PNG证件');
 const authorize=async(tx:any,lock=false)=>{await requireRiskOperator(tx,actor);if(lock)await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${customerId} FOR UPDATE`;ensure(await tx.customer.findUnique({where:{id:customerId}}),404,'NOT_FOUND','客户不存在');};
 await db.serial((tx:any)=>authorize(tx));
 const stored=await saveFile(file),command={...input,name:stored.name,mimeType:stored.mimeType,size:stored.size,sha256:stored.sha256};
 return db.serial(async(tx:any)=>{await authorize(tx,true);return archiveCommand(tx,actor,`customer-qualification-file:${customerId}`,'UPLOAD',command,async()=>{
  const created=await tx.storedFile.create({data:{...stored,purpose:'identity',customerId,adminId:actor.id}});
  await audit(tx,actor.id,'QUALIFICATION_FILE_UPLOADED','customers',customerId,{fileId:created.id,sha256:created.sha256});
  return profileFileMeta(created,`/api/admin/files/${encodeURIComponent(created.id)}`);
 });});
}
/** Caller holds the customer lock and has checked the submitted pre-change profile hash. */
export async function replaceQualificationDocuments(tx:any,actor:ReviewActor,customer:any,documents:Documents){
 const ids=qualificationSlots.map(slot=>documents[`${slot}FileId`]);
 ensure(new Set(ids).size===3,400,'PROFILE_DOCUMENT_DUPLICATE','身份证正反面和驾驶证须分别选择不同附件');
 const files=await tx.storedFile.findMany({where:{id:{in:ids}}});
 ensure(files.length===ids.length&&files.every((file:any)=>validProfileFile(file,customer.id)),403,'PROFILE_FILE_INVALID','证件附件须属于当前客户且为有效图片或PDF');
 await assertNotAssetFiles(tx,ids);
 const oldIds=qualificationSlots.map(slot=>customer.profile?.[`${slot}FileId`]).filter(Boolean),oldFiles=oldIds.length?await tx.storedFile.findMany({where:{id:{in:oldIds}}}):[];
 const next={...(customer.profile&&typeof customer.profile==='object'&&!Array.isArray(customer.profile)?customer.profile:{}),...documents};
 for(const slot of qualificationSlots){const field=`${slot}FileId`,old=oldFiles.find((f:any)=>f.id===customer.profile?.[field]),fresh=files.find((f:any)=>f.id===next[field]);
  if(old&&fresh&&validProfileFile(old,customer.id)&&old.sha256===fresh.sha256&&old.mimeType===fresh.mimeType&&old.size===fresh.size){await assertNotAssetFiles(tx,[old.id]);next[field]=old.id;}
 }
 ensure(new Set(qualificationSlots.map(slot=>next[`${slot}FileId`])).size===3,400,'PROFILE_DOCUMENT_DUPLICATE','身份证正反面和驾驶证须分别选择不同附件');
 if(qualificationSlots.every(slot=>customer.profile?.[`${slot}FileId`]===next[`${slot}FileId`]))return customer;
 const previousRevision=profileRevision(customer);next.revision=previousRevision+1;
 const saved=await tx.customer.update({where:{id:customer.id},data:{profile:next}});
 await audit(tx,actor.id,'QUALIFICATION_PROFILE_UPDATED','customers',customer.id,{previousRevision,revision:next.revision,documents:Object.fromEntries(qualificationSlots.map(slot=>[slot,next[`${slot}FileId`]]))});
 return saved;
}
