import {z} from 'zod';
import {audit,key} from '../common/data';
import {ensure} from '../common/errors';
import {archiveCommand} from '../offline-documents/command';
import {readableFileName} from '../files/filename';
import {readCustomerIdentityEvidence,readCustomerIdentityDisplay} from '../esign/customer-identity';
import {customerProfileHash} from './qualifications';
import {canonicalHash} from './types';
import {customerIdentityPolicy} from './identity-policy';
import {assertNotAssetFiles} from '../files/asset-files';

export const profileSlots=['identityFront','identityBack','drivingLicense'] as const;
export type ProfileSlot=typeof profileSlots[number];
export type ProfileFileMeta={id:string;name:string;mimeType:string;size:number;url:string};
export const profileInput=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key,name:z.string().trim().max(40),drivingYears:z.number().int().min(0).max(70),identityFrontFileId:z.string().min(1).nullable().optional(),identityBackFileId:z.string().min(1).nullable().optional(),drivingLicenseFileId:z.string().min(1).nullable().optional()}).strict();
const digest=z.string().regex(/^[a-f0-9]{64}$/),document=z.object({id:z.string().min(1),sha256:digest}).strict();
const profileSnapshotFields={captureStage:z.enum(['APPLICATION_SUBMISSION','APPLICATION_AMENDMENT','ORDER_CONFIRMATION']),capturedAt:z.string().datetime(),profileRevision:z.number().int().nonnegative(),profileHash:digest,name:z.string().trim().min(1).max(40),mobile:z.string().min(1),drivingYears:z.number().int().min(0).max(70),documents:z.object({identityFront:document,identityBack:document,drivingLicense:document}).strict()};
export const customerProfileSnapshotSchema=z.discriminatedUnion('version',[
 z.object({...profileSnapshotFields,version:z.literal(1),identity:z.object({provider:z.literal('FADADA'),identityVersion:z.number().int().positive(),verifiedAt:z.string().datetime(),identityHash:digest}).strict()}).strict(),
 z.object({...profileSnapshotFields,version:z.literal(2),identityPolicy:z.literal('MANUAL_REVIEW'),identity:z.null()}).strict(),
 z.object({...profileSnapshotFields,version:z.literal(3),identityPolicy:z.literal('SIGNING_REQUIRED'),identity:z.null()}).strict()
]);
export type CustomerProfileSnapshot=z.infer<typeof customerProfileSnapshotSchema>;
export function profileRevision(customer:any){return Number.isSafeInteger(customer.profile?.revision)&&customer.profile.revision>=0?customer.profile.revision:0;}
export function validProfileFile(file:any,customerId:string){return !!file&&file.customerId===customerId&&['identity','profile','evidence'].includes(file.purpose)&&['image/png','image/jpeg','application/pdf'].includes(file.mimeType)&&/^[a-f0-9]{64}$/.test(file.sha256);}
export function profileFileMeta(file:any,url:string):ProfileFileMeta{return{id:file.id,name:readableFileName(file.name),mimeType:file.mimeType,size:file.size,url};}
async function readCustomer(tx:any,id:string,lock=false){
 if(lock){await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${id} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "ESignAccount" WHERE "customerId" = ${id} FOR UPDATE`;}
 const customer=await tx.customer.findUnique({where:{id}});ensure(customer,404,'NOT_FOUND','客户不存在');return customer;
}
async function profileState(tx:any,customer:any,url:(id:string)=>string){
 const profile=customer.profile&&typeof customer.profile==='object'&&!Array.isArray(customer.profile)?customer.profile:{};
 const ids=profileSlots.map(slot=>typeof profile[slot+'FileId']==='string'?profile[slot+'FileId']:null);
 const legacyIds:Array<string>=Array.isArray(profile.fileIds)?profile.fileIds.filter((id:any)=>typeof id==='string'):[];
 const allIds=[...new Set<string>([...ids.filter(Boolean),...legacyIds])];
 const rows=allIds.length?await tx.storedFile.findMany({where:{id:{in:allIds},customerId:customer.id}}):[];
 const byId=new Map<string,any>(rows.filter((file:any)=>validProfileFile(file,customer.id)).map((file:any)=>[file.id,file]));
 const missingFields:string[]=[];if(!customer.name?.trim())missingFields.push('name');if(!customer.mobile)missingFields.push('mobile');if(!Number.isInteger(customer.drivingYears)||customer.drivingYears<0||customer.drivingYears>70)missingFields.push('drivingYears');
 const files:any={};const documents:any={};
 profileSlots.forEach((slot,i)=>{const file=byId.get(ids[i]);if(!file||ids.filter(id=>id===ids[i]).length!==1)missingFields.push(slot+'FileId');files[slot]=file?profileFileMeta(file,url(file.id)):null;documents[slot]=file?{id:file.id,sha256:file.sha256}:null;});
 files.legacy=[...new Set(legacyIds)].filter(id=>!ids.includes(id)&&byId.has(id)).map(id=>profileFileMeta(byId.get(id),url(id)));
 const identity=await readCustomerIdentityEvidence(tx,customer.id,customer.name);
 const blockers:Array<{code:string;message:string}>=[];
 if(missingFields.length)blockers.push({code:'CUSTOMER_PROFILE_REQUIRED',message:'请补齐姓名、驾龄、身份证正反面及驾驶证'});
 if(identity.identityPolicy==='PROVIDER_REQUIRED'&&!identity.verified)blockers.push(identity.blocker||{code:'IDENTITY_REQUIRED',message:'请先完成本人实名认证'});
 const displayIdentity=await readCustomerIdentityDisplay(tx,customer.id);
 const dto={identity:displayIdentity,revision:profileRevision(customer),name:customer.name,mobile:customer.mobile,drivingYears:customer.drivingYears,...Object.fromEntries(profileSlots.map((slot,i)=>[slot+'FileId',ids[i]])),files,readiness:{identityPolicy:identity.identityPolicy,profileComplete:missingFields.length===0,realNameVerified:identity.verified,readyForApplication:!blockers.length,missingFields,blockers}};
 return{dto,documents,identity};
}
export async function readCustomerProfile(tx:any,customerId:string,url=(id:string)=>`/api/customer/files/${encodeURIComponent(id)}`){return(await profileState(tx,await readCustomer(tx,customerId),url)).dto;}
export async function saveCustomerProfile(tx:any,customerId:string,body:unknown){
 ensure(body&&typeof body==='object'&&Object.hasOwn(body,'revision')&&Object.hasOwn(body,'idempotencyKey'),409,'CLIENT_UPDATE_REQUIRED','请重新打开最新版小程序后保存个人资料');
 const input=profileInput.parse(body);const customer=await readCustomer(tx,customerId,true);
 await archiveCommand(tx,{id:customerId,role:'CUSTOMER'},`customer-profile:${customerId}`,'SAVE_PROFILE',input,async()=>{
  ensure(input.revision===profileRevision(customer),409,'REVISION_CONFLICT','个人资料已更新，请刷新后重试');
  const identity=await readCustomerIdentityDisplay(tx,customerId);
  ensure(!identity.locked||input.name===(identity.verified?identity.name:customer.name),409,'IDENTITY_IMMUTABLE','已实名姓名不可修改');
  const next={...(customer.profile&&typeof customer.profile==='object'&&!Array.isArray(customer.profile)?customer.profile:{}),revision:input.revision+1};
  for(const slot of profileSlots)if(Object.hasOwn(input,slot+'FileId'))next[slot+'FileId']=(input as any)[slot+'FileId'];
  const ids=profileSlots.map(slot=>next[slot+'FileId']).filter(Boolean);
  ensure(new Set(ids).size===ids.length,400,'PROFILE_DOCUMENT_DUPLICATE','身份证正反面和驾驶证须分别选择不同附件');
  const files=ids.length?await tx.storedFile.findMany({where:{id:{in:ids}}}):[];
  ensure(files.length===ids.length&&files.every((file:any)=>validProfileFile(file,customerId)),403,'PROFILE_FILE_INVALID','证件附件须为本人上传的有效图片或PDF');
  await assertNotAssetFiles(tx,ids);
  const oldIds=profileSlots.map(slot=>customer.profile?.[slot+'FileId']).filter(Boolean),oldFiles=oldIds.length?await tx.storedFile.findMany({where:{id:{in:oldIds}}}):[];
  for(const slot of profileSlots){const old=oldFiles.find((f:any)=>f.id===customer.profile?.[slot+'FileId']),fresh=files.find((f:any)=>f.id===next[slot+'FileId']);if(old&&fresh&&validProfileFile(old,customerId)&&old.sha256===fresh.sha256&&old.mimeType===fresh.mimeType&&old.size===fresh.size){await assertNotAssetFiles(tx,[old.id]);next[slot+'FileId']=old.id;}}
  const canonicalIds=profileSlots.map(slot=>next[slot+'FileId']).filter(Boolean);ensure(new Set(canonicalIds).size===canonicalIds.length,400,'PROFILE_DOCUMENT_DUPLICATE','身份证正反面和驾驶证须分别选择不同附件');
  const unchanged=customer.name===input.name&&customer.drivingYears===input.drivingYears&&profileSlots.every(slot=>(customer.profile?.[slot+'FileId']||null)===(next[slot+'FileId']||null));
  if(unchanged)return(await profileState(tx,customer,id=>`/api/customer/files/${encodeURIComponent(id)}`)).dto;
  const saved=await tx.customer.update({where:{id:customerId},data:{name:input.name,drivingYears:input.drivingYears,profile:next}});
  await audit(tx,customerId,'PROFILE_SAVED','customers',customerId,{revision:next.revision,previousRevision:input.revision},'CUSTOMER');
  return(await profileState(tx,saved,id=>`/api/customer/files/${encodeURIComponent(id)}`)).dto;
 });
 // The command is idempotent; current readiness is not a frozen business result.
 return readCustomerProfile(tx,customerId);
}
export async function captureCustomerProfileSnapshot(tx:any,customerId:string,captureStage:CustomerProfileSnapshot['captureStage']):Promise<CustomerProfileSnapshot>{
 const customer=await readCustomer(tx,customerId,true),state=await profileState(tx,customer,id=>`/api/customer/files/${encodeURIComponent(id)}`);
 const blocker=state.dto.readiness.blockers[0];ensure(!blocker,409,blocker?.code||'CUSTOMER_PROFILE_REQUIRED',blocker?.message||'请完善个人资料及实名认证');
 const identity=state.identity.identityPolicy==='MANUAL_REVIEW'?{version:2,identityPolicy:'MANUAL_REVIEW',identity:null}:state.identity.identityPolicy==='SIGNING_REQUIRED'?{version:3,identityPolicy:'SIGNING_REQUIRED',identity:null}:{version:1,identity:state.identity.snapshot};
 return customerProfileSnapshotSchema.parse({...identity,captureStage,capturedAt:new Date().toISOString(),profileRevision:profileRevision(customer),profileHash:customerProfileHash(customer),name:customer.name,mobile:customer.mobile,drivingYears:customer.drivingYears,documents:state.documents});
}
export function parseCustomerProfileSnapshot(value:any):CustomerProfileSnapshot|null{
 if(value===undefined||value===null)return null;const parsed=customerProfileSnapshotSchema.safeParse(value);ensure(parsed.success,409,'PROFILE_SNAPSHOT_INVALID','原客户资料快照不完整，请联系运营核查');return parsed.data;
}
export async function confirmCustomerProfileSnapshot(tx:any,customerId:string,value:unknown):Promise<CustomerProfileSnapshot>{
 const original=parseCustomerProfileSnapshot(value);
 ensure(!original||(original.version===1?'PROVIDER_REQUIRED':original.identityPolicy)===customerIdentityPolicy(),409,'CUSTOMER_PROFILE_CHANGED','资料审核政策已变化，请联系运营退回原申请补件后重新审核');
 const current=await captureCustomerProfileSnapshot(tx,customerId,'ORDER_CONFIRMATION');
 if(!original)return current;
 const comparable=(snapshot:CustomerProfileSnapshot)=>{const{capturedAt,captureStage,...rest}=snapshot;return rest;};
 ensure(canonicalHash(comparable(original))===canonicalHash(comparable(current)),409,'CUSTOMER_PROFILE_CHANGED','个人资料或实名依据已变化，请联系运营退回原申请补件后重新审核');
 return original;
}
export function applicationProfile(snapshot:CustomerProfileSnapshot,handoverLocation:any){return JSON.parse(JSON.stringify({name:snapshot.name,mobile:snapshot.mobile,drivingYears:snapshot.drivingYears,fileIds:profileSlots.map(slot=>snapshot.documents[slot].id),handoverLocation,customerProfileSnapshot:snapshot}));}
