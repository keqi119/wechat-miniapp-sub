import {randomUUID} from 'node:crypto';
import {ResidualCurvesService} from '../src/residual-market/curves';
import {ResidualForecastsService} from '../src/residual-market/forecasts';
export const curveOperator={id:'operator',role:'OPERATIONS',authVersion:1};
export const curveFinance={id:'finance',role:'FINANCE',authVersion:1};
export const curveNow=new Date('2026-10-31T00:10:00+08:00');
export const curveError=(code:string)=>(error:any)=>error.getResponse?.().error?.code===code;
export const curveRequest=(extra:Record<string,unknown>={})=>({modelDefinitionId:'model',modelRevision:0,name:'合成残值曲线',...extra});
const copy=<T>(value:T):T=>structuredClone(value);
function matches(row:any,where:any):boolean{
 if(!where)return true;return Object.entries(where).every(([key,value]:any)=>{
  if(key==='OR')return value.some((item:any)=>matches(row,item));if(key==='AND')return(Array.isArray(value)?value:[value]).every((item:any)=>matches(row,item));
  if(key.includes('_')&&row[key]===undefined&&value&&typeof value==='object')return matches(row,value);
  const actual=row[key];if(value&&typeof value==='object'&&!(value instanceof Date)&&!Array.isArray(value))return Object.entries(value).every(([op,wanted]:any)=>op==='in'?wanted.includes(actual):op==='not'?actual!==wanted:op==='gte'?actual>=wanted:op==='lte'?actual<=wanted:op==='contains'?String(actual).includes(wanted):op==='mode'?true:matches(actual||{},value));
  return actual instanceof Date&&value instanceof Date?actual.getTime()===value.getTime():actual===value;
 });
}
export function residualForecastFixture(){
 let sequence=0,tables:Record<string,any[]>={
  adminUser:[curveOperator,curveFinance,{id:'admin',role:'ADMIN',authVersion:1},{id:'support',role:'SUPPORT',authVersion:1},{id:'field',role:'FIELD',authVersion:1}].map(row=>({...row,active:true})),
  modelDefinition:[{id:'model',revision:0,brand:'合成',name:'EV',modelYear:2026}],
  marketPriceObservation:[0,1,2].map(index=>({id:'observation-'+index,revision:0,modelDefinitionId:'model',modelSnapshot:{id:'model',revision:0,brand:'合成',name:'EV',modelYear:2026},source:'MANUAL',sourceListingId:null,observedOn:new Date('2026-10-30'),priceType:'TRANSACTION',priceAmount:100001+2*index,batteryOwnership:'OWNED',batteryCapacityKwh:null,mileageKm:1000,registrationDate:new Date('2025-10-31'),vehicleAgeMonths:null,province:'上海',city:'上海',trim:'',conditionGrade:'A',batteryHealthPercent:95,accidentFlag:false,sourceUrl:null,sourceNote:'本地真实样本依据',dedupeKey:String(index).repeat(64),confidenceScore:100,status:'ACTIVE',createdBy:'operator',updatedBy:'operator'})),
  vehicle:[{id:'vehicle',revision:0,modelDefinitionId:'model',title:'冻结车辆',brand:'合成',model:'EV',year:2026,vin:'SYNTHETIC-VIN',plateNumber:'测试车牌'}],
  vehicleAssetProfile:[{vehicleId:'vehicle',revision:0,batteryOwnership:'OWNED',batteryCapacityKwh:'75.500',firstRegistrationDate:new Date('2025-10-31'),notes:'真实资产依据'}],
  vehicleResidualCurve:[],vehicleResidualCurvePoint:[],vehicleResidualForecast:[],vehicleResidualForecastPoint:[],vehicleValuationReview:[],vehicleDocumentFile:[],assetPrivateFile:[],archiveCommand:[],auditLog:[],
 };
 const writes:{table:string;action:string}[]=[],locks:string[]=[],queries:{table:string;where:any}[]=[],tx:any={};
 for(const table of Object.keys(tables)){
  const view=(row:any,args:any={})=>{if(!row)return null;let result=copy(row);if(args.include?.points)result.points=(table==='vehicleResidualCurve'?tables.vehicleResidualCurvePoint.filter(p=>p.curveId===row.id).sort((a,b)=>a.ageMonth-b.ageMonth):tables.vehicleResidualForecastPoint.filter(p=>p.forecastId===row.id).sort((a,b)=>a.horizonMonth-b.horizonMonth)).map(copy);if(args.select)result=Object.fromEntries(Object.entries(args.select).filter(([,yes])=>yes).map(([key])=>[key,result[key]]));return result;};
  tx[table]={
   findMany:async(args:any={})=>{queries.push({table,where:copy(args.where)});let rows=tables[table].filter(row=>matches(row,args.where));for(const order of [...(Array.isArray(args.orderBy)?args.orderBy:args.orderBy?[args.orderBy]:[])].reverse())for(const [field,direction]of Object.entries(order))rows=[...rows].sort((a,b)=>(a[field]<b[field]?-1:a[field]>b[field]?1:0)*(direction==='desc'?-1:1));return rows.slice(args.skip??0,args.take===undefined?undefined:(args.skip??0)+args.take).map(row=>view(row,args));},
   findUnique:async(args:any)=>view(tables[table].find(row=>matches(row,args.where)),args),
   findFirst:async(args:any={})=>(await tx[table].findMany({...args,take:1}))[0]??null,
   count:async(args:any={})=>tables[table].filter(row=>matches(row,args.where)).length,
   create:async(args:any)=>{const row={id:table+'-'+(++sequence),revision:0,createdAt:curveNow,updatedAt:curveNow,...(table==='vehicleResidualCurve'?{status:'DRAFT',effectiveFrom:null,activatedAt:null,activatedBy:null,supersededAt:null,archivedAt:null}:table==='vehicleResidualForecast'?{status:'GENERATED'}:table==='vehicleResidualForecastPoint'?{adoptedAmount:null,adoptReason:null,adoptedBy:null,adoptedAt:null}:table==='vehicleValuationReview'?{status:'PENDING',approvedAmount:null,decidedBy:null,decidedAt:null,decisionReason:null,nextReviewDate:null,evidenceFileIds:[],evidenceSnapshot:null}:{}),...copy(args.data)};tables[table].push(row);writes.push({table,action:'create'});return view(row,args);},
   updateMany:async({where,data}:any)=>{const rows=tables[table].filter(row=>matches(row,where));for(const row of rows){for(const [key,value]of Object.entries(data) as any)row[key]=value&&typeof value==='object'&&'increment'in value?row[key]+value.increment:copy(value);writes.push({table,action:'update'});}return{count:rows.length};},
  };
 }
 tx.$queryRaw=async(parts:TemplateStringsArray,...values:any[])=>{locks.push(parts.join('?')+' '+values.join(','));return[];};tx.$executeRaw=tx.$queryRaw;
 const serial=async<T>(operation:(tx:any)=>Promise<T>)=>{const saved=copy(tables),count=writes.length;try{return await operation(tx);}catch(error){tables=saved;writes.splice(count);throw error;}};
 return{tx,serial,writes,locks,queries,rows:(table:string)=>tables[table],seed:(table:string,row:any)=>tables[table].push(copy(row))};
}

