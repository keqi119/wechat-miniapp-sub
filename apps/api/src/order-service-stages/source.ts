import {validTermMonths,servicePeriods,calendarDay} from '../service-calendar/rules';
import type {ServiceAnchor} from '../service-calendar/types';
import {z} from 'zod';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {usagePolicyAppendix} from '../usage/policy';
import {freezeSwapPolicy} from '../swap-purchases/policy';
import {benefitInput,SELF_PAID_ENERGY} from '../products/types';
import {revenueTermsInput} from '../partners/revenue-types';
import type {StageSnapshotV1,StageRead} from './types';

const id=z.string().min(1).max(500).refine(v=>v.trim()===v&&!v.includes('\0'));
const digest=z.string().regex(/^[a-f0-9]{64}$/),integer=z.number().int().min(0).max(2147483647),positive=integer.min(1);
const date=z.string().regex(/^(?!0000)\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;});
const document=z.object({id,type:z.enum(['OFFLINE_ORDER_AMENDMENT','ELECTRONIC_V31_RENEWAL']),version:positive,templateHash:digest,bodyHash:digest,content:z.string().min(1)}).strict();
const schema=z.object({
 version:z.literal(1),kind:z.enum(['INITIAL','RENEWAL']),serviceAnchor:z.object({firstStartDay:date,anchorDay:positive.max(31),ruleVersion:z.literal('V31')}).strict().optional(),
 identity:z.object({serviceStageId:id,orderId:id,customerId:id,sequence:positive,previousStageId:id.nullable(),vehicleId:id,assignmentId:id,ownerId:id.nullable()}).strict(),
 period:z.object({startDate:date,endDate:date,months:positive.max(120),firstPeriodSequence:positive,lastPeriodSequence:positive}).strict(),
 termsSnapshot:z.record(z.string(),z.unknown()),
 usagePricing:z.object({policyVersion:z.enum(['USAGE_V1','USAGE_V2']),baseAllowanceKm:integer,excessPriceAmount:integer,sourceHash:digest}).strict(),
 swapPolicy:z.object({policyVersion:z.literal('SWAP_TERM_V2'),includedCount:integer,extraFeeAmount:positive,sourceHash:digest}).strict().nullable(),
 billingSchedule:z.array(z.object({sequence:positive,stageSequence:positive,startDate:date,endDate:date,dueDate:date,amount:positive}).strict()).min(1).max(120),
 source:z.object({originalTermsHash:digest,product:z.object({listingId:id,listingRevision:integer,productVersionId:id,subscriptionPlanId:id,sourceHash:digest}).strict().nullable(),agreement:z.object({originalContractId:id.nullable(),originalArchiveVersionId:id.nullable(),originalArchiveHash:digest.nullable(),priorTermsVersionId:id.nullable(),priorTermsHash:digest,changeId:id.nullable(),quoteId:id.nullable(),quoteRevision:positive.nullable(),commercialHash:digest,approvedArchiveVersionId:id.nullable(),approvedArchiveHash:digest.nullable(),document:document.nullable()}).strict()}).strict(),
}).strict();
export function stageFact(value:unknown,message='服务租期冻结来源缺失或不一致'):asserts value{ensure(value,409,'SERVICE_STAGE_SOURCE',message);}
export const stageDay=(value:any)=>{const raw=value instanceof Date&&Number.isFinite(value.getTime())?value.toISOString().slice(0,10):value;stageFact(date.safeParse(raw).success,'服务租期日期无效');return raw as string;};
const same=(a:unknown,b:unknown)=>canonicalHash(a)===canonicalHash(b);
function validJson(value:unknown,depth=0):boolean{if(depth>35)return false;if(value===null)return true;if(typeof value==='string')return!value.includes('\0');if(typeof value==='boolean')return true;if(typeof value==='number')return Number.isFinite(value);if(Array.isArray(value))return value.every(v=>validJson(v,depth+1));return !!value&&Object.getPrototypeOf(value)===Object.prototype&&Object.entries(value).every(([k,v])=>!k.includes('\0')&&validJson(v,depth+1));}
export function stagePeriods(startDate:string,months:number,firstSequence:number,amount:number,anchor?:ServiceAnchor){
 if(anchor){const origin=calendarDay(anchor.firstStartDay),start=calendarDay(startDate),offset=(start.getUTCFullYear()-origin.getUTCFullYear())*12+start.getUTCMonth()-origin.getUTCMonth()+1;const rows=servicePeriods(anchor,offset,months);stageFact(rows[0].startDay===startDate&&positive.safeParse(firstSequence).success&&firstSequence+months-1<=2147483647&&positive.safeParse(amount).success);return rows.map((p,n)=>({sequence:firstSequence+n,stageSequence:n+1,startDate:p.startDay,endDate:p.endDayExclusive,dueDate:p.startDay,amount}));}
 const origin=new Date(stageDay(startDate)+'T00:00:00Z');stageFact(positive.max(120).safeParse(months).success&&positive.safeParse(firstSequence).success&&firstSequence+months-1<=2147483647&&positive.safeParse(amount).success);
 const calendar=(year:number,month:number,day:number)=>{const result=new Date(0);result.setUTCHours(0,0,0,0);result.setUTCFullYear(year,month,day);return result;};
 const boundary=(n:number)=>{const index=origin.getUTCFullYear()*12+origin.getUTCMonth()+n,year=Math.floor(index/12),month=index%12;stageFact(year>=1&&year<=9999,'服务租期超出支持的日期范围');const last=calendar(year,month+1,0);return calendar(year,month,Math.min(origin.getUTCDate(),last.getUTCDate())).toISOString().slice(0,10);};
 return Array.from({length:months},(_,n)=>({sequence:firstSequence+n,stageSequence:n+1,startDate:boundary(n),endDate:boundary(n+1),dueDate:boundary(n),amount}));
}
function checkProduct(product:any){
 stageFact(product&&['productId','productVersionId'].every(k=>id.safeParse(product[k]).success)&&positive.safeParse(product.version).success&&typeof product.name==='string'&&product.name.trim()&&positive.max(120).safeParse(product.months).success&&positive.safeParse(product.monthlyFeeAmount).success&&integer.safeParse(product.mileagePerMonthKm).success&&integer.safeParse(product.excessMileagePriceAmount).success&&typeof product.energyDescription==='string'&&typeof product.conditions==='string');
 for(const key of ['vehicleIds','modelDefinitionIds'])stageFact(Array.isArray(product[key])&&product[key].every((v:any)=>id.safeParse(v).success)&&new Set(product[key]).size===product[key].length);
 stageFact(Array.isArray(product.benefits));const seen=new Set();for(const b of product.benefits){stageFact(b&&id.safeParse(b.benefitVersionId).success&&id.safeParse(b.definitionId).success&&positive.safeParse(b.version).success&&!seen.has(b.benefitVersionId));seen.add(b.benefitVersionId);const{benefitVersionId,definitionId,version,...fields}=b;stageFact(benefitInput.safeParse(fields).success);}
 if(product.configurationVersion===2)stageFact(integer.safeParse(product.baseFeeAmount).success&&integer.safeParse(product.mileageMonthlyFeeAmount).success&&product.baseFeeAmount+product.mileageMonthlyFeeAmount===product.monthlyFeeAmount&&product.energyDescription===SELF_PAID_ENERGY);
 else stageFact(product.configurationVersion===undefined||product.configurationVersion===1);
}
function checkRenewalLessor(lessor:any,revenue:any,startDate:string,endDate:string,mode:string){
 const inclusiveEnd=new Date(new Date(endDate+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10);
 stageFact(lessor.executionMode===mode&&['OFFLINE','ELECTRONIC'].includes(mode)&&['ENTERPRISE','INDIVIDUAL'].includes(lessor.subjectType)&&lessor.platformLegalEntityName==='上海宁达信息科技有限公司');
 stageFact(integer.safeParse(lessor.profileRevision).success&&integer.safeParse(lessor.bindingRevision).success&&id.safeParse(lessor.templateId).success&&positive.safeParse(lessor.templateVersion).success&&digest.safeParse(lessor.templateHash).success&&lessor.leaseRange?.startDate===startDate&&lessor.leaseRange?.endDate===inclusiveEnd);
 for(const key of ['creditCode','address','phone'])stageFact(Object.hasOwn(lessor,key)&&(lessor[key]===null||typeof lessor[key]==='string'));
 const notice=lessor.sharingNotice;stageFact(notice&&id.safeParse(notice.id).success&&positive.safeParse(notice.version).success&&typeof notice.title==='string'&&notice.title.trim()&&typeof notice.content==='string'&&notice.content.trim()&&notice.contentHash===hash(notice.content)&&digest.safeParse(notice.templateHash).success);
 if(lessor.mode==='SIMPLE_AGREEMENT'){
  stageFact(lessor.version===4&&revenue.mode==='SIMPLE_AGREEMENT'&&id.safeParse(lessor.agreementId).success&&id.safeParse(lessor.agreementVersionId).success&&lessor.agreementId===revenue.agreementId&&lessor.agreementVersionId===revenue.agreementVersionId&&revenue.versionId===revenue.agreementVersionId&&lessor.agreementHash===revenue.contentHash&&integer.max(10000).safeParse(revenue.partnerRateBps).success&&lessor.partnerRateBps===revenue.partnerRateBps);
  stageFact(typeof revenue.title==='string'&&revenue.title.trim()&&(revenue.modelId===null||id.safeParse(revenue.modelId).success)&&typeof revenue.modelName==='string'&&typeof revenue.plateNumber==='string');
  stageFact((revenue.validFrom===null||date.safeParse(revenue.validFrom).success&&revenue.validFrom<=startDate)&&(revenue.validUntil===null||date.safeParse(revenue.validUntil).success&&revenue.validUntil>=inclusiveEnd));
 }else{
  stageFact(lessor.version===3&&id.safeParse(lessor.bindingId).success&&digest.safeParse(lessor.evidenceHash).success&&id.safeParse(lessor.cooperationSubmissionId).success&&integer.safeParse(lessor.cooperationSubmissionRevision).success&&digest.safeParse(lessor.cooperationSubmissionHash).success&&id.safeParse(lessor.cooperationArchiveId).success&&id.safeParse(lessor.cooperationVersionId).success);
  const r=revenueTermsInput.safeParse(revenue.terms);stageFact(r.success&&id.safeParse(revenue.ruleId).success&&positive.safeParse(revenue.version).success&&revenue.cooperationVersionId===lessor.cooperationVersionId&&r.data.cooperationVersionId===lessor.cooperationVersionId&&r.data.vehicleIds.includes(lessor.vehicleId)&&r.data.validFrom<=startDate&&r.data.validUntil>=inclusiveEnd);
 }
}
export function parseStageSnapshot(raw:unknown,order:any):StageSnapshotV1{
 stageFact(validJson(raw));const parsed=schema.safeParse(raw);stageFact(parsed.success);const s=parsed.data as StageSnapshotV1,t=s.termsSnapshot,i=s.identity,p=s.period,a=s.source.agreement;
 stageFact(order&&i.orderId===order.id&&i.customerId===order.customerId&&s.source.originalTermsHash===canonicalHash(order.finalPlanSnapshot));
 stageFact(p.endDate>p.startDate&&p.lastPeriodSequence-p.firstPeriodSequence+1===p.months&&s.billingSchedule.length===p.months);
 stageFact(same(s.serviceAnchor??null,order.serviceAnchor??null),'服务阶段必须引用订单原始日历');
 const dates=stagePeriods(p.startDate,p.months,p.firstPeriodSequence,t.monthlyFeeAmount,s.serviceAnchor);stageFact(dates.at(-1)!.endDate===p.endDate);
 s.billingSchedule.forEach((r,n)=>stageFact(r.sequence===dates[n].sequence&&r.stageSequence===n+1&&r.startDate===dates[n].startDate&&r.endDate===dates[n].endDate&&r.amount===t.monthlyFeeAmount));
 usagePolicyAppendix(t.usagePolicy);const pricing={policyVersion:t.usagePolicy.policyVersion,baseAllowanceKm:t.usagePolicy.baseAllowanceKm,excessPriceAmount:t.usagePolicy.excessPriceAmount,sourceHash:canonicalHash(t.usagePolicy)};
 stageFact(t.usagePolicyVersion===pricing.policyVersion&&t.mileagePerMonthKm===pricing.baseAllowanceKm&&t.excessMileagePriceAmount===pricing.excessPriceAmount&&same(s.usagePricing,pricing));
 stageFact(same(s.swapPolicy,freezeSwapPolicy({finalPlanSnapshot:t}))&&integer.safeParse(t.depositAmount).success&&t.depositAmount===order.finalPlanSnapshot.depositAmount);
 const product=t.productSnapshot;if(product)checkProduct(product);
 if(s.source.product){const source=s.source.product;stageFact(product&&source.productVersionId===product.productVersionId&&source.listingId===product.listingId&&source.listingRevision===product.listingRevision&&source.sourceHash===product.sourceHash);const{listingId,listingRevision,sourceHash,...configuration}=product;stageFact(sourceHash===canonicalHash({listingId,listingRevision,vehicleId:i.vehicleId,subscriptionPlanId:source.subscriptionPlanId,product:configuration}));}
 else stageFact(!product?.listingId&&!product?.listingRevision&&!product?.sourceHash);
 const lessor=t.lessorSnapshot,revenue=t.revenueRuleSnapshot;
 if(lessor)stageFact(lessor.ownerId===i.ownerId&&lessor.vehicleId===i.vehicleId&&typeof lessor.name==='string'&&lessor.name.trim());
 if(revenue)stageFact(revenue.ownerId===i.ownerId&&revenue.vehicleId===i.vehicleId&&digest.safeParse(revenue.contentHash).success&&id.safeParse(revenue.versionId).success);
 stageFact((t.vehicleId==null||t.vehicleId===i.vehicleId)&&a.commercialHash===t.commercialHash);
 if(s.kind==='INITIAL'){
  stageFact(i.sequence===1&&!i.previousStageId&&!a.changeId&&!a.quoteId&&!a.quoteRevision&&!a.approvedArchiveVersionId&&!a.approvedArchiveHash&&!a.document&&same(t,order.finalPlanSnapshot)&&p.months===t.months&&p.firstPeriodSequence===1&&p.lastPeriodSequence===p.months);
  if(t.monthlyAmounts!=null)stageFact(Array.isArray(t.monthlyAmounts)&&t.monthlyAmounts.length===p.months&&t.monthlyAmounts.every((amount:any,n:number)=>amount===s.billingSchedule[n].amount),'原期非等额约定不能重建为平月费');
  if(t.billingSchedule!=null)stageFact(Array.isArray(t.billingSchedule)&&t.billingSchedule.length===p.months&&t.billingSchedule.every((row:any,n:number)=>row&&row.sequence===s.billingSchedule[n].sequence&&row.amount===s.billingSchedule[n].amount&&stageDay(row.dueDate)===s.billingSchedule[n].dueDate),'原期逐期金额或到期日与冻结来源不一致');
  if(t.firstDueDate!=null)stageFact(stageDay(typeof t.firstDueDate==='string'?t.firstDueDate.slice(0,10):t.firstDueDate)===s.billingSchedule[0].dueDate,'原期首期付款日与冻结来源不一致');
 }else{
  stageFact(i.sequence>1&&i.previousStageId&&i.previousStageId!==i.serviceStageId&&i.ownerId&&validTermMonths(p.months,product?.minimumTermMonths)&&product&&s.source.product&&lessor&&revenue&&t.serviceStageId===i.serviceStageId);
  stageFact(product.configurationVersion===2&&s.swapPolicy&&t.usagePolicyVersion==='USAGE_V2'&&p.months===product.months&&p.months===t.months&&t.monthlyFeeAmount===product.monthlyFeeAmount&&t.mileagePerMonthKm===product.mileagePerMonthKm&&t.excessMileagePriceAmount===product.excessMileagePriceAmount&&t.energyDescription===product.energyDescription&&t.conditions===product.conditions&&t.startDate===p.startDate);
  stageFact(['originalContractId','originalArchiveVersionId','originalArchiveHash','priorTermsHash','changeId','quoteId','quoteRevision','approvedArchiveVersionId','approvedArchiveHash'].every(k=>(a as any)[k]!=null)&&a.document&&a.document.content.trim()&&a.document.bodyHash===hash(a.document.content));
  stageFact(a.document.type===(order.contractMode==='ELECTRONIC'?'ELECTRONIC_V31_RENEWAL':'OFFLINE_ORDER_AMENDMENT'));
  checkRenewalLessor(lessor,revenue,p.startDate,p.endDate,order.contractMode);
 }
 return structuredClone(s);
}
export function parseStageRow(stage:any,order:any):StageRead{
 stageFact(stage&&validJson(stage.snapshot)&&stage.snapshotHash===canonicalHash(stage.snapshot)&&['PREPARED','SCHEDULED','ACTIVE','ENDED','VOIDED'].includes(stage.status)&&integer.safeParse(stage.revision).success);
 const snapshot=parseStageSnapshot(stage.snapshot,order),i=snapshot.identity,p=snapshot.period,a=snapshot.source.agreement,product=snapshot.source.product;
 stageFact(stage.id===i.serviceStageId&&stage.kind===snapshot.kind);
 stageFact(same(stage.serviceAnchor??null,snapshot.serviceAnchor??null));
 for(const k of ['orderId','customerId','sequence','previousStageId','vehicleId','assignmentId','ownerId'] as const)stageFact(stage[k]===i[k]);
 for(const k of ['months','firstPeriodSequence','lastPeriodSequence'] as const)stageFact(stage[k]===p[k]);
 stageFact(stageDay(stage.startDate)===p.startDate&&stageDay(stage.endDate)===p.endDate);
 for(const k of ['changeId','quoteId','priorTermsVersionId','approvedArchiveVersionId'] as const)stageFact((stage[k]??null)===a[k]);
 for(const k of ['listingId','productVersionId','subscriptionPlanId'] as const)stageFact((stage[k]??null)===(product?.[k]??null));
 const instant=(v:any)=>v!=null&&(v instanceof Date||typeof v==='string')&&Number.isFinite(new Date(v).getTime());
 if(snapshot.kind==='INITIAL')stageFact(['ACTIVE','ENDED'].includes(stage.status)&&stage.termsVersionId==null&&instant(stage.activatedAt));
 else{
  stageFact(id.safeParse(stage.createdBy).success);
  stageFact(['ACTIVE','ENDED'].includes(stage.status)||stage.status==='VOIDED'&&stage.termsVersionId!=null?id.safeParse(stage.termsVersionId).success&&instant(stage.activatedAt)&&id.safeParse(stage.activatedBy).success:stage.termsVersionId==null&&stage.activatedAt==null&&stage.activatedBy==null);
  if(stage.status==='PREPARED')stageFact(stage.scheduledAt==null&&stage.scheduledBy==null);
  else if(stage.status!=='VOIDED')stageFact(instant(stage.scheduledAt)&&id.safeParse(stage.scheduledBy).success);
 }
 stageFact(stage.status==='ENDED'?instant(stage.endedAt):stage.endedAt==null);
 stageFact(stage.status==='VOIDED'?instant(stage.voidedAt)&&id.safeParse(stage.voidedBy).success&&typeof stage.voidReason==='string'&&stage.voidReason.trim():stage.voidedAt==null&&stage.voidedBy==null&&stage.voidReason==null);
 return{stage,snapshot};
}
