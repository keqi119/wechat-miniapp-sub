import {z} from 'zod';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {ensure} from '../common/errors';
import {readSimpleAgreementSnapshot} from '../partners/simple-agreements';
import {cooperationRegistration,readPartnerRegistrationCandidates,type RegisteredPartner} from './partner-registration';

const text=(max:number)=>z.string().trim().max(max).refine(value=>!value.includes('\u0000'),'筛选不可含空字符');
const integer=(max:number)=>z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(max));
const queryInput=z.object({
 view:z.enum(['product-selection','pricing-selection']).optional(),keyword:text(200).optional(),brand:text(200).optional(),model:text(200).optional(),
 modelDefinitionId:text(128).min(1).optional(),modelYear:integer(2100).refine(v=>v>=1900).optional(),
 registeredOwnerName:text(200).optional(),cooperationOwnerId:text(128).min(1).optional(),
 batteryOwnership:z.enum(['OWNED','BAAS']).optional(),
 batteryCapacityKwh:z.string().trim().regex(/^\d+(\.\d{1,3})?$/).transform(Number).pipe(z.number().positive().max(99999.999)).optional(),
 ageMonthsMin:integer(120000).optional(),ageMonthsMax:integer(120000).optional(),
 mileageKmMin:integer(2147483647).optional(),mileageKmMax:integer(2147483647).optional(),
 plateNumber:text(50).optional(),vin:text(100).optional(),
 status:z.enum(['DRAFT','PUBLISHED','UNPUBLISHED','RESERVED','IN_USE']).optional(),
 page:integer(10000).refine(v=>v>=1).default(1),pageSize:integer(100).refine(v=>v>=1).default(20),
}).strict().refine(q=>q.ageMonthsMin===undefined||q.ageMonthsMax===undefined||q.ageMonthsMin<=q.ageMonthsMax,'车龄范围无效')
 .refine(q=>q.mileageKmMin===undefined||q.mileageKmMax===undefined||q.mileageKmMin<=q.mileageKmMax,'里程范围无效');
