import {randomUUID} from 'node:crypto';
import {baasTerms} from '../src/asset-costs/source';
import {canonicalHash} from '../src/customers/types';
export const assetActor={id:'operations',role:'OPERATIONS',authVersion:1};
export const financeActor={id:'finance',role:'FINANCE',authVersion:1};
export const assetAdmin={id:'admin',role:'ADMIN',authVersion:1};
export const assetNow=new Date('2027-02-15T10:00:00+08:00');
export const assetCommand=(revision=0)=>({revision,idempotencyKey:randomUUID()});
export const assetError=(code:string)=>(error:any)=>error.getResponse?.().error?.code===code;
const clone=<T>(value:T):T=>structuredClone(value);
/** Explicit synthetic registration facts for tests which exercise current activation. */
export function prepareBaasRegistration(f:ReturnType<typeof assetFixture>,id:string,monthly=false){
 const row=f.rows('vehicleBaasContract').find(row=>row.id===id),vehicle=f.rows('vehicle').find(vehicle=>vehicle.id===row.vehicleId),profile=f.rows('vehicleAssetProfile').find(profile=>profile.vehicleId===row.vehicleId);
 vehicle.vin='LTESTBAAS00000001';profile.registeredOwnerName='合成登记车主';if(!f.rows('vehicleOwner').some(owner=>owner.id==='synthetic-payer'))f.seed('vehicleOwner',{id:'synthetic-payer',name:'合成代付人',status:'DRAFT'});
 Object.assign(row,{supplierContractNumber:row.supplierContractNumber||'SYNTHETIC-'+id,lesseeName:'合成登记车主',payerOwnerId:'synthetic-payer',...(monthly?{billingCycle:'MONTHLY'}:{})});row.termsHash=canonicalHash(baasTerms(row));
}
function matches(row:any,where:any):boolean{
 if(!where)return true;
 return Object.entries(where).every(([key,value]:any)=>{
  if(key==='AND')return(Array.isArray(value)?value:[value]).every((part:any)=>matches(row,part));
  if(key==='OR')return value.some((part:any)=>matches(row,part));
  if(key==='NOT')return !matches(row,value);
  if(key.includes('_')&&row[key]===undefined&&value&&typeof value==='object')return matches(row,value);
  const actual=row[key];
  if(value&&typeof value==='object'&&!(value instanceof Date)&&!Array.isArray(value))return Object.entries(value).every(([op,wanted]:any)=>op==='in'?wanted.includes(actual):op==='notIn'?!wanted.includes(actual):op==='not'?!matches({x:actual},{x:wanted}):op==='equals'?actual===wanted:op==='lt'?actual<wanted:op==='lte'?actual<=wanted:op==='gt'?actual>wanted:op==='gte'?actual>=wanted:op==='contains'?String(actual).includes(wanted):matches(actual||{},value));
  return actual instanceof Date&&value instanceof Date?actual.getTime()===value.getTime():actual===value;
 });
}
export function assetFixture(){
 let sequence=0,tables:Record<string,any[]>={adminUser:[assetActor,financeActor,assetAdmin,{id:'support',role:'SUPPORT',authVersion:1},{id:'field',role:'FIELD',authVersion:1}].map(actor=>({...actor,active:true})),vehicle:[{id:'vehicle',title:'合成资产车辆',brand:'合成',model:'EV',vin:'SYNTHETIC000000001',plateNumber:'合成牌照',year:2026,revision:3,status:'DRAFT'}]};
 const writes:{table:string;action:string;data:any}[]=[],locks:string[]=[],tx:any={};
 const names=['adminUser','vehicle','vehicleOwner','partnerAgreement','partnerAgreementVersion','partnerAgreementVehicle','ownerVehicle','vehicleAssetProfile','vehicleBaasContract','vehicleBaasContractRevision','vehicleDepreciationPolicy','assetCostPlan','assetCostEntry','assetManualPaymentRecord','vehicleDocumentFile','assetPrivateFile','storedFile','archiveCommand','auditLog'];
 const view=(table:string,row:any,select?:any,include?:any)=>{
  if(!row)return null;let value=clone(row);
  if(include?.file)value.file=clone(tables.storedFile.find(item=>item.id===row.fileId));
  if(include?.vehicle)value.vehicle=clone(tables.vehicle.find(item=>item.id===row.vehicleId));
  if(select)value=Object.fromEntries(Object.keys(select).filter(key=>select[key]).map(key=>[key,value[key]]));return value;
 };
 for(const table of names){tables[table]??=[];tx[table]={
  findMany:async({where,select,include,orderBy,skip=0,take}:any={})=>{let rows=tables[table].filter(row=>matches(row,where));const order=orderBy?(Array.isArray(orderBy)?orderBy:[orderBy]):[];rows=[...rows].sort((a,b)=>{for(const field of order)for(const [key,direction]of Object.entries(field)){const compared=a[key]<b[key]?-1:a[key]>b[key]?1:0;if(compared)return direction==='desc'?-compared:compared;}return 0;});return rows.slice(skip,take===undefined?undefined:skip+take).map(row=>view(table,row,select,include));},
  findFirst:async(args:any={})=>(await tx[table].findMany({...args,take:1}))[0]??null,
  findUnique:async(args:any)=>tx[table].findFirst(args),
  findUniqueOrThrow:async(args:any)=>{const row=await tx[table].findFirst(args);if(!row)throw Error('Missing '+table);return row;},
  count:async({where}:any={})=>tables[table].filter(row=>matches(row,where)).length,
  aggregate:async({where,_sum}:any={})=>({_sum:Object.fromEntries(Object.keys(_sum||{}).map(field=>[field,tables[table].filter(row=>matches(row,where)).reduce((sum,row)=>sum+row[field],0)]))}),
  create:async({data,include,select}:any)=>{const defaults=table==='vehicleBaasContract'?{status:'DRAFT',firstCostPeriod:null,activatedAt:null}:table==='assetCostPlan'?{status:'SCHEDULED',confirmedAt:null}:table==='assetCostEntry'?{effect:'COST',lockedAt:null,reversalOfId:null,evidenceFileIds:[]}:table==='assetManualPaymentRecord'?{status:'RECORDED'}:{};const row={id:table+'-'+(++sequence),revision:0,createdAt:assetNow,updatedAt:assetNow,...defaults,...clone(data)};tables[table].push(row);writes.push({table,action:'create',data:clone(data)});return view(table,row,select,include);},
  updateMany:async({where,data}:any)=>{const rows=tables[table].filter(row=>matches(row,where));for(const row of rows){for(const [key,value]of Object.entries(data) as any){row[key]=value&&typeof value==='object'&&'increment'in value?(row[key]??0)+value.increment:clone(value);}writes.push({table,action:'update',data:clone(data)});}return{count:rows.length};},
  update:async({where,data,include,select}:any)=>{const row=tables[table].find(value=>matches(value,where));if(!row)throw Error('Missing '+table);await tx[table].updateMany({where,data});return view(table,row,select,include);},
 };}
 tx.$queryRaw=async(strings:TemplateStringsArray,...values:any[])=>{locks.push(strings.join('?')+' '+values.join(','));return[];};tx.$executeRaw=tx.$queryRaw;
 const serial=async<T>(operation:(tx:any)=>Promise<T>):Promise<T>=>{const before=clone(tables),count=writes.length;try{return await operation(tx);}catch(error){tables=before;writes.splice(count);throw error;}};
 return{tx,serial,writes,locks,rows:(table:string)=>tables[table],seed:(table:string,row:any)=>tables[table].push(clone(row)),revoke:(id:string)=>{tables.adminUser.find(row=>row.id===id).active=false;},attach:(kind:'BAAS'|'COST',resourceId:string,id='evidence')=>{const sha256='a'.repeat(64);tables.storedFile.push({id,customerId:null,adminId:assetActor.id,fieldTaskId:null,purpose:kind==='BAAS'?'asset-baas':'asset-cost',name:'合成证据.pdf',mimeType:'application/pdf',size:10,sha256,storagePath:'synthetic-not-read'});tables.assetPrivateFile.push({fileId:id,kind,baasContractId:kind==='BAAS'?resourceId:null,depreciationPolicyId:null,costEntryId:kind==='COST'?resourceId:null,licensePlateId:null,observationId:null,valuationReviewId:null,workOrderId:null,workOrderCostId:null,sha256,uploadedBy:assetActor.id});return id;}};
}
