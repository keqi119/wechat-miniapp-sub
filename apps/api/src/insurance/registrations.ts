import {createHash} from 'node:crypto';
import {z} from 'zod';
import {audit,hash,key,money,pagination,text} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {saveFile,validMime} from '../files/storage';
import {uploadedFileName} from '../files/filename';
import {policyDateTime} from './coverage';
import {activatedStatus,effectivePolicyVersion,policyTypes,validRegistration} from './registration-facts';
import type {InsuranceActor,PageQuery} from './types';

const ids=z.array(text).max(1000).refine(items=>new Set(items).size===items.length,'编号不可重复');
const timestamp=z.string().refine(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)||z.iso.datetime({offset:true}).safeParse(value).success,'须明确北京时间日期或带时区的ISO时间');
export const registrationInput=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key,versionId:text.nullable(),versionRevision:z.number().int().nonnegative(),vehicleIds:ids.refine(items=>items.length>0,'至少一辆被保车辆'),policyType:z.enum(policyTypes),policyNumber:text,insurer:text,insuredParty:text,policyholder:z.string().trim().max(500).default(''),premiumAmount:money.nullable().default(null),startAt:timestamp,endAt:timestamp,fileIds:ids.refine(items=>items.length<=20).default([]),reason:z.string().trim().min(2).max(1000).optional(),confirmed:z.literal(true)}).strict();
const include={versions:{orderBy:{version:'desc' as const}},files:true};
const json=(value:unknown)=>JSON.parse(JSON.stringify(value));
const identity=(insurer:string,policyNumber:string)=>({insurer:insurer.normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase(),policyNumber:policyNumber.normalize('NFKC').trim().replace(/\s+/g,'').toUpperCase()});
const metadata=(f:any)=>({id:f.id,name:f.name,mimeType:f.mimeType,size:f.size,sha256:f.sha256});

export async function requireLegacyPolicy(tx:any,policyId:string){
 const p=await tx.insurancePolicy.findUnique({where:{id:policyId},include:{versions:true}});
 ensure(!p?.versions?.some((v:any)=>v.status==='REGISTERED'),409,'INSURANCE_REGISTRATION_REQUIRED','此保单已使用单次登记，请通过登记表保存修改');
}

export function currentPolicyVersion(versions:any[],at=new Date()){
 const rows=[...versions].sort((a,b)=>b.version-a.version);
 return effectivePolicyVersion(rows,at)||rows[0]||null;
}
export function currentPolicyStatus(version:any,at=new Date()){
 if(!version)return 'DRAFT';
 if(!activatedStatus(version.status))return ['DRAFT','SUBMITTED','REJECTED'].includes(version.status)?version.status:'UNVERIFIED';
 if(version.status==='REGISTERED'&&!validRegistration(version))return 'UNVERIFIED';
 if(version.changeKind==='CANCELLATION'&&new Date(version.effectiveAt)<=at)return 'CANCELLED';
 if(new Date(version.effectiveAt)>at||new Date(version.startAt)>at)return 'NOT_STARTED';
 if(new Date(version.endAt)<=at)return 'EXPIRED';
 return 'ACTIVE';
}

