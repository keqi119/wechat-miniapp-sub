import {termMonthsInput} from '../service-calendar/rules';
import {z} from 'zod';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {readServiceStage} from '../order-service-stages/readiness';
import {stagePeriods} from '../order-service-stages/source';

const identifier=z.string().min(1).max(500).refine(v=>v.trim()===v&&!v.includes('\0'));
const integer=z.number().int().min(1).max(2147483647),date=z.iso.date().refine(v=>!v.startsWith('0000-'));
const schema=z.object({version:z.literal(1),serviceStageId:identifier,stageSourceHash:z.string().regex(/^[a-f0-9]{64}$/),startDate:date,endDate:date,months:termMonthsInput,firstPeriodSequence:integer,lastPeriodSequence:integer,serviceAnchor:z.object({firstStartDay:date,anchorDay:integer.max(31),ruleVersion:z.literal('V31')}).strict().optional()}).strict();
export type SwapStageScope=z.infer<typeof schema>;
const same=(a:unknown,b:unknown)=>canonicalHash(a)===canonicalHash(b);
function stageFact(value:unknown,message='换车服务段与原冻结租期来源不符'):asserts value{ensure(value,409,'SWAP_STAGE_SOURCE',message);}
export function parseSwapStageScope(raw:unknown):SwapStageScope{
 const parsed=schema.safeParse(raw);stageFact(parsed.success);const s=parsed.data;
 stageFact(s.lastPeriodSequence-s.firstPeriodSequence+1===s.months&&stagePeriods(s.startDate,s.months,s.firstPeriodSequence,1,s.serviceAnchor).at(-1)!.endDate===s.endDate);return s;
}
/** Current rights and historical funds share one immutable scope; only current use needs ACTIVE. */
export async function readSwapStageScope(tx:any,order:any,terms:any,options:{historical?:boolean}={}):Promise<SwapStageScope|null>{
 stageFact(terms&&typeof terms==='object'&&!Array.isArray(terms));
 if(!Object.hasOwn(terms,'serviceStageId')){
  if(!options.historical&&['OFFLINE','ELECTRONIC'].includes(order.contractMode)){
   const rows=await tx.orderServiceStage.findMany({where:{orderId:order.id,kind:'RENEWAL',status:'ACTIVE'}});
   stageFact(!rows.some((r:any)=>r.kind==='RENEWAL'&&r.status==='ACTIVE'),'已生效续期缺少本段标识，不能回退原期价格');
  }
  return null;
 }
 stageFact(['OFFLINE','ELECTRONIC'].includes(order.contractMode)&&identifier.safeParse(terms.serviceStageId).success);
 const read=await readServiceStage(tx,order,terms.serviceStageId),s=read.snapshot;
 stageFact(s.kind==='RENEWAL'&&(options.historical?['ACTIVE','ENDED'].includes(read.stage.status):read.stage.status==='ACTIVE'));
 if(order.contractMode==='ELECTRONIC'){
  const source=await(await import('../order-renewals/source')).readPreparedRenewalSource(tx,read.stage.id);
  stageFact(source.agreement.mode==='ELECTRONIC'&&source.change.status==='APPLIED'&&source.stage.termsVersionId===read.stage.termsVersionId&&same(source.snapshot,s),'电子换车须引用真实已签05及已激活服务段');
  if(!options.historical){
   await(await import('../order-renewals/cancellation-state')).assertRenewalNotCancelling(tx,source.change.id);
   const head=await tx.orderTermsVersion.findUnique({where:{id:order.effectiveTermsVersionId}});
   stageFact(head?.orderId===order.id&&same(head.snapshot,terms),'当前换车须使用真实有效条款头');
   await(await import('./electronic-source')).requireElectronicSwapChain(tx,order);
  }
 }
 for(const key of ['serviceStageId','startDate','months','productSnapshot','usagePolicyVersion','usagePolicy','mileagePerMonthKm','excessMileagePriceAmount','energyDescription'])stageFact(same(terms[key],s.termsSnapshot[key]),'换车不得替换当前服务段原产品、用量政策或期限');
 return parseSwapStageScope({version:1,serviceStageId:read.stage.id,stageSourceHash:read.stage.snapshotHash,...s.period,...(s.serviceAnchor?{serviceAnchor:s.serviceAnchor}:{})});
}

/** Historical factual money must retain the quote's authentic stage, not today's head. */
export async function readElectronicSwapStage(tx:any,order:any,change:any,q:any){
 const scope=await readSwapStageScope(tx,order,change.priorTerms,{historical:true});
 stageFact(same(scope,q.snapshot.serviceStageScope??null),'实际换车结算的阶段与已签03不一致');
 return scope;
}