const advanced=new Set(['view','brand','model','modelDefinitionId','modelYear','registeredOwnerName','cooperationOwnerId','batteryOwnership','batteryCapacityKwh','ageMonthsMin','ageMonthsMax','mileageKmMin','mileageKmMax','plateNumber','vin']);
const relations={modelDefinition:{select:{modelYear:true}},assetProfile:{select:{registeredOwnerName:true,firstRegistrationDate:true,batteryCapacityKwh:true,batteryOwnership:true}}};
const selection={id:true,revision:true,title:true,brand:true,model:true,modelDefinitionId:true,year:true,mileageKm:true,vin:true,plateNumber:true,status:true,catalogPublished:true,city:true,...relations};
type CooperationOwner={id:string;name:string;source:'SIMPLE_AGREEMENT'|'LEGACY_OWNER_BINDING'};
const shanghaiDay=(now:Date)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now);
function dateValue(value:unknown):string|null{
 if(!(value instanceof Date)||!Number.isFinite(value.getTime()))return null;return value.toISOString().slice(0,10);
}
/** Completed calendar months; a missing or future registration never becomes guessed age. */
export function vehicleAgeMonths(firstDate:string|null,asOf:string):number|null{
 if(!firstDate||firstDate>asOf)return null;const [fy,fm,fd]=firstDate.split('-').map(Number),[y,m,d]=asOf.split('-').map(Number);
 return (y-fy)*12+m-fm-(d<fd?1:0);
}
function monthsBefore(day:string,months:number){
 const [year,month,date]=day.split('-').map(Number),index=year*12+month-1-months,y=Math.floor(index/12),m=index-y*12;
 if(y<1)return null;
 const last=new Date(0);last.setUTCFullYear(y,m+1,0);last.setUTCHours(0,0,0,0);
 const result=new Date(0);result.setUTCFullYear(y,m,Math.min(date,last.getUTCDate()));result.setUTCHours(0,0,0,0);return result;
}
async function operator(tx:any,actor:StaffActor,query?:Record<string,unknown>){
 const current=await requireCurrentStaff(tx,actor,'vehicles',false),full=['ADMIN','OPERATIONS'].includes(current.role);
 if(query?.view==='pricing-selection'){
  await requireCurrentStaff(tx,actor,'pricing-reference',false);
  ensure(query.cooperationOwnerId===undefined,400,'PRICING_FILTER_INVALID','定价选车不按合作归属筛选');
  return full;
 }
 if(query&&Object.keys(query).some(key=>advanced.has(key)))ensure(full,403,'FORBIDDEN','当前岗位无车辆台账筛选权限');
 return full;
}
async function cooperation(tx:any,vehicleId:string,asOf:string):Promise<CooperationOwner|null>{
 const binding=await tx.partnerAgreementVehicle.findUnique({where:{vehicleId}});
 if(binding){
  const effective=await readSimpleAgreementSnapshot(tx,vehicleId,{startDate:asOf,endDate:asOf});if(!effective)return null;
  const owner=await tx.vehicleOwner.findUnique({where:{id:effective.ownerId}});
  return owner?{id:owner.id,name:owner.name,source:'SIMPLE_AGREEMENT'}:null;
 }
 const legacy=await tx.ownerVehicle.findUnique({where:{vehicleId},include:{owner:true}}),owner=legacy?.owner;
 // This is a reviewed legacy association, not a rental qualification/coverage decision.
 if(legacy?.status!=='APPROVED'||!legacy.reviewedBy||!legacy.reviewedAt||!owner||owner.status==='SUSPENDED'||owner.cooperationMode==='SIMPLE')return null;
 return{id:owner.id,name:owner.name,source:'LEGACY_OWNER_BINDING'};
}
async function ownerVehicleIds(tx:any,ownerId:string,asOf:string){
 const [simple,legacy]=await Promise.all([tx.partnerAgreementVehicle.findMany({where:{ownerId},select:{vehicleId:true}}),tx.ownerVehicle.findMany({where:{ownerId,status:'APPROVED'},select:{vehicleId:true}})]);
 const ids:string[]=[];
 for(const vehicleId of new Set<string>([...simple,...legacy].map(row=>row.vehicleId))){if((await cooperation(tx,vehicleId,asOf))?.id===ownerId)ids.push(vehicleId);}
 return ids;
}
async function projection(tx:any,row:any,asOf:string,full:boolean,registeredPartners:RegisteredPartner[]=[]){
 const {modelDefinition,assetProfile,ownerBinding,...vehicle}=row;
 if(!full)return vehicle;
 const firstRegistrationDate=dateValue(assetProfile?.firstRegistrationDate);
 const cooperationOwner=await cooperation(tx,row.id,asOf);
 return {...vehicle,modelYear:modelDefinition?.modelYear??null,registrationYear:row.year,registeredOwnerName:assetProfile?.registeredOwnerName??null,
  batteryCapacityKwh:assetProfile?.batteryCapacityKwh?.toString()??null,batteryOwnership:assetProfile?.batteryOwnership??'UNKNOWN',
  firstRegistrationDate,ageMonths:vehicleAgeMonths(firstRegistrationDate,asOf),cooperationOwner,cooperationRegistration:cooperationRegistration(registeredPartners,cooperationOwner?.id)};
}
export async function readAdminVehicles(tx:any,actor:StaffActor,raw:unknown,now=new Date()){
 const full=await operator(tx,actor,raw as Record<string,unknown>),q=queryInput.parse(raw),asOf=shanghaiDay(now),where:any={},and:any[]=[];
 if(q.status)where.status=q.status;
 if(q.keyword)where.OR=['title','brand','model','vin','plateNumber'].map(field=>({[field]:{contains:q.keyword,mode:'insensitive'}}));
 for(const field of ['brand','model','plateNumber','vin'] as const)if(q[field])where[field]={contains:q[field],mode:'insensitive'};
 if(q.modelDefinitionId)where.modelDefinitionId=q.modelDefinitionId;
 if(q.modelYear!==undefined)where.modelDefinition={is:{modelYear:q.modelYear}};
 if(q.mileageKmMin!==undefined||q.mileageKmMax!==undefined)where.mileageKm={...(q.mileageKmMin===undefined?{}:{gte:q.mileageKmMin}),...(q.mileageKmMax===undefined?{}:{lte:q.mileageKmMax})};
 if(q.registeredOwnerName)and.push({assetProfile:{is:{registeredOwnerName:{contains:q.registeredOwnerName,mode:'insensitive'}}}});
 if(q.batteryOwnership)and.push({assetProfile:{is:{batteryOwnership:q.batteryOwnership}}});
 if(q.batteryCapacityKwh!==undefined)and.push({assetProfile:{is:{batteryCapacityKwh:q.batteryCapacityKwh}}});
 if(q.ageMonthsMin!==undefined||q.ageMonthsMax!==undefined){
  const upper=monthsBefore(asOf,q.ageMonthsMin??0),lower=q.ageMonthsMax===undefined?null:monthsBefore(asOf,q.ageMonthsMax+1);
  if(!upper)and.push({id:{in:[]}});
  else and.push({assetProfile:{is:{firstRegistrationDate:{lte:upper,...(lower?{gt:lower}:{})}}}});
 }
 if(and.length)where.AND=and;
 if(q.cooperationOwnerId)where.id={in:await ownerVehicleIds(tx,q.cooperationOwnerId,asOf)};
 const [rows,total]=await Promise.all([tx.vehicle.findMany({where,skip:(q.page-1)*q.pageSize,take:q.pageSize,orderBy:[{createdAt:'desc'},{id:'desc'}],...(q.view?{select:selection}:full?{include:relations}:{})}),tx.vehicle.count({where})]);
 if(q.view==='pricing-selection')return{items:rows.map((row:any)=>({id:row.id,title:row.title,modelDefinitionId:row.modelDefinitionId,brand:row.brand,model:row.model,
  modelYear:row.modelDefinition?.modelYear??null,mileageKm:row.mileageKm,plateNumber:row.plateNumber,vin:row.vin,
  registeredOwnerName:row.assetProfile?.registeredOwnerName??null,batteryOwnership:row.assetProfile?.batteryOwnership??'UNKNOWN',
  batteryCapacityKwh:row.assetProfile?.batteryCapacityKwh?.toString()??null,ageMonths:vehicleAgeMonths(dateValue(row.assetProfile?.firstRegistrationDate),asOf)})),total,page:q.page,pageSize:q.pageSize,ageAsOf:asOf};
 const registrations=full?await readPartnerRegistrationCandidates(tx,rows.map((row:any)=>row.id)):new Map<string,RegisteredPartner[]>();
 const items=[];for(const row of rows){const value=await projection(tx,row,asOf,full,registrations.get(row.id));if(q.view)delete value.year;items.push(value);}
 return{items,total,page:q.page,pageSize:q.pageSize,ageAsOf:asOf};
}
/** Resolve the same effective cooperation as the ledger; drafts/registrants never become filter owners. */
export async function readVehicleFilterOptions(tx:any,actor:StaffActor,raw:unknown,now=new Date()){
 await operator(tx,actor,{view:'product-selection'});
 const q=z.object({cooperationSearch:text(200).optional(),page:integer(10000).refine(v=>v>=1).default(1),pageSize:integer(100).refine(v=>v>=1).default(100)}).strict().parse(raw),ageAsOf=shanghaiDay(now);
 const [simple,legacy]=await Promise.all([tx.partnerAgreementVehicle.findMany({select:{vehicleId:true}}),tx.ownerVehicle.findMany({where:{status:'APPROVED'},select:{vehicleId:true}})]),owners=new Map<string,{id:string;name:string}>();
 for(const vehicleId of new Set<string>([...simple,...legacy].map(row=>row.vehicleId))){const current=await cooperation(tx,vehicleId,ageAsOf);if(current)owners.set(current.id,{id:current.id,name:current.name});}
 const needle=q.cooperationSearch?.toLocaleLowerCase(),all=[...owners.values()].filter(owner=>!needle||owner.name.toLocaleLowerCase().includes(needle)).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id));
 return{items:all.slice((q.page-1)*q.pageSize,q.page*q.pageSize),total:all.length,page:q.page,pageSize:q.pageSize,ageAsOf};
}
export async function readAdminVehicle(tx:any,actor:StaffActor,id:string,now=new Date()){
 const full=await operator(tx,actor),vehicle=await tx.vehicle.findUnique({where:{id},...(full?{include:relations}:{})});
 ensure(vehicle,404,'NOT_FOUND','车辆不存在');const registrations=full?await readPartnerRegistrationCandidates(tx,[id]):new Map<string,RegisteredPartner[]>();
 return projection(tx,vehicle,shanghaiDay(now),full,registrations.get(id));
}
