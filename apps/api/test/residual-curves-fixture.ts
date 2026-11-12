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
export function residualCurveFixture(){
 let sequence=0,tables:Record<string,any[]>={
  adminUser:[curveOperator,curveFinance,{id:'admin',role:'ADMIN',authVersion:1},{id:'support',role:'SUPPORT',authVersion:1},{id:'field',role:'FIELD',authVersion:1}].map(row=>({...row,active:true})),
  modelDefinition:[{id:'model',revision:0,brand:'合成',name:'EV',modelYear:2026}],
  marketPriceObservation:[0,1,2].map(index=>({id:'observation-'+index,revision:0,modelDefinitionId:'model',modelSnapshot:{id:'model',revision:0,brand:'合成',name:'EV',modelYear:2026},source:'MANUAL',sourceListingId:null,observedOn:new Date('2026-10-30'),priceType:'TRANSACTION',priceAmount:100001+2*index,batteryOwnership:'OWNED',batteryCapacityKwh:null,mileageKm:1000,registrationDate:new Date('2025-10-31'),vehicleAgeMonths:null,province:'上海',city:'上海',trim:'',conditionGrade:'A',batteryHealthPercent:95,accidentFlag:false,sourceUrl:null,sourceNote:'本地真实样本依据',dedupeKey:String(index).repeat(64),confidenceScore:100,status:'ACTIVE',createdBy:'operator',updatedBy:'operator'})),
  vehicleResidualCurve:[],vehicleResidualCurvePoint:[],archiveCommand:[],auditLog:[],
 };
 const writes:{table:string;action:string}[]=[],locks:string[]=[],queries:{table:string;where:any}[]=[],tx:any={};
 for(const table of Object.keys(tables)){
  const view=(row:any,args:any={})=>{if(!row)return null;let result=copy(row);if(args.include?.points)result.points=tables.vehicleResidualCurvePoint.filter(p=>p.curveId===row.id).sort((a,b)=>a.ageMonth-b.ageMonth).map(copy);if(args.select)result=Object.fromEntries(Object.entries(args.select).filter(([,yes])=>yes).map(([key])=>[key,result[key]]));return result;};
  tx[table]={
   findMany:async(args:any={})=>{queries.push({table,where:copy(args.where)});let rows=tables[table].filter(row=>matches(row,args.where));for(const order of [...(Array.isArray(args.orderBy)?args.orderBy:args.orderBy?[args.orderBy]:[])].reverse())for(const [field,direction]of Object.entries(order))rows=[...rows].sort((a,b)=>(a[field]<b[field]?-1:a[field]>b[field]?1:0)*(direction==='desc'?-1:1));return rows.slice(args.skip??0,args.take===undefined?undefined:(args.skip??0)+args.take).map(row=>view(row,args));},
   findUnique:async(args:any)=>view(tables[table].find(row=>matches(row,args.where)),args),
   findFirst:async(args:any={})=>(await tx[table].findMany({...args,take:1}))[0]??null,
   count:async(args:any={})=>tables[table].filter(row=>matches(row,args.where)).length,
   create:async(args:any)=>{const row={id:table+'-'+(++sequence),revision:0,createdAt:curveNow,updatedAt:curveNow,...(table==='vehicleResidualCurve'?{status:'DRAFT',effectiveFrom:null,activatedAt:null,activatedBy:null,supersededAt:null,archivedAt:null}:{}),...copy(args.data)};tables[table].push(row);writes.push({table,action:'create'});return view(row,args);},
   updateMany:async({where,data}:any)=>{const rows=tables[table].filter(row=>matches(row,where));for(const row of rows){for(const [key,value]of Object.entries(data) as any)row[key]=value&&typeof value==='object'&&'increment'in value?row[key]+value.increment:copy(value);writes.push({table,action:'update'});}return{count:rows.length};},
  };
 }
 tx.$queryRaw=async(parts:TemplateStringsArray,...values:any[])=>{locks.push(parts.join('?')+' '+values.join(','));return[];};tx.$executeRaw=tx.$queryRaw;
 const serial=async<T>(operation:(tx:any)=>Promise<T>)=>{const saved=copy(tables),count=writes.length;try{return await operation(tx);}catch(error){tables=saved;writes.splice(count);throw error;}};
 return{tx,serial,writes,locks,queries,rows:(table:string)=>tables[table],seed:(table:string,row:any)=>tables[table].push(copy(row))};
}