export async function projectPolicy(tx:any,policy:any,at=new Date(),knownVehicles?:any[],knownFiles?:any[]){
 const versions=[...policy.versions].sort((a,b)=>b.version-a.version),current=currentPolicyVersion(versions,at),latest=versions[0],vehicleIds:string[]=current?.vehicleIds||[];
 const vehicles=knownVehicles||await tx.vehicle.findMany({where:{id:{in:vehicleIds}},select:{id:true,vin:true,plateNumber:true,title:true,revision:true}});
 const stored=knownFiles||await tx.storedFile.findMany({where:{id:{in:policy.files.map((b:any)=>b.fileId)}}});
 const operatorIds=[...new Set<string>(versions.map(v=>v.registeredBy).filter(Boolean))],operators=operatorIds.length?await tx.adminUser.findMany({where:{id:{in:operatorIds}},select:{id:true,name:true,username:true}}):[];
 return {...policy,versions:versions.map(v=>({...v,registeredByStaff:operators.find((a:any)=>a.id===v.registeredBy)??null})),files:policy.files.map((binding:any)=>({...binding,...(stored.find((f:any)=>f.id===binding.fileId)?metadata(stored.find((f:any)=>f.id===binding.fileId)):{}),id:binding.fileId,fileId:binding.fileId})),vehicles:vehicleIds.map(id=>vehicles.find((v:any)=>v.id===id)).filter(Boolean).map((v:any)=>({id:v.id,vin:v.vin??null,plateNumber:v.plateNumber??null,title:v.title??'',revision:v.revision})),currentVersionId:latest?.id??null,currentStatus:currentPolicyStatus(current,at),policyType:current?.policyType??null,startAt:current?.startAt??null,endAt:current?.endAt??null,insuredParty:current?.insuredParty??null};
}

export async function registrationList(tx:any,actor:InsuranceActor,query:PageQuery){
 await requireCurrentStaff(tx,actor,'insurance-policies',false);const p=pagination(query),at=new Date();
 if(query.policyType)ensure((policyTypes as readonly string[]).includes(query.policyType),400,'VALIDATION','保单类型无效');
 if(query.status)ensure(['NOT_STARTED','ACTIVE','EXPIRED','CANCELLED','DRAFT','SUBMITTED','REJECTED','UNVERIFIED','APPROVED','REGISTERED'].includes(query.status),400,'VALIDATION','保单状态无效');
 const expiry=query.expiringWithinDays===undefined?null:Number(query.expiringWithinDays);ensure(expiry===null||Number.isInteger(expiry)&&expiry>=0&&expiry<=3650,400,'VALIDATION','到期天数须为0至3650');
 const policies=await tx.insurancePolicy.findMany({include,orderBy:[{createdAt:'desc'},{id:'desc'}]});
 const vehicleIds=[...new Set<string>(policies.flatMap((policy:any)=>policy.versions.flatMap((v:any)=>v.vehicleIds)))],fileIds=[...new Set<string>(policies.flatMap((policy:any)=>policy.files.map((f:any)=>f.fileId)))];
 const [vehicles,files]=await Promise.all([tx.vehicle.findMany({where:{id:{in:vehicleIds}},select:{id:true,vin:true,plateNumber:true,title:true,revision:true}}),tx.storedFile.findMany({where:{id:{in:fileIds}}})]);
 const rows=await Promise.all(policies.map((policy:any)=>projectPolicy(tx,policy,at,vehicles,files))),search=query.search?.trim().normalize('NFKC').toLocaleLowerCase();
 const filtered=rows.filter(row=>{
  const current=currentPolicyVersion(row.versions,at);
  if(query.vehicleId&&!row.vehicles.some((v:any)=>v.id===query.vehicleId))return false;
  if(query.policyType&&row.policyType!==query.policyType)return false;
  if(query.status&&(['APPROVED','REGISTERED'].includes(query.status)?current?.status!==query.status:row.currentStatus!==query.status))return false;
  if(expiry!==null&&(!row.endAt||!['ACTIVE','NOT_STARTED'].includes(row.currentStatus)||new Date(row.endAt)<at||new Date(row.endAt).getTime()>at.getTime()+expiry*86400000))return false;
  return !search||[row.policyNumber,row.insurer,row.insuredParty,...row.vehicles.flatMap((v:any)=>[v.vin,v.plateNumber,v.title])].some(value=>String(value??'').normalize('NFKC').toLocaleLowerCase().includes(search));
 });
 return {items:filtered.slice(p.skip,p.skip+p.pageSize),total:filtered.length,page:p.page,pageSize:p.pageSize};
}

