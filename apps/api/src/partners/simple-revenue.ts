import {z} from 'zod';
import {isVirtualVehicle} from '../virtual-acceptance/scope';
import {ensure} from '../common/errors';
import {lockOrder} from '../offline-documents/readiness';
import {readableFileName} from '../files/filename';
import {readBillRevenueSource,type BillRevenueSource} from '../order-service-stages/revenue-source';

const MAX_CENTS=2147483647;
const cents=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0&&n<=MAX_CENTS;
const validDate=(v:unknown):v is Date=>v instanceof Date&&Number.isFinite(v.getTime());
const rounded=(amount:bigint,rate:number)=>(amount*BigInt(rate)+5000n)/10000n;
function safeNumber(n:bigint){ensure(n<=BigInt(Number.MAX_SAFE_INTEGER)&&n>=BigInt(Number.MIN_SAFE_INTEGER),409,'REVENUE_AMOUNT_RANGE','金额合计超出可安全展示范围，请缩小查询范围');return Number(n);}
const snapshotInput=z.object({mode:z.literal('SIMPLE_AGREEMENT'),ownerId:z.string().min(1),agreementId:z.string().min(1),agreementVersionId:z.string().min(1),versionId:z.string().min(1),contentHash:z.string().regex(/^[a-f0-9]{64}$/i),title:z.string(),partnerRateBps:z.number().int().min(0).max(10000),vehicleId:z.string().min(1),modelId:z.string().nullable(),modelName:z.string(),plateNumber:z.string(),validFrom:z.string().nullable(),validUntil:z.string().nullable()});
async function verifiedSnapshot(tx:any,payment:any){
 const source=await readBillRevenueSource(tx,payment.bill);
 if(!source.verified||source.staged&&(payment.billId!==payment.bill.id||payment.customerId!==payment.bill.customerId||payment.amount!==payment.bill.amount))return null;
 const parsed=snapshotInput.safeParse(source.snapshot);if(!parsed.success)return null;
 const s=parsed.data;if(s.versionId!==s.agreementVersionId)return null;
 const version=await tx.partnerAgreementVersion.findUnique({where:{id:s.agreementVersionId}});
 if(!version||version.ownerId!==s.ownerId||version.agreementId!==s.agreementId||version.contentHash!==s.contentHash||version.partnerRateBps!==s.partnerRateBps||!version.vehicleIds.includes(s.vehicleId))return null;
 return s;
}
const paymentInclude={bill:{include:{order:true}}};
function paymentEligible(p:any){return p?.status==='SUCCEEDED'&&(p.bill?.type==='SUBSCRIPTION'||p.bill?.type==='SWAP_ADJUSTMENT'&&p.bill.serviceStageId!=null)&&!p.reconciliationRequired&&!!p.providerTransactionId&&cents(p.amount)&&validDate(p.succeededAt);}
function eventData(p:any,s:z.infer<typeof snapshotInput>){return{paymentId:p.id,orderId:p.bill.orderId,ownerId:s.ownerId,agreementId:s.agreementId,agreementVersionId:s.agreementVersionId,vehicleId:s.vehicleId,modelId:s.modelId,modelName:s.modelName,plateNumber:s.plateNumber,partnerRateBps:s.partnerRateBps};}

