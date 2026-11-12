import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {resolve,sep} from 'node:path';
import {HttpException} from '@nestjs/common';
import {ensure} from '../common/errors';
import {projectRoot} from '../common/config';
import {requireCurrentStaff} from '../auth/staff-session';
import {canonicalHash} from '../customers/types';
import {productVersionInclude} from '../products/types';
import {validateListingSource} from '../products/snapshot';
import {filePrivacyBoundary} from '../files/files';
import {validMime} from '../files/storage';
import {readBaasRegistration,registrationCache} from '../vehicle-baas/registration';
import {readPartnerRegistrationCandidates} from './partner-registration';
import {freezeBasicCondition} from './basic-condition-snapshot';

type Key='VEHICLE_INFO'|'PARTNER_INFO'|'PRODUCT'|'PHOTOS'|'BAAS'|'CONDITION';
type Check={key:Key;label:string;passed:boolean;required:boolean;messages:string[];targetView:string};
export type PublicationReadiness={vehicleId:string;vehicleRevision:number;goodsId?:string;goodsRevision?:number;checkedAt:string;publicationDate:string;ready:boolean;checks:Check[]};
const uploadRoot=resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads'));
const text=(value:unknown)=>typeof value==='string'&&value.trim().length>0;
const date=(value:unknown)=>new Date(value as any);
const day=(now:Date)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now);
const goodsInclude={vehicle:true,productVersion:{include:productVersionInclude},subscriptionPlan:true};
function check(key:Key,label:string,targetView:string,messages:string[],required=true):Check{return{key,label,targetView,passed:messages.length===0,required,messages};}

