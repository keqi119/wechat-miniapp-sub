import {z} from 'zod';
import {audit,key} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {archiveCommand} from '../offline-documents/command';
import {canonicalHash} from '../customers/types';
import {readableFileName} from '../files/filename';

const clean=(max:number)=>z.string().max(max).refine(v=>!v.includes('\0'),'文本包含非法字符');
const label=clean(200).transform(v=>v.trim()).pipe(z.string().min(1));
export const revision=z.number().int().min(0).max(2147483647);
export const imageIds=z.array(z.string().min(1).max(200)).max(20).refine(ids=>new Set(ids).size===ids.length,'图片不得重复');
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00.000Z');return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===v;},'检测日期无效');
const content={title:label,provider:label.nullable(),inspectedAt:date.nullable(),description:clean(10000),imageFileIds:imageIds};
const input=z.object({...content,revision,idempotencyKey:key}).strict().refine(v=>v.description.trim().length>0||v.imageFileIds.length>0,'请录入文字或检测图片');
export const inspectionSelectionsInput=z.array(z.object({id:z.string().min(1).max(200),revision}).strict()).max(20).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length,'查验记录不得重复');
const snapshotInput=z.object({schemaVersion:z.literal(1),sourceId:z.string().min(1),sourceRevision:revision,vehicleId:z.string().min(1),title:label,provider:label.nullable(),inspectedAt:date.nullable(),description:clean(10000),images:z.array(z.object({fileId:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(20),snapshotHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export async function authorizeWorkspace(tx:any,actor:any,write=false){
 ensure(actor&&Number.isInteger(actor.authVersion),403,'STAFF_SESSION_CHANGED','人员权限已变化，请重新登录');
 const staff=await requireCurrentStaff(tx,actor,'vehicles',write);
 ensure(['ADMIN','OPERATIONS'].includes(staff.role),403,'FORBIDDEN','仅管理员和运营可访问车辆查验资料');
}
export async function workspaceVehicle(tx:any,id:string){const v=await tx.vehicle.findUnique({where:{id}});ensure(v&&v.id===id,404,'NOT_FOUND','车辆不存在');return v;}
export async function workspaceCommand(tx:any,actor:any,vehicleId:string,resource:string,action:string,body:any,operation:()=>Promise<any>){
 await authorizeWorkspace(tx,actor,true);
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.id}:${resource}:${action}:${body.idempotencyKey}`},0))`;
 await workspaceVehicle(tx,vehicleId);
 return archiveCommand(tx,actor,resource,action,body,operation);
}
export async function assertNotInspectionFiles(tx:any,ids:string[]){
 if(!ids.length)return;
 ensure(!await tx.vehicleInspectionFile.count({where:{fileId:{in:ids}}})&&!await tx.storedFile.count({where:{id:{in:ids},purpose:'vehicle-inspection'}}),403,'VEHICLE_INSPECTION_ROUTE_REQUIRED','请从所属车辆查验资料读取文件');
}
export function validateInspectionBinding(binding:any,vehicleId:string){
 const f=binding?.file;
 ensure(binding&&binding.vehicleId===vehicleId&&f&&f.id===binding.fileId&&f.purpose==='vehicle-inspection'&&f.customerId===null&&!f.fieldTaskId&&typeof f.adminId==='string'&&f.adminId.length>0&&binding.uploadedBy===f.adminId&&binding.sha256===f.sha256&&/^[a-f0-9]{64}$/.test(f.sha256)&&['image/png','image/jpeg'].includes(f.mimeType)&&Number.isInteger(f.size)&&f.size>0&&f.size<=10*1024*1024,409,'INSPECTION_FILE_INVALID','查验图片归属、用途或摘要无效');
 return f;
}
export async function requireInspectionFiles(tx:any,vehicleId:string,ids:string[]){
 imageIds.parse(ids);if(!ids.length)return[];
 const rows=await tx.vehicleInspectionFile.findMany({where:{fileId:{in:ids}},include:{file:true}});
 ensure(rows.length===ids.length,409,'INSPECTION_FILE_INVALID','图片不存在或不属于该车辆');
 ensure(!await tx.vehicleDocumentFile.count({where:{fileId:{in:ids}}})&&!await tx.assetPrivateFile.count({where:{fileId:{in:ids}}}),409,'INSPECTION_FILE_INVALID','私密原件不能作为查验展示图片');
 return ids.map(id=>validateInspectionBinding(rows.find((r:any)=>r.fileId===id),vehicleId));
}
export function inspectionFileView(file:any,vehicleId:string){return{id:file.id,name:readableFileName(file.name),mimeType:file.mimeType,size:file.size,sha256:file.sha256,createdAt:file.createdAt,url:`/api/admin/vehicles/${encodeURIComponent(vehicleId)}/inspection-files/${encodeURIComponent(file.id)}`};}
async function view(tx:any,row:any){return{id:row.id,vehicleId:row.vehicleId,revision:row.revision,title:row.title,provider:row.provider,inspectedAt:row.inspectedAt,description:row.description,imageFileIds:row.imageFileIds,images:(await requireInspectionFiles(tx,row.vehicleId,row.imageFileIds)).map(f=>inspectionFileView(f,row.vehicleId)),createdAt:row.createdAt,updatedAt:row.updatedAt};}
export class InspectionService{
 async list(tx:any,actor:any,vehicleId:string){await authorizeWorkspace(tx,actor);await workspaceVehicle(tx,vehicleId);const rows=await tx.vehicleInspection.findMany({where:{vehicleId},orderBy:[{createdAt:'desc'},{id:'asc'}]});return{vehicleId,items:await Promise.all(rows.map((r:any)=>view(tx,r)))};}
 async create(tx:any,actor:any,vehicleId:string,raw:unknown){const body=input.parse(raw);ensure(body.revision===0,409,'REVISION_CONFLICT','新建查验记录版本应为0');return workspaceCommand(tx,actor,vehicleId,`inspection:${vehicleId}:NEW`,'INSPECTION_CREATE',body,async()=>{
  await requireInspectionFiles(tx,vehicleId,body.imageFileIds);const{revision:_,idempotencyKey:__,...data}=body;
  const row=await tx.vehicleInspection.create({data:{...data,vehicleId,createdBy:actor.id,updatedBy:actor.id}});await audit(tx,actor.id,'INSPECTION_CREATE','vehicles',vehicleId,{inspectionId:row.id,revision:0,contentHash:canonicalHash(data)});return view(tx,row);
 });}
 async update(tx:any,actor:any,vehicleId:string,id:string,raw:unknown){const body=input.parse(raw);return workspaceCommand(tx,actor,vehicleId,`inspection:${vehicleId}:${id}`,'INSPECTION_UPDATE',body,async()=>{
  await tx.$queryRaw`SELECT id FROM "VehicleInspection" WHERE id=${id} FOR UPDATE`;
  const row=await tx.vehicleInspection.findUnique({where:{id}});ensure(row?.vehicleId===vehicleId,404,'NOT_FOUND','查验记录不存在');ensure(row.revision===body.revision,409,'REVISION_CONFLICT','查验记录已变化，请刷新后核对');
  await requireInspectionFiles(tx,vehicleId,body.imageFileIds);const{revision:_,idempotencyKey:__,...data}=body;
  const changed=await tx.vehicleInspection.updateMany({where:{id,vehicleId,revision:body.revision},data:{...data,revision:{increment:1},updatedBy:actor.id}});ensure(changed.count===1,409,'REVISION_CONFLICT','查验记录已变化');await audit(tx,actor.id,'INSPECTION_UPDATE','vehicles',vehicleId,{inspectionId:id,revision:body.revision+1,contentHash:canonicalHash(data)});return view(tx,await tx.vehicleInspection.findUnique({where:{id}}));
 });}
}
export async function buildInspectionSnapshots(tx:any,vehicleId:string,raw:unknown){
 const selections=inspectionSelectionsInput.parse(raw),result:any[]=[];
 for(const selection of selections){
  const row=await tx.vehicleInspection.findUnique({where:{id:selection.id}});ensure(row?.vehicleId===vehicleId,409,'INSPECTION_SOURCE_INVALID','查验记录不属于本商品车辆');ensure(row.revision===selection.revision,409,'REVISION_CONFLICT','查验记录已变化，请重新核对');
  const files=await requireInspectionFiles(tx,vehicleId,row.imageFileIds);
  const value={schemaVersion:1,sourceId:row.id,sourceRevision:row.revision,vehicleId,title:row.title,provider:row.provider,inspectedAt:row.inspectedAt,description:row.description,images:files.map(f=>({fileId:f.id,sha256:f.sha256}))};
  result.push(snapshotInput.parse({...value,snapshotHash:canonicalHash(value)}));
 }return result;
}
export function readInspectionSnapshots(raw:unknown,vehicleId:string){
 const snapshots=z.array(snapshotInput).max(20).parse(raw??[]);ensure(new Set(snapshots.map(s=>s.sourceId)).size===snapshots.length,409,'INSPECTION_SNAPSHOT_INVALID','查验快照重复');
 for(const snapshot of snapshots){const{snapshotHash,...value}=snapshot;ensure(snapshot.vehicleId===vehicleId&&canonicalHash(value)===snapshotHash&&new Set(snapshot.images.map(f=>f.fileId)).size===snapshot.images.length,409,'INSPECTION_SNAPSHOT_INVALID','查验快照无效');}
 return snapshots;
}
export function inspectionSnapshotViews(raw:unknown,listingId:string,vehicleId:string){return readInspectionSnapshots(raw,vehicleId).map(s=>({id:s.sourceId,title:s.title,provider:s.provider,inspectedAt:s.inspectedAt,description:s.description,images:s.images.map(f=>`/api/public/goods/${encodeURIComponent(listingId)}/inspection-images/${encodeURIComponent(f.fileId)}`)}));}
export async function publicInspectionViews(tx:any,listing:any,vehicleId:string){
 const snapshots=readInspectionSnapshots(listing.inspectionSnapshots,vehicleId);
 for(const s of snapshots){const files=await requireInspectionFiles(tx,vehicleId,s.images.map(f=>f.fileId));ensure(files.every((f,i)=>f.sha256===s.images[i].sha256),409,'INSPECTION_SNAPSHOT_INVALID','查验图片摘要变化');}
 return inspectionSnapshotViews(snapshots,listing.id,vehicleId);
}
