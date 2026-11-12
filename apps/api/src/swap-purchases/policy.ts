import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {addonTerms,quoteMatches,validateScopePrices,versionSource} from '../addon-products/policy';

export type SwapTermPolicy={policyVersion:'SWAP_TERM_V2';includedCount:number;extraFeeAmount:number;sourceHash:string};
export type SwapPurchasePricing={policyVersion:'SWAP_TERM_V2';sourceHash:string;quantity:1;amount:number;currency:'CNY';serviceStageId?:string;stageSourceHash?:string};
export type SwapPolicySource={serviceStageId:string|null;stageSourceHash:string|null;policy:SwapTermPolicy|null;startAt:Date;endAt:Date};
const integer=(v:unknown,min=0):v is number=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=2147483647;
const same=(actual:any,expected:object)=>actual&&Object.keys(actual).length===Object.keys(expected).length&&Object.entries(expected).every(([k,v])=>actual[k]===v);
export function freezeSwapPolicy(order:any):SwapTermPolicy|null{
 const plan=order?.finalPlanSnapshot,product=plan?.productSnapshot;
 if(!product){ensure((plan?.usagePolicyVersion==null||plan.usagePolicyVersion==='USAGE_V1')&&(plan?.usagePolicy?.policyVersion==null||plan.usagePolicy.policyVersion==='USAGE_V1')&&plan?.configurationVersion!==2,409,'SWAP_POLICY','新版订单缺少原产品换车政策');return null;}
 ensure(!(plan.usagePolicyVersion==='USAGE_V2'||plan.usagePolicy?.policyVersion==='USAGE_V2'||plan.configurationVersion===2)||product.configurationVersion===2,409,'SWAP_POLICY','新版订单与原产品配置版本不一致');
 ensure(product.configurationVersion===undefined||product.configurationVersion===1||product.configurationVersion===2,409,'SWAP_POLICY','订单换车政策版本不支持');
 if(product.configurationVersion!==2){ensure(product.swapPolicy==null,409,'SWAP_POLICY','旧版产品不得混入未标明版本的换车政策');return null;}
 const p=product.swapPolicy;
 ensure(typeof product.productId==='string'&&product.productId&&typeof product.productVersionId==='string'&&product.productVersionId&&integer(product.version,1)&&p&&p.version===2&&p.period==='TERM'&&integer(p.includedCount)&&integer(p.extraFeeAmount,1)&&Object.keys(p).sort().join(',')==='extraFeeAmount,includedCount,period,version',409,'SWAP_POLICY','原订单合同期换车政策不完整');
 return{policyVersion:'SWAP_TERM_V2',includedCount:p.includedCount,extraFeeAmount:p.extraFeeAmount,sourceHash:canonicalHash({productId:product.productId,productVersionId:product.productVersionId,version:product.version,swapPolicy:p})};
}
export function freezeSwapPricing(order:any,source?:SwapPolicySource):SwapPurchasePricing|null{const p=source?source.policy:freezeSwapPolicy(order);return p?{policyVersion:p.policyVersion,sourceHash:p.sourceHash,quantity:1,amount:p.extraFeeAmount,currency:'CNY',...(source?.serviceStageId?{serviceStageId:source.serviceStageId,stageSourceHash:source.stageSourceHash!}:{})}:null;}
export function swapProduct(order:any,source?:SwapPolicySource){const pricing=freezeSwapPricing(order,source);return pricing?{id:'SWAP_CREDIT_TERM_1',quantity:1,amount:pricing.amount,currency:'CNY',policyVersion:pricing.policyVersion,pricingHash:canonicalHash(pricing),...(source?.serviceStageId?{serviceStageId:source.serviceStageId,stageSourceHash:source.stageSourceHash}:{})}:{id:'SWAP_CREDIT_1',quantity:1,amount:80000,currency:'CNY'};}
export function validateSwapCredit(order:any,credit:any,source?:SwapPolicySource){
 const policy=source?source.policy:freezeSwapPolicy(order);
 ensure(credit&&credit.orderId===order.id&&['FREE','PAID'].includes(credit.source),409,'SWAP_CREDIT_SOURCE','换车次数归属不一致');
 ensure((credit.serviceStageId??null)===(source?.serviceStageId??null),409,'SWAP_CREDIT_SOURCE','次数必须使用其自己的真实服务租期');
 ensure(policy?same(credit.policySnapshot,policy):credit.policySnapshot==null,409,'SWAP_CREDIT_SOURCE','换车次数政策依据缺失或不符');
 const free=credit.source==='FREE';
 ensure(free?(credit.sourcePaymentId==null&&(policy?credit.cycleSequence==null&&integer(credit.termSequence,1)&&credit.termSequence<=policy.includedCount:credit.termSequence==null&&integer(credit.cycleSequence,1))):credit.cycleSequence==null&&credit.termSequence==null&&typeof credit.sourcePaymentId==='string'&&credit.sourcePaymentId,409,'SWAP_CREDIT_SOURCE','次数来源与合同期或历史周期不符');
 return policy;
}
export const ADDON_SWAP_SKU='SWAP_CREDIT_ADDON_1';
/** Current catalog changes never reprice a purchase's immutable source and selected target. */
export function freezeAddonSwapPricing(resolved:any,target:{id:string;brand:string},source:SwapPolicySource){
 const {product,version,quote}=resolved,serviceSource={orderId:resolved.orderId,customerId:resolved.customerId,serviceStageId:source.serviceStageId,stageSourceHash:source.stageSourceHash,policy:source.policy,startAt:source.startAt.toISOString(),endAt:source.endAt.toISOString()};
 return {version:3,sku:ADDON_SWAP_SKU,policyVersion:'SWAP_ADDON_V1',productId:product.productId,versionId:version.id,productVersion:version.version,sourceHash:version.sourceHash,source:versionSource(version),serviceSource,serviceSourceHash:canonicalHash(serviceSource),quote:{quoteId:quote.quoteId,quantity:1,amount:quote.amount,currency:'CNY'},targetModelDefinitionId:target.id,targetBrand:target.brand,quantity:1,amount:quote.amount,currency:'CNY',serviceStageId:source.serviceStageId,stageSourceHash:source.stageSourceHash,expiresAt:source.endAt.toISOString()};
}
function readAddonServiceSource(p:any){
 const s=p.pricingSnapshot,f=s.serviceSource,policy=f?.policy,startAt=new Date(f?.startAt),endAt=new Date(f?.endAt),sha=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
 ensure(f&&f.orderId===p.orderId&&f.customerId===p.customerId&&canonicalHash(f)===s.serviceSourceHash&&(f.serviceStageId??null)===(p.serviceStageId??null)&&(f.stageSourceHash??null)===(s.stageSourceHash??null)&&((f.serviceStageId===null&&f.stageSourceHash===null)||(typeof f.serviceStageId==='string'&&f.serviceStageId&&sha(f.stageSourceHash)))&&Number.isFinite(startAt.getTime())&&Number.isFinite(endAt.getTime())&&startAt<endAt&&endAt.toISOString()===s.expiresAt,409,'SWAP_PURCHASE_SOURCE','独立换车服务来源快照缺失或不一致');
 ensure(policy===null||(policy?.policyVersion==='SWAP_TERM_V2'&&integer(policy.includedCount)&&integer(policy.extraFeeAmount,1)&&sha(policy.sourceHash)&&Object.keys(policy).sort().join(',')==='extraFeeAmount,includedCount,policyVersion,sourceHash'),409,'SWAP_PURCHASE_SOURCE','独立换车原服务政策快照不完整');
 return{kind:f.serviceStageId===null?'INITIAL' as const:'RENEWAL' as const,serviceStageId:f.serviceStageId,stageSourceHash:f.stageSourceHash,policy,startAt,endAt,stageStatus:'ENDED' as const};
}
/** Exception money review only. It deliberately returns ENDED and can never authorize new use. */
export function frozenAddonSwapSource(order:any,p:any){const source=readAddonServiceSource(p);validateSwapPurchase(order,p,undefined,undefined,source);return source;}
function validateAddonSwapSnapshot(p:any,source?:SwapPolicySource){
 const s=p?.pricingSnapshot,terms=addonTerms('SWAP_CREDIT');
 ensure(s&&s.version===3&&s.sku===ADDON_SWAP_SKU&&s.policyVersion==='SWAP_ADDON_V1'&&typeof s.productId==='string'&&s.productId&&typeof s.versionId==='string'&&s.versionId&&integer(s.productVersion,1)&&s.source?.kind==='SWAP_CREDIT'&&typeof s.source.name==='string'&&s.source.name.trim()&&canonicalHash(s.source)===s.sourceHash&&canonicalHash(s.source.terms)===canonicalHash(terms),409,'SWAP_PURCHASE_SOURCE','独立换车商品冻结来源不完整');
 const groups=validateScopePrices('SWAP_CREDIT',s.source.scopePrices);
 ensure(typeof s.targetModelDefinitionId==='string'&&s.targetModelDefinitionId&&typeof s.targetBrand==='string'&&s.targetBrand,409,'SWAP_PURCHASE_SOURCE','缺少购买时选定的目标车型');
 const quotes=quoteMatches(groups,{id:s.targetModelDefinitionId,brand:s.targetBrand});
 ensure(quotes.length===1&&canonicalHash(quotes[0])===canonicalHash(s.quote)&&s.quantity===1&&s.currency==='CNY'&&s.amount===p.amount&&s.quote.amount===p.amount&&(s.serviceStageId??null)===(p.serviceStageId??null)&&s.expiresAt===p.expiresAt?.toISOString(),409,'SWAP_PURCHASE_SOURCE','独立换车报价、范围或期限与原购买不一致');
 ensure(p.termsSnapshot?.accepted===true&&p.termsSnapshot.version===terms.version&&p.termsSnapshot.hash===terms.hash&&p.termsSnapshot.content===terms.content,409,'SWAP_PURCHASE_SOURCE','独立换车说明与购买时冻结版本不一致');
 const original=readAddonServiceSource(p);
 if(source)ensure((s.serviceStageId??null)===source.serviceStageId&&(s.stageSourceHash??null)===source.stageSourceHash&&canonicalHash(original.policy)===canonicalHash(source.policy)&&original.startAt.getTime()===source.startAt.getTime()&&original.endAt.getTime()===source.endAt.getTime(),409,'SWAP_PURCHASE_SOURCE','独立换车权益不可迁移服务租期');
 return s;
}
/** Old paid rights keep their original target semantics; independent SKU is target-bound. */
export function swapPurchaseTargetMatches(p:any,model:{id:string;brand:string}){
 if(p?.pricingSnapshot?.version!==3)return true;
 const s=validateAddonSwapSnapshot(p);return s.targetModelDefinitionId===model?.id&&s.targetBrand===model?.brand;
}
export function validateSwapPurchase(order:any,p:any,bill?:any,payment?:any,source?:SwapPolicySource){
 const pricing=freezeSwapPricing(order,source),independent=p?.pricingSnapshot?.version===3;
 ensure(p&&p.orderId===order.id&&p.customerId===order.customerId&&p.quantity===1&&p.currency==='CNY'&&integer(p.amount,1)&&(independent||(pricing?same(p.pricingSnapshot,pricing)&&p.amount===pricing.amount:p.pricingSnapshot==null&&p.amount===80000)),409,'SWAP_PURCHASE_SOURCE','换车购买冻结金额或归属不符');
 if(independent)validateAddonSwapSnapshot(p,source);
 ensure((p.serviceStageId??null)===(source?.serviceStageId??null),409,'SWAP_PURCHASE_SOURCE','购买次数必须使用其自己的真实服务租期');
 if(source)ensure(p.expiresAt instanceof Date&&Number.isFinite(p.expiresAt.getTime())&&p.expiresAt>source.startAt&&p.expiresAt<=source.endAt,409,'SWAP_PURCHASE_SOURCE','原购买有效期与其冻结租期来源冲突，请人工核对，不能改写历史');
 if(bill)ensure(bill.id===p.billId&&bill.type==='SWAP_CREDIT'&&bill.orderId===order.id&&bill.customerId===order.customerId&&bill.amount===p.amount,409,'SWAP_PURCHASE_SOURCE','购买与原账单不一致');
 if(payment)ensure(payment.billId===p.billId&&payment.customerId===p.customerId&&payment.amount===p.amount,409,'SWAP_PURCHASE_SOURCE','购买与原付款不一致');
 return p.amount as number;
}
export function validateSwapPurchaseCredit(order:any,p:any,credit:any,source?:SwapPolicySource){validateSwapCredit(order,credit,source);ensure(credit.source==='PAID'&&credit.id===p.creditId&&credit.sourcePaymentId===p.paymentId&&(p.serviceStageId??null)===(credit.serviceStageId??null),409,'SWAP_CREDIT_SOURCE','购买次数与原付款或服务租期来源不一致');}
export function swapYuan(amount:number){ensure(integer(amount,1),409,'SWAP_POLICY','换车单价须为正整数分');const n=BigInt(amount);return `${n/100n}.${String(n%100n).padStart(2,'0')}`;}
export function renderSwapTemplate(template:string,amount:number){
 ensure(typeof template==='string'&&template.includes('{{extraFeeYuan}}'),409,'SWAP_POLICY','换车购买模板须明确本单单价');
 const values:Record<string,string>={extraFeeYuan:swapYuan(amount),extraFeeAmount:String(amount)},content=template.replace(/{{([^{}]+)}}/g,(_,name:string)=>{ensure(Object.hasOwn(values,name),409,'SWAP_POLICY','换车模板变量不支持');return values[name];});
 ensure(!content.includes('{{')&&!content.includes('}}'),409,'SWAP_POLICY','换车模板变量不完整');return content;
}


