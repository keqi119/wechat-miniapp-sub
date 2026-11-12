import {randomUUID} from 'node:crypto';
export const actor={id:'operator',role:'OPERATIONS',authVersion:1},finance={id:'finance',role:'FINANCE',authVersion:1};
export const cmd=(revision=0)=>({revision,idempotencyKey:randomUUID()});
export const code=(expected:string)=>(error:any)=>error.getResponse?.().error?.code===expected;
export const observation=(extra:any={})=>({modelDefinitionId:'model',modelRevision:2,source:'MANUAL',sourceListingId:null,observedOn:'2026-10-30',priceType:'TRANSACTION',priceAmount:1234500,batteryOwnership:'UNKNOWN',batteryCapacityKwh:null,mileageKm:0,registrationDate:null,vehicleAgeMonths:null,province:'',city:'',trim:'',conditionGrade:'',batteryHealthPercent:null,accidentFlag:null,sourceUrl:null,sourceNote:'明确人工观察',correctionOfId:null,...extra});
const clone=<T>(value:T):T=>structuredClone(value);
function matches(row:any,where:any):boolean{return !where||Object.entries(where).every(([key,value]:any)=>{
 if(key==='OR')return value.some((part:any)=>matches(row,part));if(key==='AND')return value.every((part:any)=>matches(row,part));
 if(key.includes('_')&&row[key]===undefined)return matches(row,value);const actual=row[key];
 if(value&&typeof value==='object'&&!(value instanceof Date))return Object.entries(value).every(([op,wanted]:any)=>op==='in'?wanted.includes(actual):op==='not'?actual!==wanted:op==='gte'?actual>=wanted:op==='lte'?actual<=wanted:op==='contains'?String(actual).includes(wanted):matches(actual||{},value));return actual instanceof Date?actual.getTime()===new Date(value).getTime():actual===value;
});}
export function fixture(){
 let sequence=0,tables:Record<string,any[]>={adminUser:[{...actor,active:true},{...finance,active:true}],modelDefinition:[{id:'model',revision:2,brand:'合成品牌',name:'合成车型',modelYear:2026}],marketPriceObservation:[],marketPriceImportBatch:[],archiveCommand:[],auditLog:[],vehicleDocumentFile:[],assetPrivateFile:[],storedFile:[]};
 const writes:any[]=[],reads:any[]=[],locks:string[]=[],tx:any={};
 for(const table of Object.keys(tables)){
  tx[table]={findMany:async(args:any={})=>{reads.push({table,args:clone(args)});const rows=tables[table].filter(row=>matches(row,args.where));return rows.slice(args.skip||0,args.take===undefined?undefined:(args.skip||0)+args.take).map(clone);},findFirst:async(args:any={})=>(await tx[table].findMany({...args,take:1}))[0]||null,findUnique:async(args:any)=>tx[table].findFirst(args),count:async(args:any={})=>tables[table].filter(row=>matches(row,args.where)).length,
   create:async({data}:any)=>{const row={id:table+'-'+(++sequence),revision:0,status:'ACTIVE',createdAt:new Date('2026-10-31T02:00:00Z'),updatedAt:new Date('2026-10-31T02:00:00Z'),...clone(data)};tables[table].push(row);writes.push({table,action:'create',data:clone(data)});return clone(row);},
   createMany:async({data}:any)=>{for(const row of data)await tx[table].create({data:row});return{count:data.length};},
   updateMany:async({where,data}:any)=>{const rows=tables[table].filter(row=>matches(row,where));for(const row of rows){for(const [key,value]of Object.entries(data)as any)row[key]=value&&typeof value==='object'&&'increment'in value?row[key]+value.increment:clone(value);writes.push({table,action:'update',data:clone(data)});}return{count:rows.length};}};
 }
 tx.$executeRaw=async(strings:TemplateStringsArray,...values:any[])=>{locks.push(strings.join('?')+':'+values.join(','));return 0;};tx.$queryRaw=async(strings:TemplateStringsArray,...values:any[])=>{locks.push(strings.join('?')+':'+values.join(','));return[];};
 let pending=Promise.resolve();const serial=<T>(fn:(tx:any)=>Promise<T>):Promise<T>=>{const operation=pending.then(async()=>{const before=clone(tables),length=writes.length;try{return await fn(tx);}catch(error){tables=before;writes.splice(length);throw error;}});pending=operation.then(()=>{},()=>{});return operation;};
 return{tx,serial,writes,reads,locks,rows:(table:string)=>tables[table],seed:(table:string,row:any)=>tables[table].push(clone(row))};
}