/** Called only inside a verified success/reconciliation transaction. GET never repairs history. */
export async function recordSimpleRevenuePayment(tx:any,paymentId:string){
 const reference=await tx.payment.findUnique({where:{id:paymentId},include:paymentInclude});
 if(!paymentEligible(reference))return null;
 if(await isVirtualVehicle(tx,reference.bill.order.vehicleId))return null;
 await lockOrder(tx,reference.bill.orderId);
 const p=await tx.payment.findUnique({where:{id:paymentId},include:paymentInclude});if(!paymentEligible(p))return null;
 const existing=await tx.partnerRevenueEvent.findUnique({where:{sourceType_sourceId:{sourceType:'PAYMENT',sourceId:paymentId}}});
 const s=existing?null:await verifiedSnapshot(tx,p);if(!existing&&!s)return null;
 const receipt=existing||await tx.partnerRevenueEvent.create({data:{...eventData(p,s!),sourceType:'PAYMENT',sourceId:paymentId,amount:p.amount,partnerAmount:safeNumber(rounded(BigInt(p.amount),s!.partnerRateBps)),occurredAt:p.succeededAt}});
 // Resolved anomalies may already have refunds. Replay only their immutable
 // successful facts, never reconciliation/update time or old settlement nets.
 const refunds=await tx.refund.findMany({where:{paymentId,status:'SUCCEEDED'},orderBy:[{succeededAt:'asc'},{id:'asc'}]});
 for(const refund of refunds)await recordRefundFromReceipt(tx,p,receipt,refund);
 return receipt;
}
async function recordRefundFromReceipt(tx:any,p:any,receipt:any,refund:any){
 const existing=await tx.partnerRevenueEvent.findUnique({where:{sourceType_sourceId:{sourceType:'REFUND',sourceId:refund.id}}});if(existing)return existing;
 if(refund.status!=='SUCCEEDED'||!refund.providerRefundId||!cents(refund.amount)||!validDate(refund.succeededAt))return null;
 const recorded=await tx.partnerRevenueEvent.findMany({where:{paymentId:p.id,sourceType:'REFUND'},select:{amount:true,partnerAmount:true}});
 const refunded=recorded.reduce((sum:bigint,r:any)=>sum-BigInt(r.amount),0n),next=refunded+BigInt(refund.amount);
 // Preserve true channel facts even when an old, inconsistent source cannot
 // safely be projected. The missing event is exposed as incomplete by reads.
 if(next>BigInt(p.amount)||refunded<0n)return null;
 const partnerBefore=rounded(BigInt(p.amount)-refunded,receipt.partnerRateBps),partnerAfter=rounded(BigInt(p.amount)-next,receipt.partnerRateBps);
 const {id:_id,createdAt:_createdAt,sourceType:_sourceType,sourceId:_sourceId,amount:_amount,partnerAmount:_partnerAmount,occurredAt:_occurredAt,...frozen}=receipt;
 return tx.partnerRevenueEvent.create({data:{...frozen,sourceType:'REFUND',sourceId:refund.id,amount:-refund.amount,partnerAmount:safeNumber(partnerAfter-partnerBefore),occurredAt:refund.succeededAt}});
}
export async function recordSimpleRevenueRefund(tx:any,refundId:string){
 const refund=await tx.refund.findUnique({where:{id:refundId},include:{payment:{include:paymentInclude}}});
 if(!refund||!paymentEligible(refund.payment))return null;
 await recordSimpleRevenuePayment(tx,refund.paymentId);
 return tx.partnerRevenueEvent.findUnique({where:{sourceType_sourceId:{sourceType:'REFUND',sourceId:refundId}}});
}