async function genuineBytes(file:any,mimes:string[]){
 if(!file||!mimes.includes(file.mimeType)||!Number.isSafeInteger(file.size)||file.size<=0||file.size>32*1024*1024||!/^[a-f0-9]{64}$/.test(file.sha256)||!text(file.storagePath)||!resolve(file.storagePath).startsWith(uploadRoot+sep))return false;
 try{const [root,path]=await Promise.all([fs.realpath(uploadRoot),fs.realpath(file.storagePath)]);if(!path.startsWith(root+sep))return false;const stat=await fs.stat(path);if(!stat.isFile()||stat.size!==file.size)return false;const bytes=await fs.readFile(path);return bytes.length===file.size&&validMime(bytes,file.mimeType)&&createHash('sha256').update(bytes).digest('hex')===file.sha256;}catch{return false;}
}
async function partnerMessages(tx:any,vehicleId:string,today:string){
 const candidates=await readPartnerRegistrationCandidates(tx,[vehicleId]),ownerIds=new Set<string>((candidates.get(vehicleId)||[]).map(row=>row.id));
 const simple=await tx.partnerAgreementVehicle.findUnique({where:{vehicleId}});
 if(simple){
  const [agreement,version]=await Promise.all([tx.partnerAgreement.findUnique({where:{id:simple.agreementId}}),tx.partnerAgreementVersion.findUnique({where:{id:simple.agreementVersionId}})]);
  if(agreement?.status==='ACTIVE'&&agreement.ownerId===simple.ownerId&&agreement.currentVersionId===version?.id&&version?.status==='ACTIVE'&&version.ownerId===simple.ownerId&&version.agreementId===agreement.id&&version.vehicleIds?.includes(vehicleId)&&(!version.validFrom||version.validFrom<=today)&&(!version.validUntil||version.validUntil>=today))ownerIds.add(simple.ownerId);
 }else{
  const legacy=await tx.ownerVehicle.findUnique({where:{vehicleId}});if(legacy&&['DRAFT','APPROVED'].includes(legacy.status))ownerIds.add(legacy.ownerId);
  const proposals=await tx.partnerVehicleBindingProposal.findMany({where:{vehicleId,status:'SUBMITTED'},orderBy:{createdAt:'desc'}});for(const proposal of proposals)ownerIds.add(proposal.ownerId);
 }
 if(ownerIds.size!==1)return[ownerIds.size?'车辆存在多个合作方登记，请先明确唯一合作方':'请先登记车辆对应的合作方'];
 const [id]=ownerIds,owner=await tx.vehicleOwner.findUnique({where:{id}});if(!owner||owner.status==='SUSPENDED')return['对应合作方不存在或已停用'];
 const missing:string[]=[];
 if(!['ENTERPRISE','INDIVIDUAL'].includes(owner.subjectType))missing.push('主体类型');if(!text(owner.name))missing.push('主体名称');if(!text(owner.address))missing.push('主体地址');
 if(!text(owner.ordinaryContactPhone)&&!text(owner.contactPhone))missing.push('联系电话');if(owner.subjectType==='ENTERPRISE'&&!/^[A-Z0-9]{18}$/.test(owner.creditCode||''))missing.push('统一社会信用代码');
 return missing.map(label=>'合作方请补齐'+label);
}
function productMessages(listings:any[],vehicle:any,goodsId?:string){
 const rows=listings.filter(row=>['DRAFT','PUBLISHED','WITHDRAWN'].includes(row.status)&&row.vehicleId===vehicle.id&&(!goodsId||row.id===goodsId));
 for(const row of rows){try{const snapshot=validateListingSource(row,row.productVersion,vehicle,row.subscriptionPlan),sourceHash=canonicalHash(snapshot);if(row.productSourceHash===sourceHash&&row.snapshot&&canonicalHash(row.snapshot)===sourceHash)return[];}catch(error){if(!(error instanceof HttpException)&&!(error&&typeof error==='object'&&'name' in error&&error.name==='ZodError'))throw error;}}
 return[goodsId?'本商品须绑定适用且已发布的真实产品版本，并保留有效配置摘要':'请先为本车建立适用且已发布产品版本的商品卡槽'];
}
async function photoMessages(tx:any,vehicle:any){
 const gallery=Array.isArray(vehicle.mediaFileIds)?vehicle.mediaFileIds.filter(text):[],cover=vehicle.coverFileId;
 if(!gallery.length||!text(cover))return[...(!gallery.length?['请至少添加一张车辆相册照片']:[]),...(!text(cover)?['请设置商品展示封面']:[])];
 const ids=[...new Set<string>([...gallery,cover])],files=await tx.storedFile.findMany({where:{id:{in:ids}}});
 for(const id of ids){const f=files.find((row:any)=>row.id===id);if(!f||f.purpose!=='vehicle'||f.customerId||f.fieldTaskId||!text(f.adminId)||!await genuineBytes(f,['image/jpeg','image/png']))return['车辆相册或封面原图缺失、内容摘要无效或并非本车公开图片'];const boundary=await filePrivacyBoundary(tx,id);if(Object.values(boundary).some(Boolean))return['车辆相册或封面仍绑定私密业务资料，请使用公开车辆照片'];}
 return[];
}
function conditionComplete(row:any,vehicleId:string){return row?.vehicleId===vehicleId&&Number.isSafeInteger(row.revision)&&row.revision>0&&['fireDamage','floodDamage','structuralDamage'].every(key=>typeof row[key]==='boolean')&&text(row.assessedBy)&&Number.isFinite(date(row.assessedAt).getTime());}
function vehicleInfoMessages(vehicle:any,asset:any){
 const missing:string[]=[];for(const [key,label] of [['title','车辆名称'],['brand','品牌'],['model','车型'],['city','城市']] as const)if(!text(vehicle[key]))missing.push('请填写'+label);
 if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vehicle.vin||''))missing.push('请填写17位有效VIN');if(!Number.isInteger(vehicle.year)||vehicle.year<1990||vehicle.year>2100)missing.push('请填写有效车辆年份');if(!Number.isSafeInteger(vehicle.mileageKm)||vehicle.mileageKm<0)missing.push('请填写真实里程');if(!['OWNED','BAAS'].includes(asset?.batteryOwnership))missing.push('请明确电池归属为买断或BAAS');return missing;
}
async function activationReadiness(tx:any,vehicleId:string){const vehicle=await tx.vehicle.findUnique({where:{id:vehicleId}});ensure(vehicle?.id===vehicleId,404,'NOT_FOUND','车辆不存在');const asset=await tx.vehicleAssetProfile.findUnique({where:{vehicleId}}),checks=[check('VEHICLE_INFO','车辆信息','overview',vehicleInfoMessages(vehicle,asset))];return{vehicleId,vehicleRevision:vehicle.revision,ready:checks.every(c=>c.passed),checks};}
export async function readVehicleActivationReadiness(tx:any,actor:any,vehicleId:string){const current=await requireCurrentStaff(tx,actor,'vehicles',false);ensure(['ADMIN','OPERATIONS'].includes(current.role),403,'FORBIDDEN','当前岗位无车辆资料核验权限');return activationReadiness(tx,vehicleId);}
export async function requireVehicleActivationReady(tx:any,vehicleId:string){const readiness=await activationReadiness(tx,vehicleId);if(!readiness.ready)throw new HttpException({error:{code:'PUBLISH_REQUIREMENTS',message:'请先补齐车辆基础资料',readiness}},409);return readiness;}