export async function registerPolicy(tx:any,actor:InsuranceActor,raw:unknown,uploads:Express.Multer.File[],policyId?:string){
 const input=registrationInput.parse(raw),files=uploads||[];
 ensure(files.length+input.fileIds.length>=1&&files.length+input.fileIds.length<=20,400,'INSURANCE_FILE_INVALID','须保留或上传1至20份保单原件');
 let total=0;
 const manifest=files.map(f=>{
  ensure(f&&Buffer.isBuffer(f.buffer)&&f.buffer.length===f.size&&f.size>0&&f.size<=10*1024*1024&&['application/pdf','image/jpeg','image/png'].includes(f.mimetype)&&validMime(f.buffer,f.mimetype),400,'INSURANCE_FILE_INVALID','仅支持内容有效的10MiB PDF/JPEG/PNG');total+=f.size;
  return {name:uploadedFileName(f.originalname),mimeType:f.mimetype,size:f.size,sha256:createHash('sha256').update(f.buffer).digest('hex')};
 });
 ensure(total<=32*1024*1024,400,'INSURANCE_FILE_INVALID','一次上传文件总量不得超过32MiB');
 await requireCurrentStaff(tx,actor,'insurance-policies');const resourceId=policyId||'NEW',action='REGISTER',requestHash=hash({...input,manifest});
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.id}:insurance:${resourceId}:${action}:${input.idempotencyKey}`},0))`;
 const where={actorId_resourceId_action_key:{actorId:actor.id,resourceId,action,key:input.idempotencyKey}},old=await tx.insuranceCommand.findUnique({where});
 if(old){ensure(old.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','相同幂等键不能修改登记输入或原件字节');return old.resultSnapshot;}
 if(policyId)await tx.$queryRaw`SELECT id FROM "InsurancePolicy" WHERE id=${policyId} FOR UPDATE`;
 const normalized=identity(input.insurer,input.policyNumber);ensure(normalized.insurer&&normalized.policyNumber,400,'VALIDATION','保险机构及保单号不能为空');
 let policy=policyId?await tx.insurancePolicy.findUnique({where:{id:policyId},include}):null;
 if(policyId)ensure(policy,404,'NOT_FOUND','保单不存在');
 const last=policy?.versions[0];
 if(policyId)ensure(policy.revision===input.revision&&last?.id===input.versionId&&last.revision===input.versionRevision,409,'REVISION_CONFLICT','保单或版本已更新，请刷新核对');
 else ensure(input.revision===0&&input.versionId===null&&input.versionRevision===0,409,'REVISION_CONFLICT','新保单修订号须为0且无历史版本');
 if(policyId)ensure(input.reason,400,'INSURANCE_CHANGE_REASON','修改保单须填写修改说明');
 ensure(!await tx.insurancePolicy.findFirst({where:{...normalized,...(policyId?{id:{not:policyId}}:{})}}),409,'INSURANCE_POLICY_DUPLICATE','该保险机构下保单号已存在');
 const startAt=policyDateTime(input.startAt),endAt=policyDateTime(input.endAt,true);ensure(startAt<endAt,400,'INSURANCE_INTERVAL_INVALID','保障截止须晚于起始');
 for(const id of [...input.vehicleIds].sort())await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${id} FOR UPDATE`;
 const vehicles=await tx.vehicle.findMany({where:{id:{in:input.vehicleIds}},select:{id:true,vin:true,plateNumber:true,title:true,revision:true}});
 ensure(vehicles.length===input.vehicleIds.length,404,'INSURANCE_VEHICLE_MISSING','被保车辆不存在');
 const [retained,retainedBindings]=await Promise.all([tx.storedFile.findMany({where:{id:{in:input.fileIds}}}),policyId?tx.insurancePolicyFile.findMany({where:{policyId,fileId:{in:input.fileIds}}}):Promise.resolve([])]);
 ensure(retained.length===input.fileIds.length,409,'INSURANCE_FILE_SCOPE','保留原件不存在或不属于本保单');
 for(const f of retained){const b=retainedBindings.find((b:any)=>b.fileId===f.id);ensure(b&&f.purpose==='insurance'&&!f.customerId&&f.adminId===b.uploadedBy&&f.size>0&&f.size<=10*1024*1024&&['application/pdf','image/jpeg','image/png'].includes(f.mimeType)&&/^[a-f0-9]{64}$/.test(f.sha256)&&b.vehicleIds.some((id:string)=>input.vehicleIds.includes(id)),409,'INSURANCE_FILE_SCOPE','保留附件类型或车辆归属无效');}
 ensure(total+retained.reduce((sum:number,f:any)=>sum+f.size,0)<=32*1024*1024,400,'INSURANCE_FILE_INVALID','保留与新增原件合计不得超过32MiB');
 const before=policy?json(policy):null;
 if(!policy)policy=await tx.insurancePolicy.create({data:{...normalized,createdBy:actor.id}});
 const changed=await tx.insurancePolicy.updateMany({where:{id:policy.id,revision:input.revision},data:{...normalized,revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','保单已更新');
 const allFiles:any[]=[...retained],allBindings:any[]=[...retainedBindings];
 for(const upload of files){const saved=await saveFile(upload),stored=await tx.storedFile.create({data:{...saved,purpose:'insurance',adminId:actor.id}}),binding=await tx.insurancePolicyFile.create({data:{policyId:policy.id,fileId:stored.id,vehicleIds:input.vehicleIds,uploadedBy:actor.id}});allFiles.push(stored);allBindings.push(binding);}
 ensure(input.vehicleIds.every(id=>allBindings.some(b=>b.vehicleIds.includes(id))),409,'INSURANCE_FILE_SCOPE','每辆被保车辆均须有对应保单原件');
 const now=new Date(),registeredAt=now,effectiveAt=now;
 const snapshot={schemaVersion:1,confirmed:true,registeredBy:actor.id,registeredAt:registeredAt.toISOString(),policy:{insurer:input.insurer,policyNumber:input.policyNumber,policyType:input.policyType,insuredParty:input.insuredParty,startAt:startAt.toISOString(),endAt:endAt.toISOString()},vehicles:input.vehicleIds.map(id=>{const v=vehicles.find((v:any)=>v.id===id);return{id:v.id,vin:v.vin??null,plateNumber:v.plateNumber??null,title:v.title};}),files:allFiles.map(f=>({...metadata(f),vehicleIds:allBindings.find(b=>b.fileId===f.id).vehicleIds.filter((id:string)=>input.vehicleIds.includes(id))}))};
 const version=await tx.insurancePolicyVersion.create({data:{policyId:policy.id,version:(last?.version||0)+1,status:'REGISTERED',changeKind:last?'ENDORSEMENT':'ORIGINAL',...{insurerSnapshot:input.insurer,policyNumberSnapshot:input.policyNumber,policyType:input.policyType,registeredBy:actor.id,registeredAt,registrationSnapshot:snapshot,changeReason:input.reason||'首次登记'},effectiveAt,startAt,endAt,policyholder:input.policyholder,insuredParty:input.insuredParty,premiumAmount:input.premiumAmount,vehicleIds:input.vehicleIds,coverageItems:[],terms:'',requirementVersionIds:[],fileIds:allFiles.map(f=>f.id),createdBy:actor.id}});
 ensure(validRegistration(version),409,'INSURANCE_REGISTRATION_INVALID','登记原件与车辆证据不完整');
 const saved=await tx.insurancePolicy.findUnique({where:{id:policy.id},include}),result=await projectPolicy(tx,saved,now);
 await audit(tx,actor.id,'REGISTER','insurance-policies',policy.id,{reason:input.reason||'首次登记',before,after:{revision:result.revision,versionId:version.id,snapshot},fileIds:version.fileIds});
 await tx.insuranceCommand.create({data:{actorId:actor.id,resourceId,action,key:input.idempotencyKey,requestHash,resultSnapshot:json(result)}});return result;
}
