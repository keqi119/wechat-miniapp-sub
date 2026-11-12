import {stageSwapSourceFixture} from './stage-swap-source-fixture';
import {UsageService} from '../src/usage/usage.service';
import {canonicalHash} from '../src/customers/types';

const date=(value:string)=>new Date(value+'T00:00:00Z');
const boundary=(value:string)=>new Date(value+'T00:00:00+08:00');
const copy=<T>(value:T):T=>structuredClone(value);

/** Plain in-memory persistence only. No Db/Prisma instance, hooks, sockets or provider. */
export async function legacyReadingFixture(firstSequence=13){
 const f=await stageSwapSourceFixture();
 f.order.effectiveTermsVersionId='renewal-terms';f.order.confirmedMileageKm=4500;
 f.snap.period.firstPeriodSequence=firstSequence;f.snap.period.lastPeriodSequence=firstSequence+11;
 f.snap.billingSchedule.forEach((p:any,i:number)=>{p.sequence=firstSequence+i;});
 f.stages[1]=f.row(f.snap);f.stages[1].snapshotHash=canonicalHash(f.snap);
 const account:any={...f.account,revision:0,packStatus:'ACTIVE',order:f.order};
 const earlier:any={id:'earlier',orderId:'order',accountId:'account',sequence:11,status:'SETTLED',startDate:date('2026-11-30'),endDate:date('2026-12-31'),effectiveEndDate:date('2026-12-31'),startReadingKm:3000,endReadingKm:4500};
 const previous:any={id:'legacy-month',orderId:'order',accountId:'account',account,sequence:12,stageSequence:null,serviceStageId:null,pricingSnapshot:null,status:'SETTLED',revision:2,startDate:date('2026-12-31'),endDate:date('2027-01-31'),effectiveEndDate:date('2027-01-31'),startReadingKm:4500,endReadingKm:7000,readingId:'legacy-reading',settledAt:new Date('2027-02-01T02:00:00Z'),settlementKey:'old-settlement',usedKm:2500,baseUsedKm:1500,packUsedKm:0,excessKm:1000,excessAmount:150000};
 const current:any={id:'renewal-month',orderId:'order',accountId:'account',account,sequence:firstSequence,serviceStageId:'stage-2',stageSequence:1,pricingSnapshot:copy(f.snap.usagePricing),status:'READY',revision:1,startDate:date('2027-01-31'),endDate:date('2027-02-28'),effectiveEndDate:date('2027-02-28'),startReadingKm:null,endReadingKm:10000,readingId:'renewal-reading'};
 const periods:any[]=[earlier,previous,...Array.from({length:firstSequence-13},(_,i)=>({id:'voided-'+i,orderId:'order',accountId:'account',sequence:13+i,status:'CANCELLED'})),current];
 const assignment:any={id:'current-assignment',orderId:'order',customerId:'customer',vehicleId:'current-car',status:'ACTIVE',startAt:boundary('2026-12-01'),endAt:null,startReadingKm:3000,endReadingKm:null,changeId:'earlier-real-swap'};
 const assignments:any[]=[assignment],segment:any={id:'new-segment',periodId:current.id,assignmentId:assignment.id,vehicleId:assignment.vehicleId,startAt:boundary('2027-01-31'),endAt:null,startReadingKm:null,endReadingKm:10000,readingId:'renewal-reading',endHandoverId:null,status:'READY',revision:1};
 const segments:any[]=[segment],readings:any[]=[{id:'legacy-reading',orderId:'order',customerId:'customer',periodId:previous.id,segmentId:null,assignmentId:null,readingKm:7000,recordedAt:new Date('2027-01-31T09:00:00+08:00'),status:'APPROVED',reviewedBy:'reviewer',fileIds:['legacy-photo'],createdAt:new Date('2027-01-31T10:00:00+08:00')},{id:'renewal-reading',orderId:'order',customerId:'customer',periodId:current.id,segmentId:segment.id,assignmentId:assignment.id,readingKm:10000,recordedAt:new Date('2027-02-28T09:00:00+08:00'),status:'APPROVED',reviewedBy:'reviewer',fileIds:['renewal-photo']}];
 const files:any[]=['legacy-photo','renewal-photo'].map(id=>({id,customerId:'customer',purpose:'mileage',mimeType:'image/jpeg',size:100,sha256:'a'.repeat(64),vehicleDocumentFile:{count:async()=>0},assetPrivateFile:null}));
 const staff:any[]=[{id:'reviewer',active:false,role:'SUPPORT'}],bills:any[]=[],audits:any[]=[],writes:any[]=[];
 const vehicle:any={id:'current-car',reservedOrderId:'order',status:'IN_USE',mileageKm:999999};
 const match=(row:any,w:any={})=>{
  for(const k of ['id','orderId','accountId','periodId','assignmentId','customerId'])if(w[k]!==undefined){if(typeof w[k]==='object'){if(w[k].not!==undefined&&row[k]===w[k].not||w[k].in&&!w[k].in.includes(row[k]))return false;}else if(row[k]!==w[k])return false;}
  if(w.sequence?.lt!==undefined&&row.sequence>=w.sequence.lt)return false;
  if(typeof w.status==='string'&&row.status!==w.status||w.status?.not!==undefined&&w.status.not===row.status||w.status?.notIn?.includes(row.status))return false;
  if(w.startAt?.lt&&row.startAt>=w.startAt)return false;
  if(w.endReadingKm?.not===null&&row.endReadingKm==null)return false;
  if(w.OR&&!w.OR.some((o:any)=>o.endAt===null?row.endAt===null:o.endAt?.gt&&row.endAt&&row.endAt>o.endAt.gt))return false;
  return true;
 };
 const update=(rows:any[],where:any,data:any,kind:string)=>{const row=rows.find(r=>r.id===where.id);if(!row)throw Error('missing '+kind);writes.push({kind,id:row.id,data:copy(data)});for(const [key,value]of Object.entries(data)){if(key==='revision'&&typeof value==='object')row[key]=(row[key]||0)+(value as any).increment;else row[key]=value;}return copy(row);};
 Object.assign(f.tx,{
  order:{findUnique:async()=>f.order,update:async({data}:any)=>{if(data.revision)f.order.revision++;if(data.confirmedMileageKm!==undefined)f.order.confirmedMileageKm=data.confirmedMileageKm;return f.order;},updateMany:async()=>({count:1})},
  usageAccount:{findUnique:async()=>account,update:async()=>{account.revision++;return account;}},
  usagePeriod:{findUnique:async({where}:any)=>periods.find(p=>p.id===where.id)??null,findUniqueOrThrow:async({where}:any)=>periods.find(p=>where.id?p.id===where.id:p.sequence===where.orderId_sequence.sequence)??{startReadingKm:0},findMany:async({where}:any)=>periods.filter(p=>match(p,where)),findFirst:async({where}:any)=>periods.filter(p=>match(p,where)).sort((a,b)=>b.sequence-a.sequence)[0]??null,count:async({where}:any)=>periods.filter(p=>match(p,where)).length,update:async({where,data}:any)=>update(periods,where,data,'period')},
  usageSegment:{findMany:async({where}:any)=>segments.filter(s=>match(s,where)).sort((a,b)=>a.startAt-b.startAt).map(s=>({...copy(s),assignment:copy(assignments.find(a=>a.id===s.assignmentId))})),findFirst:async({where}:any)=>segments.filter(s=>match(s,where)).sort((a,b)=>b.startAt-a.startAt)[0]??null,count:async({where}:any)=>segments.filter(s=>match(s,where)).length,update:async({where,data}:any)=>update(segments,where,data,'segment')},
  vehicleAssignment:{findUnique:async({where}:any)=>assignments.find(a=>a.id===where.id)??null,findFirst:async()=>null,findMany:async({where}:any)=>assignments.filter(a=>match(a,where)),count:async()=>assignments.length},
  mileage:{findUnique:async({where}:any)=>readings.find(r=>r.id===where.id)??null,findUniqueOrThrow:async({where}:any)=>{const r=readings.find(r=>r.id===where.id);if(!r)throw Error('missing mileage');return r;},update:async({where,data}:any)=>update(readings,where,data,'reading')},
  storedFile:{findMany:async({where}:any)=>files.filter(file=>match(file,where))},adminUser:{findUnique:async({where}:any)=>staff.find(s=>s.id===where.id)??null},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},
  vehicle:{findUniqueOrThrow:async()=>vehicle,update:async({data}:any)=>Object.assign(vehicle,data)},vehicleReceiptEvent:{findFirst:async()=>null},orderChange:{findFirst:async()=>null},
  mileagePurchase:{count:async()=>0,findMany:async()=>[]},bill:{create:async({data}:any)=>{const row={id:'bill-'+bills.length,...data};bills.push(row);return row;}},auditLog:{create:async({data}:any)=>{audits.push(data);return data;}}
 });
 const service=new UsageService({serial:async(fn:any)=>fn(f.tx)} as any,()=>new Date('2027-02-28T04:00:00Z'));
 const addStale=()=>segments.push({id:'stale-segment',periodId:earlier.id,assignmentId:assignment.id,vehicleId:assignment.vehicleId,startAt:boundary('2026-12-01'),endAt:boundary('2026-12-31'),startReadingKm:3000,endReadingKm:4500,status:'FROZEN',revision:0,readingId:null,endHandoverId:null});
 return{...f,account,previous,current,periods,segment,segments,assignment,assignments,readings,files,staff,bills,audits,writes,vehicle,service,addStale};
}
