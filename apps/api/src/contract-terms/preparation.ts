import {terminationDocumentSources,terminationRender} from '../orders/termination-document';
import {cancellation04DocumentSources,cancellation04Render} from '../orders/cancellation04-document';
import {renewalRenderValues} from './renewal';
import {canonicalHash} from '../customers/types';
import {electronicDeliveryPlan} from '../electronic-documents/delivery-plan';
import {assertAgreedFeeComponents} from '../electronic-documents/initial-terms';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {accountHash} from '../partners/revenue-types';
import {resolveV31Sources,freezeV31Sources,assertV31SourcesCurrent,assertV31ConfirmedProduct} from './sources';
import {productMinimumExpression,type V31RenderSnapshot} from './render-model';
import type {V31Context} from './types';
import type {ArchiveParty} from '../offline-documents/parties';
import {electronicSwapBusiness} from '../vehicle-changes/electronic-agreement';
const required=(v:any,label:string)=>{ensure(typeof v==='string'&&v.trim(),409,'V31_SOURCE_REQUIRED',`请确认${label}`);return v;};
const money=(v:any)=>{ensure(Number.isSafeInteger(v)&&v>=0,409,'V31_SOURCE_REQUIRED','金额须为已确认整数分');return(v/100).toFixed(2)+'元';};
export async function freezeV31Preparation(tx:any,context:V31Context){
 if(context.kind==='EARLY_TERMINATION')return terminationDocumentSources(tx,context);
 if(context.kind==='PRE_DELIVERY_CANCELLATION')return cancellation04DocumentSources(tx,context);
 ensure(['SUBSCRIPTION','COOPERATION','VEHICLE_SWAP','RENEWAL'].includes(context.kind),409,'V31_CONTEXT_UNSUPPORTED','此文书须先接入独立业务来源');
 const current=await resolveV31Sources(tx,context);ensure(current.missing.length===0,409,'V31_SOURCE_REQUIRED',JSON.stringify(current.missing));
 return{context,...freezeV31Sources(current.snapshot)};
}
export async function assertV31PreparationCurrent(tx:any,frozen:any){
 ensure(frozen?.context&&frozen?.snapshot&&frozen?.hash,409,'V31_SOURCE_REQUIRED','缺少合同冻结资料');
 const current=await freezeV31Preparation(tx,frozen.context);assertV31PreparationSourcesCurrent(frozen,current);
}
/** Only enterprise bookkeeping revisions may differ when every validated semantic field is identical. */
export function assertV31PreparationSourcesCurrent(frozen:any,current:any){
 ensure(current?.snapshot?.schema==='NINDA_V31_SOURCES'&&frozen?.snapshot?.schema==='NINDA_V31_SOURCES'&&canonicalHash(current.snapshot)===current.hash,409,'V31_SOURCES_CHANGED','当前来源摘要不完整或已变化');
 const snapshot=JSON.parse(JSON.stringify(current.snapshot));
 for(const role of ['OWNER','PLATFORM']){
  const before=frozen.snapshot?.parties?.[role],after=snapshot?.parties?.[role];
  if(before?.id&&before.id===after?.id&&before.hash===canonicalHash(before.content)&&after.hash===canonicalHash(after.content)&&before.hash===after.hash)after.revision=before.revision;
 }
 assertV31SourcesCurrent(frozen,{snapshot,hash:canonicalHash(snapshot)});
}
const baas=(b:any)=>{ensure(b&&['INCLUDED','NOT_APPLICABLE','SEPARATE'].includes(b.disposition),409,'V31_SOURCE_REQUIRED','客户 BaaS 费用安排缺失');return b.disposition==='INCLUDED'?'BaaS已含月费，无另付费用':b.disposition==='NOT_APPLICABLE'?'BaaS无需另付费用':`BaaS另付${money(b.amount)} / ${b.period==='MONTH'?'月':'合同期'}，收款对象：${required(b.recipient,'BaaS收款对象')}`;};
function product(p:any){
 ensure(p.configurationVersion===2&&p.swapPolicy,409,'V31_PRODUCT_CONFIGURATION_REQUIRED','请先确认产品价费组成及换车规则');
 ensure(Number.isInteger(p.minimumTermMonths)&&p.minimumTermMonths>=3&&p.months>=p.minimumTermMonths,409,'V31_SOURCE_REQUIRED','产品期限未确认');
 const price=p.configurationVersion===2?`基础费${money(p.baseFeeAmount)}，里程费${money(p.mileageMonthlyFeeAmount)}，`:'';
 if(p.configurationVersion===2)ensure(p.baseFeeAmount+p.mileageMonthlyFeeAmount===p.monthlyFeeAmount,409,'V31_PRICE_COMPONENTS_REQUIRED','报价组成与合计不一致');
 return `${required(p.name,'产品名称')}，版本${p.productVersionId} / ${p.version}，约定${p.months}个月，最短${p.minimumTermMonths}个月，${price}含税总月费${money(p.monthlyFeeAmount)}，月含${p.mileagePerMonthKm}公里，超额${money(p.excessMileagePriceAmount)}/公里；赠送换车${p.swapPolicy.includedCount}次，单次服务费${money(p.swapPolicy.extraFeeAmount)}；${baas(p.customerBaas)}；能源费用：${p.energyDescription}；适用条件：${p.conditions}；权益：${(p.benefits||[]).map((b:any)=>`${b.name}：${b.description}，${b.conditions}`).join('；')||'无其他赠送权益'}`;
}
function vehicle(v:any){const c=v.content,s=c.scope;if(c.virtualFacts)return `指定虚拟流程验收车辆${v.id}：${c.brand} ${c.model}；VIN、车牌、真实登记权属、保险、车况、出租权限及交付事实均不适用；测试登记所有人标签${c.registeredOwnerName}（非权属证明）；测试范围参考期${s.validFrom}至${s.validUntil}，不形成真实车辆租赁或交付义务`;ensure(c.condition&&['fireDamage','floodDamage','structuralDamage'].every(k=>typeof c.condition[k]==='boolean')&&['OWNED','BAAS'].includes(c.batteryOwnership)&&['NONE','DISCLOSED'].includes(s.rightsRestrictions.status),409,'V31_SOURCE_REQUIRED','车辆披露资料未确认');return `品牌车型${required(c.brand,'品牌')} ${required(c.model,'车型')}，VIN ${c.vin}，车牌${required(c.plateNumber,'车牌')}，登记所有人${c.registeredOwnerName}，电池方式${c.batteryOwnership==='OWNED'?'随车自有':'BaaS租赁'}，适用期${s.validFrom}至${s.validUntil}，出租权限证据${c.authorityEvidence.map((e:any)=>e.fileId).join('、')}；权利限制：${s.rightsRestrictions.status==='NONE'?'无':s.rightsRestrictions.description}；车况：火烧${c.condition.fireDamage?'有':'无'}，水泡${c.condition.floodDamage?'有':'无'}，结构损伤${c.condition.structuralDamage?'有':'无'}`;}
/** Called only inside authorized preparation. Private values are PDF inputs, never snapshot JSON. */
export async function resolveV31RenderSnapshot(tx:any,frozen:any,parties:ArchiveParty[],number:string,template:any):Promise<V31RenderSnapshot>{
 const s=frozen.snapshot,context=frozen.context;
 if(context.kind==='EARLY_TERMINATION')return terminationRender(tx,frozen,parties,number);
 if(context.kind==='PRE_DELIVERY_CANCELLATION')return cancellation04Render(tx,frozen,parties,number);
 const enterprise=(role:string)=>{const p=s.parties[role].content,profile=p.contractProfile;return`${role==='PLATFORM'?'上海宁达信息科技有限公司':p.name}，统一社会信用代码${p.creditCode}，住所${p.address}，签署人${p.signer.name}，权限${profile.signerAuthorityRole}${profile.authorityScope?'：'+profile.authorityScope:''}，服务联系人${profile.serviceContactName}，联系渠道${profile.serviceContactChannel}${profile.serviceContactEmail?'，邮箱'+profile.serviceContactEmail:''}`;};
 const values:Record<string,string>={};
 if(context.kind==='RENEWAL'){Object.assign(values,await renewalRenderValues(tx,frozen,parties,number,{enterprise,product,vehicle,money}));
 }else if(context.kind==='VEHICLE_SWAP'){
  const {change,order,q,s:swap}=await electronicSwapBusiness(tx,context.resourceId),f=swap.electronicTerms.snapshot;
  ensure(q.commercialHash===context.businessHash,409,'V31_SOURCES_CHANGED','换车方案已变化');
  const customer=parties.find(p=>p.role==='CUSTOMER');ensure(customer?.identityNumber&&customer.phone,409,'V31_SOURCE_REQUIRED','客户实名及本人联系渠道缺失');
  const original=await tx.archiveVersion.findUnique({where:{id:change.originalArchiveVersionId}});ensure(original?.contractNumber&&original.fileManifestHash,409,'V31_SOURCE_REQUIRED','原合同档案编号或证据缺失');
  values['document.referencesAndParties']=`本补充协议${number}，业务${change.id}，订单${order.id}，原合同${original.contractNumber} / 档案${original.id}，原有效条款${change.priorTermsVersionId??'INITIAL'} / ${change.priorTermsHash}；甲方：${customer.name}，证件号码${customer.identityNumber}，已核验手机号${customer.phone}，联系地址${required(change.priorTerms.commercialTerms?.customerAddress,'联系地址')}；乙方：${enterprise('OWNER')}；丙方：${enterprise('PLATFORM')}`;
  const old=s.vehicles.find((v:any)=>v.id===f.originalVehicleId),target=s.vehicles.find((v:any)=>v.id===f.targetVehicleId);ensure(old&&target,409,'V31_SOURCE_REQUIRED','换车两侧车辆资料缺失');
  values['swap.vehiclesAndPeriod']=`原车：${vehicle(old)}；新车：${vehicle(target)}；同一实际出租方${swap.targetLessorSnapshot.name}；首次实际起租${f.serviceAnchor.firstStartDay}，本服务段${f.startDate}至${f.endDate}（止日不含），原日号${f.serviceAnchor.anchorDay}不重置。当前服务月：${swap.periods.find((p:any)=>p.sequence===swap.affectedSequence)?.startDate}至${swap.periods.find((p:any)=>p.sequence===swap.affectedSequence)?.endDate}（止日不含）。`;
  const prior=change.priorTerms,oldComponents=assertAgreedFeeComponents(prior.currentVehicleProductSnapshot??prior.productSnapshot,prior),p=swap.targetSource.product;
  values['swap.financialTerms']=`${f.currentMonthlyFeeAmount===f.targetMonthlyFeeAmount?'同价换车':'升级换车'}；原含税月费${money(f.currentMonthlyFeeAmount)}（基础${money(oldComponents.baseFeeAmount)}、里程${money(oldComponents.mileageMonthlyFeeAmount)}）；新车发布条件：${product(p)}。本次不购买新的完整产品期限，仅适用原剩余期限。原押金${money(f.depositAmount)}完全沿用。升级差价＝新旧含税月费差×本服务月新车实际自然日数÷本服务月实际自然日数，逐期四舍五入至分；实际日期变化按该公式核算，不改写本协议。原车收回至客户接受的实际可用新车或替代车交付间隔单列减租。当前及后续服务月沿用原月含${prior.mileagePerMonthKm}公里、超额${money(prior.excessMileagePriceAmount)}/公里；当期两车用量合并。原赠送总额不重置、后续仍按原服务月释放，目标产品的赠送及里程不重新发放。原BaaS安排：${baas((prior.currentVehicleProductSnapshot??prior.productSnapshot).customerBaas)}；新车BaaS安排：${baas(p.customerBaas)}。本次单次服务费${money(f.serviceFeeAmount)}单列，${swap.serviceFeeSource?.kind==='PAID_CREDIT'?'使用本单已付次数抵用，不重复收取':'使用原阶段赠送次数'}，不计入可分润升级租金差价。计划测算：${swap.periods.map((r:any)=>`第${r.sequence}期原净收${money(r.netPaidAmount)}，抵用${money(r.carryAmount)}，升级差价${money(r.differenceAmount)}，应补${money(r.chargeAmount)}，应退${money(r.refundAmount)}，到期${r.dueDate}`).join('；')}。实际交接后按真实付款来源核对补退，未来期不提前全部收取。`;
  const policies=target.content.policies;
  values['swap.deliveryAndInsurance']=`计划旧车归还${swap.plannedReturnAt}，新车交付${swap.plannedDeliveryAt}；${swap.handoverArrangement}；${policies.length?policies.map((p:any)=>`保险公司${typeof p.insurer==='string'?p.insurer:JSON.stringify(p.insurer)}，保单${p.policyNumber}，期间${p.startAt}至${p.endAt}，险种${JSON.stringify(p.coverageItems)}`).join('；'):`尚未出单；真实投保安排：${required(target.content.scope.insuranceArrangement?.description,'投保安排')}`}。实际交付前核验有效保单。`;
 }else if(context.kind==='COOPERATION'){
  const a=s.virtualAcceptance?null:await tx.partnerAccountVersion.findUnique({where:{id:s.collectionAccount.id}});
  ensure(s.virtualAcceptance||a?.status==='APPROVED'&&a.contentHash===s.collectionAccount.hash&&accountHash(a)===s.collectionAccount.hash,409,'V31_SOURCES_CHANGED','对公账户来源已变化');
  values['partiesAndAccount.details']=s.virtualAcceptance?`甲方：${enterprise('PLATFORM')}；乙方：${enterprise('OWNER')}；对公账户不适用（测试不产生合作分润或对公结算义务）`:`甲方：${enterprise('PLATFORM')}；乙方：${enterprise('OWNER')}；乙方对公账户：${a.accountName}，${a.bankName}，${a.accountNumber}`;
  values['cooperation.vehicles']=`合作期间${s.cooperation.validFrom}至${s.cooperation.validUntil}。\n${s.vehicles.map(vehicle).join('\n')}`;
  values['cooperation.revenue']=s.virtualAcceptance?'不适用（测试不产生合作分润或对公结算义务），正文比例字段0仅为测试参数':`适用车辆：${s.vehicles.map((v:any)=>v.content.vin).join('、')}；乙方租金分润比例${s.cooperation.partnerRateBps/100}%，适用起日${s.cooperation.validFrom}`;
  values['cooperation.partnerRateBps']=String(s.cooperation.partnerRateBps/100);
  values['cooperation.products']=s.products.map((p:any)=>{
   const deposit=s.depositAuthorizations?.find((r:any)=>r.productVersionId===p.id);ensure(deposit,409,'V31_SOURCE_REQUIRED','获准产品押金规则未确认');
   const rule=deposit.rule.kind==='FIXED'?`固定押金${money(deposit.rule.amount)}`:`押金规则${deposit.policy.version}：芝麻信用750及以上为0元，700至749为约定月费1倍，650至699为约定月费2倍；低于650或无法核验不得形成正式方案`;
   return product(p.content)+'；'+rule;
  }).join('\n')+'\n完整获准三方模板固定正文见本PDF可阅读附件；同时保存精确源文件：'+s.templates.map((t:any)=>`V31-${t.id}-v${t.version}.json，版本${t.version}，内容摘要${t.hash}`).join('；');
  values['cooperation.minimumTerms']=productMinimumExpression(s.products.map((p:any)=>({id:p.id,minimumTermMonths:p.content.minimumTermMonths})));
  if(s.cooperation.terms.exceptions?.length)values['cooperation.exceptions']=s.cooperation.terms.exceptions.map((e:any)=>e.description).join('；');
 }else{
  const order=await tx.order.findUnique({where:{id:context.resourceId}}),b=order?.finalPlanSnapshot;
  ensure(b?.commercialHash===context.businessHash,409,'V31_SOURCES_CHANGED','订单方案已变化');
  const customer=parties.find(p=>p.role==='CUSTOMER');ensure(customer?.identityNumber&&customer.phone,409,'V31_SOURCE_REQUIRED','客户实名及本人联系资料缺失');
  values['document.references']=`本合同编号${number}，原订单编号${order.id}，模板${template.id} / 第${template.version}版，正文摘要${hash(template.content)}`;
  values['parties.details']=`甲方：${customer.name}，证件号码${customer.identityNumber}，已核验手机号${customer.phone}，账户${customer.partyId}，联系地址${required(b.commercialTerms?.customerAddress,'联系地址')}；乙方：${enterprise('OWNER')}；丙方：${enterprise('PLATFORM')}`;
  const p=b.productSnapshot;ensure(p&&s.products.some((x:any)=>x.id===p.productVersionId),409,'V31_SOURCE_REQUIRED','客户确认产品不在合作范围');
  assertV31ConfirmedProduct(b,s.products.find((x:any)=>x.id===p.productVersionId)?.content);const agreed=assertAgreedFeeComponents(p,b);
  values['subscription.conditions']=product({...p,...agreed,monthlyFeeAmount:b.monthlyFeeAmount})+`；押金${money(b.depositAmount)}`;
  values['product.minimumTermMonths']=String(p.minimumTermMonths);
  const v=s.vehicles.find((v:any)=>v.id===order.vehicleId);ensure(v,409,'V31_SOURCE_REQUIRED','车辆不在固定范围');
  values['vehicle.disclosures']=vehicle(v);
  // Structured frozen planned day is authoritative; actual delivery never rewrites this field.
  values['delivery.plan']=s.virtualAcceptance?`不适用：本次不进行真实交付；测试报价参考日${String(b.startDate).slice(0,10)}，不是交付承诺`:electronicDeliveryPlan(b.startDate,b.commercialTerms?.handoverArrangement);
  values['insurance.facts']=s.virtualAcceptance?'不适用：没有真实车辆，不提供或伪造保险事实':v.content.policies.length?v.content.policies.map((p:any)=>`保险公司${typeof p.insurer==='string'?p.insurer:JSON.stringify(p.insurer)}，保单号${p.policyNumber}，期间${p.startAt}至${p.endAt}，险种${JSON.stringify(p.coverageItems)}`).join('；'):`尚未出单；已确认投保安排：${required(v.content.scope.insuranceArrangement?.description,'投保安排')}`;
 }
 return{values,...(context.kind==='COOPERATION'?{fixedTemplates:s.templates}:{})};
}