const dateInput=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;},'日期无效');
export const simpleRevenueQuery=z.object({from:dateInput.optional(),to:dateInput.optional(),agreementId:z.string().min(1).max(128).optional(),modelId:z.string().min(1).max(128).optional(),vehicleId:z.string().min(1).max(128).optional(),groupBy:z.enum(['month','agreement','model','vehicle']).default('month'),page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).strict();
type Totals={receivedAmount:number;refundedAmount:number;netAmount:number;partnerAmount:number;platformAmount:number};
function total(rows:any[]):Totals{
 let received=0n,refunded=0n,partner=0n;for(const row of rows){const amount=BigInt(row.amount);if(amount>=0n)received+=amount;else refunded-=amount;partner+=BigInt(row.partnerAmount);}
 const net=received-refunded;return{receivedAmount:safeNumber(received),refundedAmount:safeNumber(refunded),netAmount:safeNumber(net),partnerAmount:safeNumber(partner),platformAmount:safeNumber(net-partner)};
}
const beijingMonth=(date:Date)=>new Date(date.getTime()+8*3600000).toISOString().slice(0,7);

/** Identical, read-only projection for the scoped admin and company portals. */
export async function readSimpleRevenue(tx:any,ownerId:string,raw:unknown={}){
 const q=simpleRevenueQuery.parse(raw),month=beijingMonth(new Date()),from=q.from||`${month}-01`,to=q.to||new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
 ensure(from<=to,400,'REVENUE_DATE_RANGE','结束日期不可早于开始日期');
 const start=new Date(from+'T00:00:00+08:00'),end=new Date(new Date(to+'T00:00:00+08:00').getTime()+86400000);
 ensure(await tx.vehicleOwner.findUnique({where:{id:ownerId},select:{id:true}}),404,'NOT_FOUND','合作商不存在');
 const [events,versions,bindings]=await Promise.all([
  tx.partnerRevenueEvent.findMany({where:{ownerId},orderBy:[{occurredAt:'desc'},{id:'desc'}]}),
  tx.partnerAgreementVersion.findMany({where:{ownerId},select:{id:true,agreementId:true,title:true,vehicleIds:true}}),
  tx.partnerAgreementVehicle.findMany({where:{ownerId},select:{vehicleId:true}}),
 ]);
 const paymentIds=Array.from(new Set<string>(events.map((e:any)=>e.paymentId)));
 const payments=await tx.payment.findMany({where:{status:'SUCCEEDED',bill:{OR:[{type:'SUBSCRIPTION'},{type:'SWAP_ADJUSTMENT',serviceStageId:{not:null}}]},OR:[{id:{in:paymentIds}},{bill:{serviceStageId:null,order:{OR:[{finalPlanSnapshot:{path:['revenueRuleSnapshot','ownerId'],equals:ownerId}},{finalPlanSnapshot:{path:['lessorSnapshot','ownerId'],equals:ownerId}}]}}},{bill:{serviceStage:{ownerId}}}]},include:{...paymentInclude,refunds:{where:{status:'SUCCEEDED'}}}});
 const sources=new Map<string,BillRevenueSource>(await Promise.all(payments.map(async(p:any)=>[p.id,await readBillRevenueSource(tx,p.bill)] as const)));
 const knownVehicles=Array.from(new Set<string>([...bindings.map((b:any)=>b.vehicleId),...versions.flatMap((v:any)=>v.vehicleIds),...events.map((e:any)=>e.vehicleId)]));
 const vehicles=q.modelId?await tx.vehicle.findMany({where:{id:{in:knownVehicles}},select:{modelDefinitionId:true}}):[];
 if(q.agreementId)ensure(versions.some((v:any)=>v.agreementId===q.agreementId)||events.some((e:any)=>e.agreementId===q.agreementId),404,'NOT_FOUND','筛选条件不存在');
 if(q.vehicleId)ensure(knownVehicles.includes(q.vehicleId),404,'NOT_FOUND','筛选条件不存在');
 if(q.modelId)ensure(events.some((e:any)=>e.modelId===q.modelId)||vehicles.some((v:any)=>v.modelDefinitionId===q.modelId)||payments.some((p:any)=>sources.get(p.id)?.ownerId===ownerId&&sources.get(p.id)?.snapshot?.modelId===q.modelId),404,'NOT_FOUND','筛选条件不存在');
 const inPeriod=(at:unknown)=>validDate(at)&&at>=start&&at<end;
 const match=(s:any,unknown=false)=>['agreementId','modelId','vehicleId'].every(key=>!q[key as keyof typeof q]||(unknown&&s?.[key]==null)||s?.[key]===q[key as keyof typeof q]);
 const paymentMap=new Map<string,any>(payments.map((p:any)=>[p.id,p]));
 const usable=events.filter((e:any)=>{const p=paymentMap.get(e.paymentId);if(!p||p.reconciliationRequired||!p.providerTransactionId)return false;return e.sourceType==='PAYMENT'?p.id===e.sourceId:p.refunds.some((r:any)=>r.id===e.sourceId&&r.providerRefundId);});
 const eventKeys=new Set(usable.map((e:any)=>`${e.sourceType}:${e.sourceId}`)),recordedKeys=new Set(events.map((e:any)=>`${e.sourceType}:${e.sourceId}`));let incompleteCount=0;
 for(const p of payments){
  const source=sources.get(p.id);if(source?.ownerId!==ownerId)continue;
  if(p.reconciliationRequired&&(!source.staged||p.status!=='SUCCEEDED'||!p.providerTransactionId||!cents(p.amount)||!validDate(p.succeededAt)))continue;
  const snapshot=source.snapshot;
  if(!match(snapshot,true))continue;
  const known=p.reconciliationRequired?recordedKeys:eventKeys;
  for(const source of [{type:'PAYMENT',row:p},...p.refunds.map((row:any)=>({type:'REFUND',row}))])if(!known.has(`${source.type}:${source.row.id}`)&&(!validDate(source.row.succeededAt)||inPeriod(source.row.succeededAt)))incompleteCount++;
 }
 const rows=usable.filter((e:any)=>inPeriod(e.occurredAt)&&match(e));
 const titleByVersion=new Map<string,string>(versions.map((v:any)=>[v.id,readableFileName(v.title)]));
 const grouped=new Map<string,{label:string;rows:any[]}>();
 for(const row of rows){const key=q.groupBy==='month'?beijingMonth(row.occurredAt):q.groupBy==='agreement'?row.agreementId:q.groupBy==='model'?(row.modelId||`name:${row.modelName}`):row.vehicleId;const label=q.groupBy==='month'?key:q.groupBy==='agreement'?(titleByVersion.get(row.agreementVersionId)||'协议'):q.groupBy==='model'?row.modelName:(row.plateNumber||'未登记车牌');const group:{label:string;rows:any[]}=grouped.get(key)||{label,rows:[]};group.rows.push(row);grouped.set(key,group);}
 const groups=Array.from(grouped.entries()).sort(([a],[b])=>a.localeCompare(b)).map(([key,g])=>({key,label:g.label,...total(g.rows),count:g.rows.length}));
 const items=rows.slice((q.page-1)*q.pageSize,q.page*q.pageSize).map((e:any)=>({id:e.id,sourceType:e.sourceType,sourceId:e.sourceId,agreementId:e.agreementId,agreementVersionId:e.agreementVersionId,agreementTitle:titleByVersion.get(e.agreementVersionId)||'协议',vehicleId:e.vehicleId,modelId:e.modelId,modelName:e.modelName,plateNumber:e.plateNumber,partnerRateBps:e.partnerRateBps,amount:e.amount,partnerAmount:e.partnerAmount,platformAmount:e.amount-e.partnerAmount,occurredAt:e.occurredAt.toISOString()}));
 // Historical filters come from immutable company facts, including cars which
 // have since moved to another company. Never narrow facets to the chosen page.
 const agreementFilters=new Map<string,{id:string;title:string}>(),modelFilters=new Map<string,{id:string;name:string}>(),vehicleFilters=new Map<string,{id:string;plateNumber:string;modelId:string|null;agreementId:string}>();
 for(const e of events){
  if(!agreementFilters.has(e.agreementId))agreementFilters.set(e.agreementId,{id:e.agreementId,title:titleByVersion.get(e.agreementVersionId)||'协议'});
  if(e.modelId&&!modelFilters.has(e.modelId))modelFilters.set(e.modelId,{id:e.modelId,name:e.modelName});
  if(!vehicleFilters.has(e.vehicleId))vehicleFilters.set(e.vehicleId,{id:e.vehicleId,plateNumber:e.plateNumber,modelId:e.modelId,agreementId:e.agreementId});
 }
 const filters={agreements:[...agreementFilters.values()],models:[...modelFilters.values()],vehicles:[...vehicleFilters.values()]};
 return{totals:total(rows),groups,items,total:rows.length,page:q.page,pageSize:q.pageSize,incompleteCount,filters};
}