export function seedValuationEvidence(f:ReturnType<typeof residualForecastFixture>,reviewId:string,id='evidence'){
 const file={id,name:'依据.pdf',mimeType:'application/pdf',size:40,sha256:'a'.repeat(64),purpose:'asset-valuation',customerId:null,fieldTaskId:null,adminId:curveOperator.id};
 f.seed('assetPrivateFile',{fileId:id,kind:'VALUATION',baasContractId:null,depreciationPolicyId:null,costEntryId:null,licensePlateId:null,observationId:null,valuationReviewId:reviewId,workOrderId:null,workOrderCostId:null,sha256:file.sha256,uploadedBy:curveOperator.id,file});return id;
}

export const forecastCommand=(revision=0)=>({revision,idempotencyKey:randomUUID()});
export async function forecastSetup(active=true,dimension:Record<string,unknown>={}){
 const f=residualForecastFixture(),curves=new ResidualCurvesService(()=>curveNow),service=new ResidualForecastsService(()=>curveNow);
 for(const row of [...f.rows('marketPriceObservation')])f.seed('marketPriceObservation',{...row,id:row.id+'-older',registrationDate:new Date('2024-10-31'),priceAmount:row.priceAmount-20000});
 for(const row of f.rows('marketPriceObservation')){if(dimension.trim)row.trim=dimension.trim;if(dimension.batteryOwnership)row.batteryOwnership=dimension.batteryOwnership;if(dimension.batteryCapacityKwh)row.batteryCapacityKwh=dimension.batteryCapacityKwh;}
 const request=curveRequest({referencePriceAmount:200000,...dimension}),preview=await curves.preview(f.tx,curveOperator,request),draft=await f.serial(tx=>curves.create(tx,curveOperator,{...request,...forecastCommand(),previewHash:preview.previewHash}));
 const curve=active?await f.serial(tx=>curves.activate(tx,curveOperator,draft.id,{...forecastCommand(),effectiveFrom:'2026-10-31',reason:'真实统计曲线'})):draft;
 const input={vehicleId:'vehicle',curveId:curve.id,asOfDate:'2026-10-31',horizonMonths:[0,6,12,24]};return{...f,curves,service,curve,input};
}
export async function savedForecast(){const f=await forecastSetup(),preview=await f.service.preview(f.tx,curveFinance,f.input),body={...f.input,...forecastCommand(),assetRevision:0,curveRevision:f.curve.revision,previewHash:preview.previewHash},row=await f.serial(tx=>f.service.create(tx,curveOperator,body));return{...f,preview,body,row};}

