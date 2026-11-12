import {newOrderContractMode} from '../offline-documents/mode';
import type {ProductSnapshot} from '../products/types';
import {snapshotProduct} from '../products/snapshot';
import {hash} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentVirtualScope,VIRTUAL_NOTICE} from '../virtual-acceptance/scope';
import {shanghaiDay} from '../usage/rules';

const paragraphs=(...parts:string[])=>parts.filter(Boolean).join('\n\n');
const clean=(value:unknown)=>typeof value==='string'?value.trim():'';

/** Only source facts explicitly held in the application; a proposed pickup address is not a contact address. */
export function buildDefaultCommercialTerms(application:any,product:ProductSnapshot){
 const vehicle=application.vehicle||{},profile=application.profile||{};
 const address=clean(profile.contactAddress)||clean(profile.customerAddress)||clean(profile.customerProfileSnapshot?.contactAddress);
 const identification=[clean(vehicle.title)||[clean(vehicle.brand),clean(vehicle.model)].filter(Boolean).join(' '),vehicle.vin?`VIN：${vehicle.vin}`:'',vehicle.plateNumber?`当前车牌：${vehicle.plateNumber}`:''].filter(Boolean).join('；');
 const price=(product.excessMileagePriceAmount/100).toFixed(2);
 const benefitRows:string[]=[];let used=0;
 for(const benefit of product.benefits){const line=`${benefit.name}：${benefit.description}；提供方：${benefit.provider}；适用条件：${benefit.conditions}；${benefit.kind==='COUNT'?`本单${benefit.totalQuantity}${benefit.unit}`:'按约定提供说明型服务'}。`;if(used+line.length>3500)break;benefitRows.push(line);used+=line.length;}
 const moduleFees=product.configurationVersion===2?`本单标准月费由基础费${(product.baseFeeAmount/100).toFixed(2)}元与里程包月费${(product.mileageMonthlyFeeAmount/100).toFixed(2)}元组成，合计${(product.monthlyFeeAmount/100).toFixed(2)}元；逐单有明确原因的价格调整以最终确认方案为准。`:'';
 const swapTerms=product.configurationVersion===2?`本单合同期内赠送换车${product.swapPolicy.includedCount}次，不按月或按年重置；赠送次数用完后，每次换车服务费${(product.swapPolicy.extraFeeAmount/100).toFixed(2)}元。升级车辆另按月费差额和原合同剩余租期计算差价，不足月按本服务月实际天数折算，以新车实际交付日起计，逐期四舍五入到分。具体换车须审批、客户确认并完成线下变更文件和交接后生效。`:'';
 const place=profile.handoverLocation,proposedPlace=clean(place?.address)?`客户建议交接地点：${[clean(place.name),clean(place.address)].filter(Boolean).join('，')}。具体安排须在交接前由相关方以可留存方式确认。`:'';
 const commercialTerms:Record<string,string>={
  vehicleIdentification:paragraphs(identification?`本单车辆：${identification}。`:'本单车辆以本申请关联车辆档案及有效行驶证记载为依据。','以VIN作为车辆唯一识别依据。依法变更车牌时，实际出租方提供更新后的证件，平台更新档案并通知客户；车牌变更不改变本合同车辆。更换实际车辆须另行确认并办理交接，不以修改车辆名称或车牌代替。'),
  permittedUse:paragraphs(`本单产品使用条件：${product.conditions}`,'车辆用于合法的个人或家庭非营运出行，驾驶人须持有真实有效且与车辆相符的驾驶资格。未经实际出租方书面同意，不得转租、抵押、质押或交由未获确认的人员驾驶；不得用于营运运输、竞赛、驾驶教学及违法活动。禁止酒驾、毒驾、疲劳驾驶、故意暴力驾驶，以及擅自拆改车辆、遮挡车牌或破坏定位设备；不得驶入禁止通行或明显不适合安全行驶的道路、区域。'),
  conditionDisclosure:paragraphs('本单实际车况、累计里程、电量、外观内饰、功能异常、证照、钥匙及随车物品，以现场车辆查验记录、照片或视频和双方签字的交接单为事实依据。交车、还车分别记录并相互核对，本合同条款不预先认定现场查验结果。','实际出租方应如实披露已知且影响安全或使用的事故、维修、涉水等情况。交车前已有损伤不计入客户新增损伤；签字确认已记载事实，不表示放弃对未披露问题、隐蔽缺陷或未载明事项提出异议。'),
  customerAddress:address?paragraphs(`客户联系地址：${address}。`,[clean(profile.name)?`客户：${clean(profile.name)}`:'',clean(profile.mobile)?`联系电话：${clean(profile.mobile)}`:''].filter(Boolean).join('；'),'上述信息用于本单履约联系、服务通知及材料寄送。发生变化时，客户应通过平台或其他可留存方式及时通知；司法文书送达按适用法律及依法确认的方式办理。'):'',
  mileageCarryRule:paragraphs(`本单产品预置期限为${product.months}个月，实际起止日以本单确认方案为准。每个订阅月从相关方确认的实际交车日起算，包含本期起始日、不包含下一期起始日；当月无对应日期时取当月最后一天，后续仍按原起租日日号计算。`,`每个订阅月包含${product.mileagePerMonthKm}公里基础里程，当期未使用部分在期末清零，不结转。已按月预付的当期中途退订，仍享有完整${product.mileagePerMonthKm}公里基础额度。先使用当期基础额度，再抵扣适用的已购里程包。`,'另购里程包须有正式开放的商品、单独确认的购买说明及可信到账记录；适用范围、结转和失效按该说明执行。本条不表示本单已含里程包或平台已开放销售。'),
  excessMileageCalculation:paragraphs(`每期使用里程依据起止时点经核验的累计读数及有效交接记录计算。超里程费用＝max（当期实际使用公里数－${product.mileagePerMonthKm}公里－当期适用的已购里程包抵扣公里数，0）×${price}元。金额精确到人民币分。`,'超里程费用按实际超出里程计算，不设置金额封顶，不另收超里程手续费或倍数罚款。同一里程不重复计费；已结算期间不因之后加购追溯重算。读数缺失或存在争议时先补充核实，不自行跨月平均分摊。结算明细供客户核对后形成账单，由客户主动支付，不自动扣款或直接扣除押金。'),
  usageCosts:paragraphs(moduleFees,`本单产品能源约定：${product.energyDescription}`,'客户使用车辆产生的充电、换电、停车、道路通行及超时占位费用，按本单能源约定和实际责任承担；甲方或平台原因产生的费用不转由客户承担。违章由相应责任方依法处理并承担费用。交还电量以交接记录核对；代充、代办及其他有偿服务须提前明确实际费用、服务费并经客户确认，不因后台添加账单产生默认收费。'),
  insuranceDetails:paragraphs('本单保险机构、保单号码、保险期间、险种、保额、免赔及主要除外责任，以本车有效保单和随本合同交付的保险明细为依据。实际出租方负责保持约定保险在用车期间有效，平台协助核对、续保衔接及事故处理。','事故发生时先保障人员和现场安全，依法报警、及时向保险机构报案，通知平台、保留必要证据并配合理赔。赔偿依据实际责任、保险合同及理赔结果核定；保险未赔付不当然等于全部由客户承担。不以概括的全险、全部赔付或固定折旧比例替代实际约定。'),
  maintenanceRule:paragraphs('保养周期按车辆生产厂家的维护要求及实际车况执行。客户负责日常合理检查，发现安全异常及时停止使用并通知平台；平台协助安排保养、检修和维修。保养所含项目及费用承担以本单明确列入的产品权益和相关方签署的费用约定为依据，未列明项目不得作为已同意的额外收费。','正常使用的合理损耗不作为客户损坏赔偿。既有缺陷、自然老化、质量问题与使用不当造成的损坏，根据交接及维修证据分别认定；出租方的维修义务、客户过错责任依本单有效约定及适用法律处理。'),
  serviceCoverage:paragraphs(swapTerms,product.benefits.length?`本单产品权益共${product.benefits.length}项，以本单冻结的权益附件为完整依据。\n${benefitRows.join('\n')}${benefitRows.length<product.benefits.length?'\n其余权益详见本单完整权益附件。':''}`:'本单产品未配置附加权益，平台提供订单、账单、交还车及服务协调。','附加服务的提供方、适用区域、服务时段、次数与费用以本单明确列明的权益附件为准；未列明的内容不作为赠送权益。保险公司或车辆厂家的服务按本车适用的有效服务说明执行。平台联系电话：18616570212；邮箱：like@ndacar.com。紧急处置和保险报案须联系相应机构，平台工单不替代报案。'),
  handoverArrangement:paragraphs(proposedPlace,'交还车具体时间、地点和现场联系人以相关方在交接前确认并留存的安排及现场交接单为依据。双方核对实际车辆、车况、里程、电量、证照及随车物品，线下签署交还车记录并由平台归档。实际交车延迟且影响计费时，应先确认起租日、合同期间和账单调整。车辆已实际接收的，应如实登记接收时间，不因材料未归档继续视为客户用车。','因客户原因超期占用车辆的，按本单月租÷对应订阅月实际天数×超期占用天数计收占用费，不足一天按实际小时比例计算，不另加倍数罚款；因实际出租方或平台原因无法按约收车的，不收因此增加的占用费。其他损失按事实与责任核对，同一损失不重复收取。'),
  earlyTerminationRule:paragraphs('提前终止由平台人工受理，三方确认终止文件；已交车的须办理实际还车及逐项结算。客户因个人原因提前退租，应尽量提前15日通知。已完整履行的订阅月按本单月租结算，不足一个订阅月按本单月租÷该订阅月实际天数×实际使用天数计算。','个人原因提前退租补偿费为1个月本单月租，但不超过尚未履行期间的剩余租金；不追溯改按短租价，不就同一提前退租事项重复收取剩余全部租金或没收押金。因出租方、平台未按约履行导致终止，或客户依法享有解除权的，不适用上述个人原因补偿。','已收款扣除应付租金、适用补偿及其他有依据费用后，无争议应退款在结算明细确认后7个工作日内发起原路退款。适用的已购里程包未使用余额按单独确认的购买规则处理，不以里程包失效为由没收押金。'),
  depositRefundRule:paragraphs('押金金额以本单人工风控后确认的方案为准，不另行默认增加违章押金。押金与租金分别记录，不作为预付违约金或平台收入。拟扣抵时列明项目、金额、事实与计算依据，无争议退款和必要保留款分别列示，不因部分争议扣留全部押金。','车辆实际交还并完成现场查验后7个工作日内出具押金结算明细并发起无争议余额退款。确有未结事故、违章或损伤的，仅保留有依据的合理金额，逐项列明核实事项及处理截止日；事项结清后3个工作日内发起对应余额退款。到账以支付渠道记录为准，平台查询并跟进异常。'),
  otherFees:paragraphs('本单除已确认的租金、押金、超里程费用及明确列明的实际发生项目外，无其他固定收费。月租中已包含的电池租赁、牌照管理或其他项目不重复收取；实际出租方与平台之间的合作分润和服务费属于内部结算，不额外向客户重复收取。','取送车、夜间服务、异地交还、代充等可选服务须提前列明内容、价格及承担方，取得客户确认后办理。未经确认，不因后台新增账单视为客户同意收费。损坏、遗失等损失按本合同相应责任条款核实，不直接采用未列明的倍数赔偿标准。'),
 };
 const missingFields=[...(!clean(vehicle.vin)?['vehicleIdentification']:[]),...(!address?['customerAddress']:[])];
 return{commercialTerms,missingFields};
}