/** Read only. Publication commands call this again under their original transaction and occupancy lock. */
export async function publicationReadiness(tx:any,vehicleId:string,goodsId?:string,at=new Date()):Promise<PublicationReadiness>{
 ensure(Number.isFinite(at.getTime()),400,'VALIDATION','发布检查时间无效');const vehicle=await tx.vehicle.findUnique({where:{id:vehicleId}});ensure(vehicle&&vehicle.id===vehicleId,404,'NOT_FOUND','车辆不存在');
 const [asset,listings,condition]=await Promise.all([tx.vehicleAssetProfile.findUnique({where:{vehicleId}}),tx.vehicleListing.findMany({where:{vehicleId,...(goodsId?{id:goodsId}:{})},include:goodsInclude}),tx.vehicleConditionAssessment.findUnique({where:{vehicleId}})]);
 const goods=goodsId?listings.find((row:any)=>row.id===goodsId&&row.vehicleId===vehicleId):null;ensure(!goodsId||goods,404,'NOT_FOUND','商品不属于此车辆');
 const missing=vehicleInfoMessages(vehicle,asset);
 const today=day(at),[partner,photos]=await Promise.all([partnerMessages(tx,vehicleId,today),photoMessages(tx,vehicle)]);
 const needsBaas=asset?.batteryOwnership==='BAAS',baasMessages:string[]=[];
 if(needsBaas){
  const contracts=await tx.vehicleBaasContract.findMany({where:{vehicleId,status:{notIn:['ARCHIVED','TERMINATED']}},orderBy:[{createdAt:'desc'},{id:'desc'}]}),candidates=contracts.filter((row:any)=>!['ARCHIVED','TERMINATED'].includes(row.status)).sort((a:any,b:any)=>Number(b.status==='ACTIVE')-Number(a.status==='ACTIVE'));
  if(!candidates.length)baasMessages.push('请登记本车BAAS合同资料');else{const cache=registrationCache();let selected:Awaited<ReturnType<typeof readBaasRegistration>>|undefined;for(const row of candidates){const value=await readBaasRegistration(tx,row,undefined,cache);selected??=value;if(value.readiness.ready){selected=value;break;}}baasMessages.push(...selected!.readiness.checks.filter(item=>!item.passed).map(item=>item.message));}
 }
 const checks=[check('VEHICLE_INFO','车辆信息','overview',missing),check('PARTNER_INFO','合作方信息','documents',partner),check('PRODUCT','产品方案','listing',productMessages(listings,vehicle,goodsId)),check('PHOTOS','车辆与商品照片','photos',photos),check('BAAS','BAAS合同资料','battery-baas',baasMessages,needsBaas),check('CONDITION','基本车况判断','inspection',conditionComplete(condition,vehicleId)?[]:['请明确登记是否火烧、泡水及结构损伤'])];
 return{vehicleId,vehicleRevision:vehicle.revision,...(goods?{goodsId:goods.id,goodsRevision:goods.revision}:{}),checkedAt:at.toISOString(),publicationDate:today,ready:checks.filter(c=>c.required).every(c=>c.passed),checks};
}
export async function readVehiclePublicationReadiness(tx:any,actor:any,vehicleId:string){const current=await requireCurrentStaff(tx,actor,'vehicles',false);ensure(['ADMIN','OPERATIONS'].includes(current.role),403,'FORBIDDEN','当前岗位无车辆资料核验权限');return publicationReadiness(tx,vehicleId);}
export async function readGoodsPublicationReadiness(tx:any,actor:any,goodsId:string){await requireCurrentStaff(tx,actor,'goods',false);const goods=await tx.vehicleListing.findUnique({where:{id:goodsId},select:{id:true,vehicleId:true}});ensure(goods&&goods.id===goodsId,404,'NOT_FOUND','商品不存在');return publicationReadiness(tx,goods.vehicleId,goodsId);}
export async function requirePublicationReady(tx:any,vehicleId:string,goodsId?:string,at=new Date()){
 const readiness=await publicationReadiness(tx,vehicleId,goodsId,at);if(!readiness.ready)throw new HttpException({error:{code:'PUBLISH_REQUIREMENTS',message:'请先补齐车辆发布所需资料',readiness}},409);
 const condition=await tx.vehicleConditionAssessment.findUnique({where:{vehicleId}});ensure(conditionComplete(condition,vehicleId),409,'PUBLISH_REQUIREMENTS','基本车况已变化，请重新核对');return{readiness,basicConditionSnapshot:freezeBasicCondition(condition)};
}
