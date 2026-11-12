import {canonicalHash} from './types';
import {ensure} from '../common/errors';
import {assertNotAssetFiles} from '../files/asset-files';
import {z} from 'zod';
export const qualificationSlots=['identityFront','identityBack','drivingLicense'] as const;
type Slot=typeof qualificationSlots[number];
export type QualificationProfile={version:1;profileHash:string;scalarHash:string;documents:Record<Slot,{id:string;sha256:string}|null>};
export type RecheckReason={code:string;message:string};
const digest=z.string().regex(/^[a-f0-9]{64}$/),document=z.object({id:z.string().min(1),sha256:digest}).strict().nullable();
const snapshotSchema=z.object({version:z.literal(1),profileHash:digest,scalarHash:digest,documents:z.object({identityFront:document,identityBack:document,drivingLicense:document}).strict()}).strict();
export function parseQualificationProfile(value:unknown):QualificationProfile|null{const parsed=snapshotSchema.safeParse(value);return parsed.success?parsed.data:null;}
export function assertQualificationDocuments(record:any,snapshot:QualificationProfile){
 const missing=qualificationSlots.some(slot=>{const file=snapshot.documents[slot];return file&&!(slot==='drivingLicense'?record.drivingLicenseFileIds:record.identityFileIds)?.includes(file.id);});
 ensure(!missing,409,'QUALIFICATION_DOCUMENTS_CHANGED','资格材料须包含当前分类的身份证正反面及驾驶证，请沿用当前证件重新提交');
}
export function rawProfileHash(c:any){return canonicalHash({id:c.id,name:c.name,mobile:c.mobile,drivingYears:c.drivingYears,profile:c.profile,legalIdentityFileId:c.legalIdentityFileId});}
function scalarHash(c:any){const profile={...(c.profile||{})};delete profile.revision;for(const slot of qualificationSlots)delete profile[slot+'FileId'];return canonicalHash({id:c.id,name:c.name,mobile:c.mobile,drivingYears:c.drivingYears,legalIdentityFileId:c.legalIdentityFileId,profile});}
export async function captureQualificationProfile(tx:any,c:any):Promise<QualificationProfile>{
 const ids=qualificationSlots.map(s=>c.profile?.[s+'FileId']).filter(Boolean);
 ensure(ids.every(id=>typeof id==='string')&&new Set(ids).size===ids.length,409,'QUALIFICATION_MATERIALS_REQUIRED','当前分类证件附件重复或无效');
 const files=ids.length?await tx.storedFile.findMany({where:{id:{in:ids}}}):[];
 ensure(files.length===ids.length&&files.every((f:any)=>f.customerId===c.id&&['identity','profile','evidence'].includes(f.purpose)&&['image/jpeg','image/png','application/pdf'].includes(f.mimeType)&&/^[a-f0-9]{64}$/.test(f.sha256)),409,'QUALIFICATION_MATERIALS_REQUIRED','当前分类证件缺失或不属于本客户');
 await assertNotAssetFiles(tx,ids);
 const documents=Object.fromEntries(qualificationSlots.map(s=>{const f=files.find((f:any)=>f.id===c.profile?.[s+'FileId']);return[s,f?{id:f.id,sha256:f.sha256}:null];})) as QualificationProfile['documents'];
 return{version:1,profileHash:rawProfileHash(c),scalarHash:scalarHash(c),documents};
}
export function profileContentHash(p:QualificationProfile){return canonicalHash({scalarHash:p.scalarHash,documents:Object.fromEntries(qualificationSlots.map(s=>[s,p.documents[s]?.sha256||null]))});}
/** An old snapshot is usable only if reconstructing its original profile proves the stored qualification hash. */
export async function legacyQualificationProfile(tx:any,c:any,q:any):Promise<QualificationProfile|null>{
 const [orders,apps]=await Promise.all([
  tx.order.findMany({where:{customerId:c.id,finalPlanSnapshot:{path:['customerProfileSnapshot','profileHash'],equals:q.profileHash}},select:{finalPlanSnapshot:true},take:10}),
  tx.application.findMany({where:{customerId:c.id,profile:{path:['customerProfileSnapshot','profileHash'],equals:q.profileHash}},select:{profile:true},take:10})
 ]);
 const snapshots=[...orders.map((o:any)=>o.finalPlanSnapshot?.customerProfileSnapshot),...apps.map((a:any)=>a.profile?.customerProfileSnapshot)];
 for(const s of snapshots){
  if(s?.profileHash!==q.profileHash||!Number.isInteger(s.profileRevision)||!qualificationSlots.every(k=>s.documents?.[k]?.id&&s.documents[k].sha256))continue;
  const candidate={...c,name:s.name,mobile:s.mobile,drivingYears:s.drivingYears,profile:{...c.profile,revision:s.profileRevision,...Object.fromEntries(qualificationSlots.map(k=>[k+'FileId',s.documents[k].id]))}};
  if(rawProfileHash(candidate)!==q.profileHash)continue;
  const p=await captureQualificationProfile(tx,candidate);
  if(qualificationSlots.every(k=>p.documents[k]?.sha256===s.documents[k].sha256))return p;
 }
 return null;
}
export async function qualificationProfileReasons(tx:any,c:any,q:any):Promise<RecheckReason[]>{
 if(!q.profileSnapshot&&q.profileHash===rawProfileHash(c))return[];
 const baseline:QualificationProfile|null=q.profileSnapshot?parseQualificationProfile(q.profileSnapshot):await legacyQualificationProfile(tx,c,q);
 if(!baseline||baseline.version!==1||baseline.profileHash!==q.profileHash)return[{code:'PROFILE_BASELINE_MISSING',message:'当前资料已更新，原审核缺少可比对依据，请核对并提交新资格资料'}];
 const current=await captureQualificationProfile(tx,c),reasons:RecheckReason[]=[];
 if(baseline.scalarHash!==current.scalarHash)reasons.push({code:'IDENTITY_FIELDS_CHANGED',message:'姓名、手机号、驾龄或其他身份资料已变化，请重新核对签约主体'});
 if(['identityFront','identityBack'].some(k=>baseline.documents[k as Slot]?.sha256!==current.documents[k as Slot]?.sha256))reasons.push({code:'IDENTITY_DOCUMENT_CHANGED',message:'身份证附件内容已更新，请核对新资料并提交审核'});
 if(baseline.documents.drivingLicense?.sha256!==current.documents.drivingLicense?.sha256)reasons.push({code:'DRIVING_DOCUMENT_CHANGED',message:'驾驶证附件内容已更新，请核对新资料并提交审核'});
 return reasons;
}