export async function readFinalPlanDefaults(tx:any,application:any){
 const product=await snapshotProduct(tx,application.subscriptionPlanId),sourceHash=hash(product);
 const virtual=await requireCurrentVirtualScope(tx,{vehicleId:application.vehicleId,customerId:application.customerId,applicationId:application.id,action:'QUOTE_DEFAULTS'});
 if(virtual)return{kind:'VIRTUAL_ACCEPTANCE',applicationId:application.id,revision:application.revision,contractMode:'ELECTRONIC',notice:VIRTUAL_NOTICE,reviewLabel:'测试资料确认（驾驶资格、信用核验不适用）',quotePath:`/admin/applications/${application.id}/virtual-quote`,reviewPath:`/admin/applications/${application.id}/virtual-review`,source:{productVersionId:product.productVersionId,hash:sourceHash},values:{monthlyFeeAmount:100,months:12,depositKind:'FIXED',depositAmount:100,referenceDate:shanghaiDay(new Date()),customerAddress:clean(application.profile?.contactAddress)||clean(application.profile?.customerAddress)},missingFields:['customerAddress']};
 let {commercialTerms,missingFields}=buildDefaultCommercialTerms(application,product);
 // The operator chooses the planned day only in structured startDate; these defaults supply place/contact facts.
 const electronic=newOrderContractMode()==='ELECTRONIC';if(electronic){const profile=application.profile||{},place=profile.handoverLocation;commercialTerms={vehicleIdentification:[application.vehicle?.title,application.vehicle?.vin,application.vehicle?.plateNumber].filter(Boolean).join('；'),customerAddress:clean(profile.contactAddress)||clean(profile.customerProfileSnapshot?.contactAddress),handoverArrangement:place?.address?`计划交付地点：${place.address}；现场联系人：${clean(profile.name)||clean(profile.customerProfileSnapshot?.name)}`:''};missingFields=Object.entries(commercialTerms).filter(([,v])=>!v).map(([k])=>k);}
 return{applicationId:application.id,revision:application.revision,contractMode:electronic?'ELECTRONIC':newOrderContractMode(),source:{productId:product.productId,productVersionId:product.productVersionId,version:product.version,name:product.name,hash:sourceHash},values:{monthlyFeeAmount:product.monthlyFeeAmount,months:product.months,mileagePerMonthKm:product.mileagePerMonthKm,excessMileagePriceAmount:product.excessMileagePriceAmount,energyDescription:product.energyDescription,benefits:product.benefits.map(b=>b.name),conditions:product.conditions,commercialTerms,...(electronic&&product.configurationVersion===2?{agreedFeeComponents:{baseFeeAmount:product.baseFeeAmount,mileageMonthlyFeeAmount:product.mileageMonthlyFeeAmount}}:{}),productSourceHash:sourceHash},missingFields};
}

export function assertProductSourceHash(product:ProductSnapshot|undefined,sourceHash:string|undefined){
 if(sourceHash===undefined)return;
 ensure(product&&sourceHash===hash(product),409,'PRODUCT_SOURCE_CHANGED','产品条款已更新，请重新读取产品默认值并核对人工修改后再生成方案');
}
