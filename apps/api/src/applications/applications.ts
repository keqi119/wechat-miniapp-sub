import {electronicDeliveryPlan} from '../electronic-documents/delivery-plan';
import {canonicalHash} from '../customers/types';
import {assertAgreedFeeComponents,agreedFeeComponentsInput,electronicCommercialTermsInput,buildElectronicLessorSnapshot,electronicPlatformParty} from '../electronic-documents/initial-terms';
import {validTermMonths,termMonthsInput} from '../service-calendar/rules';
import {applicationProfile,captureCustomerProfileSnapshot,confirmCustomerProfileSnapshot} from '../customers/profile';
import {newOrderContractMode} from '../offline-documents/mode';
import {EntitlementService} from '../entitlements/service';
import {requireVehicleUnrestricted} from '../vehicles/operational-restrictions';
import {archiveCommand} from '../offline-documents/command';
import {requireCurrentStaff} from '../auth/staff-session';
import {snapshotProduct,assertProductQuote} from '../products/snapshot';
import {snapshotRevenueRule} from '../partners/revenue-rules';
import {leaseRange,quoteReady} from '../orders/business-gates';
import {createLeaseRenewalReminders} from '../insurance/reminders';
import {applicationCooperationEligible,applicationUnavailableMessage} from '../vehicles/application-eligibility';
import {buildLessorSnapshot,buildOfflineLessorSnapshot,confirmLessor,confirmOfflineLessor,lessorIdentityHash} from '../owner-signing/lessor';
import { locationInput, resolveLocation } from './handover-location';
import { snapshotUsagePolicy, usagePolicyAppendix } from '../usage/policy';
import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../common/db';
import { ensure } from '../common/errors';
import { audit, fen, hash, key, money, notify, text } from '../common/data';
import { acceptConsents, requireCurrentConsents } from '../auth/consents';
import { commercialTermsInput } from './commercial-terms';
import {assertProductSourceHash,readFinalPlanDefaults} from './final-plan-defaults';
import { billSchedule, dateOnly } from '../billing/rules';
import { CREDIT_RULE, requireCredit } from './credit-review';
import { finalPlanPricing, assertFinalPricing, acceptancePricingDescription } from './acceptance-pricing';
import {requireCurrentVirtualScope,isVirtualVehicle,VIRTUAL_NOTICE} from '../virtual-acceptance/scope';
import {captureVirtualProfile,virtualApplicationProfile,confirmVirtualProfile} from '../virtual-acceptance/profile';
import {assertVirtualPrice} from '../virtual-acceptance/quotes';
export const applicationInclude = { vehicle: { include: { plans: true } }, subscriptionPlan: true, finalPlans: { orderBy: { revision: 'desc' as const }, take: 1 }, order: true };
const statusNames: Record<string, string> = { SUBMITTED: '已提交', IN_REVIEW: '审核中', NEEDS_INFO: '待补充资料', REJECTED: '已拒绝', CANCELLED: '已取消', AWAITING_CONFIRMATION: '待确认最终方案', FINAL_PLAN_CONFIRMED: '方案已确认' };
export function safeOrderIdentity(order:any){return{id:order.id,applicationId:order.applicationId,status:order.status,contractMode:order.contractMode,createdAt:order.createdAt};}
function safeLessor(snapshot:any){if(!snapshot)return null;return{ownerId:snapshot.ownerId,executionMode:snapshot.executionMode,platformLegalEntityName:snapshot.platformLegalEntityName,subjectType:snapshot.subjectType||'ENTERPRISE',name:snapshot.name,creditCode:snapshot.creditCode,address:snapshot.address,phone:snapshot.phone,sharingNotice:snapshot.sharingNotice?{id:snapshot.sharingNotice.id,version:snapshot.sharingNotice.version,title:snapshot.sharingNotice.title,content:snapshot.sharingNotice.content,contentHash:snapshot.sharingNotice.contentHash}:null};}
export function applicationView(a:any,staff=false){
 const candidate=a.finalPlans?.[0],visible=candidate&&(staff||!['OFFLINE','ELECTRONIC'].includes(candidate.contractMode)||candidate.reviewStatus==='APPROVED'),p=visible?candidate:null;
 const selected=a.subscriptionPlan,plan=selected?{id:selected.id,name:selected.name,months:selected.months,monthlyFeeAmount:selected.monthlyFeeAmount,mileagePerMonthKm:selected.mileagePerMonthKm,excessMileagePriceAmount:selected.excessMileagePriceAmount,energyDescription:selected.energyDescription,benefits:selected.benefits,conditions:selected.conditions}:null;
 const finalPlan=p?{id:p.id,revision:p.revision,contractMode:p.contractMode,commercialHash:p.commercialHash,monthlyFeeAmount:p.monthlyFeeAmount,depositAmount:p.depositAmount,months:p.months,mileagePerMonthKm:p.mileagePerMonthKm,excessMileagePriceAmount:p.excessMileagePriceAmount,energyDescription:p.energyDescription,benefits:p.benefits,conditions:p.conditions,startDate:p.startDate,firstDueDate:p.firstDueDate,commercialTerms:p.commercialTerms,agreedFeeComponents:p.agreedFeeComponents,usagePolicyVersion:p.usagePolicyVersion,usagePolicy:p.usagePolicy,creditRevision:p.creditRevision,creditRuleVersion:p.creditRuleVersion,lessorSnapshot:safeLessor(p.lessorSnapshot),lessorHash:p.lessorSnapshot?lessorIdentityHash(p.lessorSnapshot):null,product:p.productSnapshot?{name:p.productSnapshot.name,version:p.productSnapshot.version,months:p.productSnapshot.months,minimumTermMonths:p.productSnapshot.minimumTermMonths??null,benefits:p.productSnapshot.benefits,...(p.productSnapshot.configurationVersion===2?{configurationVersion:2,baseFeeAmount:p.productSnapshot.baseFeeAmount,mileageMonthlyFeeAmount:p.productSnapshot.mileageMonthlyFeeAmount,swapPolicy:p.productSnapshot.swapPolicy}:{})}:null,pricingMode:p.acceptancePricing?.ruleVersion??'STANDARD',pricingDescription:acceptancePricingDescription(p),monthlyFeeText:fen(p.monthlyFeeAmount),depositText:fen(p.depositAmount),termMonths:p.months,mileageText:`每月 ${p.mileagePerMonthKm} 公里`,energyText:p.energyDescription,vehicleName:a.vehicle?.title,title:selected?.name,...(staff?{reviewStatus:p.reviewStatus,creditVerificationId:p.creditVerificationId,creditBand:p.creditBand,priceAdjustmentReason:p.priceAdjustmentReason}:{})}:null;
 const virtual=!!a.vehicle?.virtualAcceptanceScopeId;
 if(virtual&&finalPlan)Object.assign(finalPlan,{pricingMode:'VIRTUAL_ACCEPTANCE',pricingDescription:'固定押金1元；测试首期1元；不形成租赁或交付义务',mileageText:'驾驶及里程不适用',energyText:'不适用'});
 return{...(virtual?{virtualAcceptance:{kind:'VIRTUAL_ACCEPTANCE',notice:VIRTUAL_NOTICE,reviewLabel:'测试资料确认（驾驶资格、信用核验不适用）'}}:{}),id:a.id,customerId:a.customerId,vehicleId:a.vehicleId,subscriptionPlanId:a.subscriptionPlanId,revision:a.revision,status:a.status,createdAt:a.createdAt,profile:a.profile,order:a.order?safeOrderIdentity(a.order):null,vehicle:a.vehicle?{id:a.vehicle.id,title:a.vehicle.title,brand:a.vehicle.brand,model:a.vehicle.model,coverFileId:a.vehicle.coverFileId}:null,subscriptionPlan:plan,type:'applications',title:a.vehicle?.title||'订阅申请',subtitle:selected?.name||'',statusText:statusNames[a.status],vehicleName:a.vehicle?.title,planName:selected?.name,plan,finalPlan,commercialHash:p?.commercialHash,nextAction:a.status==='AWAITING_CONFIRMATION'?'请核对并确认最终方案':statusNames[a.status],details:[{label:'申请编号',value:a.id},{label:'当前进度',value:statusNames[a.status]||'处理中'}],documents:[],timeline:[{title:'提交申请',description:'申请已记录',done:true},{title:'资料与方案审核',description:statusNames[a.status],done:a.status==='AWAITING_CONFIRMATION'||a.status==='FINAL_PLAN_CONFIRMED'},{title:'确认最终方案',description:'确认后建立订单',done:a.status==='FINAL_PLAN_CONFIRMED'}],actions:a.status==='AWAITING_CONFIRMATION'&&finalPlan?[{id:'confirm',label:'确认最终方案'},{id:'reject',label:'拒绝方案'}]:['SUBMITTED','IN_REVIEW','NEEDS_INFO'].includes(a.status)?[{id:'cancel',label:'取消申请'}]:[]};
}
const finalInput = z.object({ idempotencyKey:key,productSourceHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),priceAdjustmentReason:z.string().trim().min(1).max(1000).optional(), pricingMode: z.enum(['STANDARD','V1_ONE_FEN','V2_ONE_YUAN']).default('STANDARD'), creditVerificationId:text, agreedFeeComponents:agreedFeeComponentsInput.optional(), commercialTerms: z.union([commercialTermsInput,electronicCommercialTermsInput]), revision: z.number().int().nonnegative(), monthlyFeeAmount: money.positive(), depositAmount: money.optional(), months: termMonthsInput, mileagePerMonthKm: money, excessMileagePriceAmount: money, energyDescription: text, benefits: z.array(text).max(50), conditions: text, startDate: z.string(), firstDueDate: z.string().optional() }).strict();
@Controller()
export class ApplicationsController {
  constructor(@Inject(Db) private db: Db) {}
  @Post('customer/applications') async submit(@Body() body: any, @Req() request: any) {
    const input = z.object({ vehicleId: text, subscriptionPlanId: text, profile: z.object({ name: z.string().trim().min(1).max(40), drivingYears: z.number().int().min(0).max(70).optional(), fileIds: z.array(z.string()).default([]), mobile: z.string().max(20).optional(), handoverLocation: locationInput }).strict(), consents: z.array(z.object({ documentId: text, version: z.number().int().positive() })).min(1), idempotencyKey: key }).parse(body);
    const customerId = request.customer.id; const requestHash = hash(input);
    const operation = () => this.db.serial(async tx => {
      const existing = await tx.application.findUnique({ where: { customerId_idempotencyKey: { customerId, idempotencyKey: input.idempotencyKey } }, include: applicationInclude });
      if (existing) { ensure(existing.requestHash === requestHash, 409, 'IDEMPOTENCY_CONFLICT', '相同请求编号不可修改内容'); return applicationView(existing); }
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${input.vehicleId} FOR UPDATE`;
      const vehicle = await tx.vehicle.findUnique({ where: { id: input.vehicleId } }),virtual=await requireCurrentVirtualScope(tx,{vehicleId:input.vehicleId,customerId,action:'APPLICATION'});
      ensure(!virtual?.applicationId,409,'VIRTUAL_APPLICATION_EXISTS','此指定虚拟验收范围已有申请');
      ensure(vehicle&&(virtual?['DRAFT','PUBLISHED'].includes(vehicle.status):vehicle.status==='PUBLISHED'&&vehicle.catalogPublished===true)&&!vehicle.reservedOrderId&&!vehicle.holdId,409,'VEHICLE_UNAVAILABLE','车辆商品当前未上架或不可申请');
      await requireVehicleUnrestricted(tx,vehicle.id,'ALLOCATION');
      const plan = await tx.subscriptionPlan.findFirst({ where: { id: input.subscriptionPlanId, vehicleId: input.vehicleId, active: true } }); ensure(plan, 409, 'PLAN_UNAVAILABLE', '套餐不可用');
      if(!virtual&&['OFFLINE','ELECTRONIC'].includes(newOrderContractMode())){
        const product=await snapshotProduct(tx,plan.id);
        ensure(await applicationCooperationEligible(tx,vehicle.id,product.months),409,'VEHICLE_UNAVAILABLE',applicationUnavailableMessage);
      }
      await requireCurrentConsents(tx, customerId, ['terms','privacy']);
      await acceptConsents(tx, customerId, input.consents, ['application'], 'APPLICATION');
      const count = await tx.storedFile.count({ where: { id: { in: input.profile.fileIds }, customerId } }); ensure(count === new Set(input.profile.fileIds).size, 403, 'FILE_OWNERSHIP', '附件不属于当前客户');
      const open = await tx.application.count({ where: { customerId, status: { in: ['SUBMITTED','IN_REVIEW','NEEDS_INFO','AWAITING_CONFIRMATION'] } } }); ensure(open === 0, 409, 'ACTIVE_APPLICATION', '已有进行中的申请');
      const handoverLocation = virtual?null:await resolveLocation(tx, input.profile.handoverLocation, customerId);
      const profile=virtual?virtualApplicationProfile(await captureVirtualProfile(tx,customerId,vehicle.id)):applicationProfile(await captureCustomerProfileSnapshot(tx,customerId,'APPLICATION_SUBMISSION'),handoverLocation);
      if(virtual){ensure(plan.productVersionId===virtual.productVersionId,409,'VIRTUAL_PRODUCT_CHANGED');await snapshotProduct(tx,plan.id);}
      const application = await tx.application.create({ data: { ...input, profile, customerId, requestHash }, include: applicationInclude });
      if(virtual){const bound=await tx.virtualAcceptanceScope.updateMany({where:{id:virtual.id,applicationId:null,status:'READY'},data:{applicationId:application.id}});ensure(bound.count===1,409,'VIRTUAL_APPLICATION_EXISTS','测试申请已绑定');}
      await audit(tx, customerId, 'SUBMIT', 'applications', application.id, {}, 'CUSTOMER');
      return applicationView(application);
    });
    try { return await operation(); } catch (error: any) { if (error.code === 'P2002') return operation(); throw error; }
  }
  @Post('customer/applications/:id/amend') amend(@Param('id') id: string, @Body() body: any, @Req() request: any) {
    const input = z.object({ profile: z.object({ name: z.string().trim().min(1).max(40), drivingYears: z.number().int().min(0).max(70).optional(), fileIds: z.array(text).max(20).default([]), handoverLocation: locationInput }).strict(), note: z.string().max(2000).default(''), idempotencyKey: key }).parse(body);
    return this.db.serial(async tx => {
      await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${id} FOR UPDATE`;
      const app = await tx.application.findFirst({ where: { id, customerId: request.customer.id }, include: applicationInclude }); ensure(app, 404, 'NOT_FOUND', '申请不存在');
      const prior = await tx.auditLog.findFirst({ where: { resourceId: id, action: 'AMEND', data: { path: ['idempotencyKey'], equals: input.idempotencyKey } } });
      if (prior) { ensure((prior.data as any).requestHash === hash(input), 409, 'IDEMPOTENCY_CONFLICT', '补件请求编号与内容冲突'); return applicationView(app); }
      ensure(app.status === 'NEEDS_INFO', 409, 'STATE_CONFLICT', '申请当前不可补件');
      ensure(await tx.storedFile.count({ where: { id: { in: input.profile.fileIds }, customerId: request.customer.id, purpose: { not: 'vehicle' } } }) === new Set(input.profile.fileIds).size, 403, 'FILE_OWNERSHIP', '附件不属于当前客户');
      if (input.profile.handoverLocation != null) await requireCurrentConsents(tx, request.customer.id, ['privacy']);
      const handoverLocation = await resolveLocation(tx, input.profile.handoverLocation, request.customer.id, (app.profile as any)?.handoverLocation);
      const virtual=await requireCurrentVirtualScope(tx,{vehicleId:app.vehicleId,customerId:request.customer.id,applicationId:id,action:'AMEND'});
      const profile = virtual?virtualApplicationProfile(await captureVirtualProfile(tx,request.customer.id,app.vehicleId)):applicationProfile(await captureCustomerProfileSnapshot(tx,request.customer.id,'APPLICATION_AMENDMENT'),handoverLocation);
      const updated = await tx.application.update({ where: { id }, data: { profile, note: input.note, status: 'IN_REVIEW' }, include: applicationInclude });
      await audit(tx, request.customer.id, 'AMEND', 'applications', id, { previousProfile: app.profile, profile, note: input.note, idempotencyKey: input.idempotencyKey, requestHash: hash(input) }, 'CUSTOMER'); return applicationView(updated);
    });
  }
  @Get('customer/applications/:id') async get(@Param('id') id: string, @Req() request: any) { const item = await this.db.application.findFirst({ where: { id, customerId: request.customer.id }, include: applicationInclude }); ensure(item, 404, 'NOT_FOUND', '申请不存在'); return applicationView(item); }
  @Post('admin/applications/:id/review') async review(@Param('id') id: string, @Body() body: any, @Req() request: any) {
    const input = z.object({ decision: z.enum(['IN_REVIEW','NEEDS_INFO','REJECTED']), note: z.string().max(2000).default('') }).parse(body);
    return this.db.serial(async tx => { await requireCurrentStaff(tx,request.admin,'applications');await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${id} FOR UPDATE`; const app = await tx.application.findUnique({ where: { id } }); ensure(app && (['SUBMITTED','IN_REVIEW','NEEDS_INFO'].includes(app.status)||(app.status==='AWAITING_CONFIRMATION'&&input.decision==='NEEDS_INFO')), 409, 'STATE_CONFLICT', '申请当前状态不可审核'); const item = await tx.application.update({ where: { id }, data: { status: input.decision, note: input.note }, include: applicationInclude }); await audit(tx, request.admin.id, 'REVIEW', 'applications', id, input); await notify(tx, app.customerId, '申请审核更新', input.note || statusNames[input.decision], 'applications', id); return applicationView(item); });
  }
  @Get('admin/applications/:id/final-plan-defaults') async finalPlanDefaults(@Param('id') id:string,@Req() request:any){
    return this.db.serial(async tx=>{
      await requireCurrentStaff(tx,request.admin,'applications',false);
      const application=await tx.application.findUnique({where:{id},include:{vehicle:true}});
      ensure(application,404,'NOT_FOUND','申请不存在');
      return readFinalPlanDefaults(tx,application);
    });
  }
  @Post('admin/applications/:id/final-plan') async finalPlan(@Param('id') id:string,@Body() body:unknown,@Req() request:any){
    const input=finalInput.parse(body);let startDate:Date,firstDueDate:Date;
    try{startDate=dateOnly(input.startDate);firstDueDate=dateOnly(input.firstDueDate??input.startDate);}catch{ensure(false,400,'VALIDATION','起租日或付款日无效');}
    return this.db.serial(async tx=>{
      await requireCurrentStaff(tx,request.admin,'applications');
      await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${id} FOR UPDATE`;
      return archiveCommand(tx,request.admin,`application:${id}`,'FINAL_PLAN',input,async()=>{
        const app=await tx.application.findUnique({where:{id}});ensure(app,404,'NOT_FOUND','申请不存在');
        ensure(!await isVirtualVehicle(tx,app.vehicleId),409,'VIRTUAL_QUOTE_ENTRY_REQUIRED','请从指定测试报价与测试资料确认入口办理');
        ensure(app.revision===input.revision,409,'REVISION_CONFLICT','最终方案已更新，请刷新');
        ensure(['IN_REVIEW','AWAITING_CONFIRMATION'].includes(app.status),409,'STATE_CONFLICT','请先开始资料审核');
        const contractMode=newOrderContractMode();if(contractMode!=='ELECTRONIC')ensure(input.firstDueDate&&commercialTermsInput.safeParse(input.commercialTerms).success&&!input.agreedFeeComponents,400,'VALIDATION','历史方案须填写完整商业条款及首期付款日');const productSnapshot=['OFFLINE','ELECTRONIC'].includes(contractMode)?await snapshotProduct(tx,app.subscriptionPlanId):undefined;
        assertProductSourceHash(productSnapshot,input.productSourceHash);
        await requireCurrentConsents(tx,app.customerId,['terms','privacy']);
        const credit=await requireCredit(tx,app,input.creditVerificationId),standardDeposit=money.parse(input.monthlyFeeAmount*credit.multiplier),pricing=finalPlanPricing(app,input,standardDeposit,request.admin);
        const {pricingMode,idempotencyKey,productSourceHash,...proposal}=input,usagePolicy=await snapshotUsagePolicy(tx,productSnapshot);
        ensure(input.mileagePerMonthKm===usagePolicy.baseAllowanceKm&&input.excessMileagePriceAmount===usagePolicy.excessPriceAmount,409,'USAGE_POLICY','报价里程与本单冻结使用规则不一致');
        const range=leaseRange(startDate,input.months);
        if(productSnapshot&&pricingMode==='STANDARD')assertProductQuote(productSnapshot,input);if(contractMode==='ELECTRONIC')ensure(input.months===productSnapshot?.months&&productSnapshot?.minimumTermMonths!=null&&validTermMonths(input.months,productSnapshot.minimumTermMonths),409,'PRODUCT_TERM_INVALID','约定期限须不低于产品最短期限且至少三个月');
        if(contractMode==='ELECTRONIC'){ensure(input.firstDueDate===undefined,400,'INDEPENDENT_DUE_DATE_DISABLED','新电子方案首期为交付前预付款，不单独指定首期付款日');ensure(electronicCommercialTermsInput.safeParse(input.commercialTerms).success,400,'COMMERCIAL_TERMS_REQUIRED','只填写本单车辆、联系地址与计划交付事实');}
        if(contractMode==='ELECTRONIC')electronicDeliveryPlan(input.startDate,input.commercialTerms.handoverArrangement);
        const agreedFeeComponents=contractMode==='ELECTRONIC'?assertAgreedFeeComponents(productSnapshot,input):undefined;
        const lessorSnapshot=contractMode==='ELECTRONIC'?await buildElectronicLessorSnapshot(tx,app.vehicleId,range):contractMode==='OFFLINE'?await buildOfflineLessorSnapshot(tx,app.vehicleId,range):await buildLessorSnapshot(tx,app.vehicleId);
        const revenueRuleSnapshot=['OFFLINE','ELECTRONIC'].includes(contractMode)?await snapshotRevenueRule(tx,lessorSnapshot!.ownerId,app.vehicleId,range.startDate,range.endDate):undefined;
        const fixed={...proposal,...pricing,contractMode,...(contractMode==='ELECTRONIC'?{firstDueDate:input.startDate}:{}),...(agreedFeeComponents?{agreedFeeComponents}:{}),...(lessorSnapshot?{lessorSnapshot}:{}),...(productSnapshot?{productSnapshot}:{}),...(revenueRuleSnapshot?{revenueRuleSnapshot}:{}),usagePolicyVersion:usagePolicy.policyVersion,usagePolicy,creditBand:credit.verification.band,creditRuleVersion:CREDIT_RULE,creditRevision:app.creditRevision};
        const revision=app.revision+1,commercialHash=hash({...fixed,vehicleId:app.vehicleId,revision});
        await tx.finalPlan.create({data:{...fixed,applicationId:id,revision,commercialHash,startDate,firstDueDate,reviewStatus:contractMode==='ESIGN'?'LEGACY':'DRAFT'}});
        const updated=await tx.application.update({where:{id},data:{revision,status:contractMode==='ESIGN'?'AWAITING_CONFIRMATION':'IN_REVIEW'},include:applicationInclude});
        await audit(tx,request.admin.id,'FINAL_PLAN','applications',id,{revision,commercialHash,contractMode});
        if(contractMode==='ESIGN')await notify(tx,app.customerId,'最终方案待确认','请核对车辆、费用、期限和条款。','applications',id);
        return applicationView(updated,true);
      });
    });
  }
  @Post('customer/applications/:id/confirm') async confirm(@Param('id') id: string, @Body() body: any, @Req() request: any) {
    const input = z.object({ revision: z.number().int().nonnegative(), commercialHash: z.string().length(64), ownerSharing:z.unknown().optional() }).strict().parse(body);
    return this.db.serial(async tx => {
      await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${id} FOR UPDATE`;
      const app = await tx.application.findFirst({ where: { id, customerId: request.customer.id }, include: applicationInclude }); ensure(app, 404, 'NOT_FOUND', '申请不存在');
      const final = app.finalPlans[0]; ensure(final && input.revision === app.revision && input.commercialHash === final.commercialHash, 409, 'REVISION_CONFLICT', '最终方案已更新，请重新阅读');
      if (app.order && app.status === 'FINAL_PLAN_CONFIRMED') return safeOrderIdentity(app.order);
      ensure(app.status === 'AWAITING_CONFIRMATION', 409, 'STATE_CONFLICT', '当前申请不能确认');
      ensure(newOrderContractMode()!=='ELECTRONIC'||final.contractMode==='ELECTRONIC',409,'CONTRACT_MODE_CHANGED','已切换电子合同，请联系运营重新出具电子签约方案后确认');
      const virtual=await requireCurrentVirtualScope(tx,{vehicleId:app.vehicleId,customerId:app.customerId,applicationId:id,action:'CONFIRM'});
      if(virtual)ensure(final.contractMode==='ELECTRONIC'&&!virtual.orderId,409,'VIRTUAL_ORDER_MISMATCH','测试范围已绑定订单或方案模式不符');
      await requireCurrentConsents(tx,app.customerId,['terms','privacy']);
      const business=['OFFLINE','ELECTRONIC'].includes(final.contractMode)?await quoteReady(tx,id,final.revision):null;
      if(business)ensure(business.ready&&business.snapshots,409,business.blockers[0]?.code||'ORDER_BUSINESS_NOT_READY',business.blockers[0]?.label||'订单资料未就绪');
      if(!virtual){const credit=await requireCredit(tx,app,final.creditVerificationId||'');
      ensure(final.creditRevision===app.creditRevision&&final.creditRuleVersion===CREDIT_RULE&&final.creditBand===credit.verification.band,409,'CREDIT_REVIEW_REQUIRED','核验或押金规则已更新，请重新确认最终方案');
      assertFinalPricing(app,final,final.monthlyFeeAmount*credit.multiplier);}else assertVirtualPrice(final);
      ensure((final.contractMode==='ELECTRONIC'?electronicCommercialTermsInput:commercialTermsInput).safeParse(final.commercialTerms).success, 409, 'COMMERCIAL_TERMS_REQUIRED', '最终方案条款不完整，请后台重新出具完整方案');
      if(!virtual)usagePolicyAppendix(final.usagePolicy);else ensure((final.usagePolicy as any)?.schema==='VIRTUAL_NO_DRIVING_V1'&&(final.usagePolicy as any)?.configurationHash===virtual.configurationHash,409,'VIRTUAL_QUOTE_CHANGED');
      const ownerDataConsent=final.contractMode==='ELECTRONIC'?await this.confirmElectronicLessor(tx,app,final,input.ownerSharing):final.lessorSnapshot?(final.contractMode==='OFFLINE'?await confirmOfflineLessor(tx,app.customerId,app.vehicleId,final.lessorSnapshot,input.ownerSharing):await confirmLessor(tx,app.customerId,app.vehicleId,final.lessorSnapshot,input.ownerSharing)):null;
      if(!final.lessorSnapshot)ensure(!await tx.ownerVehicle.count({where:{vehicleId:app.vehicleId}})&&process.env.OWNER_CONTRACTS_ENABLED!=='true',409,'OWNER_LESSOR_CHANGED','车辆出租方已变化，请重新出具最终方案');
      const customerProfileSnapshot=virtual?await confirmVirtualProfile(tx,app.customerId,app.vehicleId,(app.profile as any)?.customerProfileSnapshot):await confirmCustomerProfileSnapshot(tx,app.customerId,(app.profile as any)?.customerProfileSnapshot);
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${app.vehicleId} FOR UPDATE`;
      await requireVehicleUnrestricted(tx,app.vehicleId,'ALLOCATION');
      const claim = await tx.vehicle.updateMany({ where: { id: app.vehicleId, reservedOrderId: null, holdId:null, status: virtual?{in:['DRAFT','PUBLISHED']}:'PUBLISHED' }, data: { status: 'RESERVED' } }); ensure(claim.count === 1, 409, 'VEHICLE_UNAVAILABLE', '该车已被其他订单占用');
      const confirmedCustomer=await tx.customer.findUniqueOrThrow({where:{id:app.customerId}}),offlineLessor=final.lessorSnapshot as any;
      const parties=final.contractMode==='ELECTRONIC'?{platformLegalEntityName:offlineLessor.platformLegalEntityName,partiesSnapshot:[{role:'CUSTOMER',partyId:app.customerId,name:confirmedCustomer.name,subjectType:'INDIVIDUAL'},{role:'OWNER',partyId:offlineLessor.ownerId,name:offlineLessor.name,subjectType:offlineLessor.subjectType},await electronicPlatformParty(tx)]}:final.contractMode==='OFFLINE'?{platformLegalEntityName:offlineLessor.platformLegalEntityName,partiesSnapshot:[{role:'CUSTOMER',partyId:app.customerId,name:confirmedCustomer.name,subjectType:'INDIVIDUAL'},{role:'OWNER',partyId:offlineLessor.ownerId,name:offlineLessor.name,subjectType:offlineLessor.subjectType},{role:'PLATFORM',partyId:offlineLessor.platformLegalEntityName,name:offlineLessor.platformLegalEntityName,subjectType:'ENTERPRISE'}]}:{};
      const order = await tx.order.create({ data: { applicationId: id, customerId: request.customer.id, vehicleId: app.vehicleId, confirmedMileageKm: app.vehicle.mileageKm,contractMode:final.contractMode,status:final.contractMode==='OFFLINE'?'AWAITING_CONTRACT_REVIEW':'AWAITING_SIGNATURE', finalPlanSnapshot: JSON.parse(JSON.stringify({...final,...parties,customerProfileSnapshot,...(business?.snapshots?{riskSnapshot:business.snapshots.riskSnapshot}:{}),...(ownerDataConsent?{ownerDataConsent}:{})})) } });
      await tx.vehicle.update({ where: { id: app.vehicleId }, data: { reservedOrderId: order.id } });
      if(virtual){const binding=await tx.virtualAcceptanceScope.updateMany({where:{id:virtual.id,applicationId:app.id,orderId:null,status:'READY'},data:{orderId:order.id}});ensure(binding.count===1,409,'VIRTUAL_ORDER_MISMATCH','测试订单已绑定');}
      await tx.application.update({ where: { id }, data: { status: 'FINAL_PLAN_CONFIRMED' } });
      await tx.contract.create({ data: { orderId: order.id, customerId: order.customerId,executionMode:final.contractMode, documentHash: final.commercialHash, ...(final.lessorSnapshot?{documentId:(final.lessorSnapshot as any).templateId,templateVersion:(final.lessorSnapshot as any).templateVersion}:{}) } });
      const schedule = billSchedule(final.firstDueDate.toISOString().slice(0, 10), final.contractMode==='ELECTRONIC'?1:final.months, final.monthlyFeeAmount);
      await tx.bill.createMany({ data: schedule.map(b => ({ orderId: order.id, customerId: order.customerId, type: 'SUBSCRIPTION', ...(final.contractMode==='ELECTRONIC'?{description:'首期订阅预付款（实际服务期间待交付确定）'}:{}), sequence: b.sequence, amount: b.amount, dueDate: dateOnly(b.dueDate) })) });
      if (final.depositAmount > 0) await tx.bill.create({ data: { orderId: order.id, customerId: order.customerId, type: 'DEPOSIT', sequence: 0, amount: final.depositAmount, dueDate: final.firstDueDate } });
      await new EntitlementService().freeze(tx,order.id);
      if(final.contractMode==='OFFLINE'){const range=leaseRange(final.startDate,final.months);await createLeaseRenewalReminders(tx,app.vehicleId,new Date(range.endDate+'T16:00:00.000Z'),new Date());}
      await audit(tx, order.customerId, 'CONFIRM', 'applications', id, { orderId: order.id, revision: input.revision, commercialHash: input.commercialHash }, 'CUSTOMER');
      await notify(tx, order.customerId, '方案已确认', '订单已建立，请等待合同准备。', 'orders', order.id);
      return safeOrderIdentity(order);
    });
  }
  private async confirmElectronicLessor(tx:any,app:any,final:any,raw:any){const current=await buildElectronicLessorSnapshot(tx,app.vehicleId,(final.lessorSnapshot as any).leaseRange);const s=final.lessorSnapshot as any;ensure(canonicalHash(current)===canonicalHash(s),409,'OWNER_LESSOR_CHANGED','实际出租方或告知已变化');ensure(raw?.accepted===true&&raw.lessorHash===lessorIdentityHash(s)&&raw.noticeHash===s.sharingNotice.contentHash,409,'OWNER_SHARING_CONSENT','须确认当前实际出租方资料告知');return{ownerId:s.ownerId,customerId:app.customerId,acceptedAt:new Date().toISOString(),lessorHash:raw.lessorHash,notice:s.sharingNotice};}
  @Post('customer/applications/:id/cancel') cancel(@Param('id') id: string, @Body() body: any, @Req() request: any) { return this.close(id, body, request, false); }
  @Post('customer/applications/:id/reject') reject(@Param('id') id: string, @Body() body: any, @Req() request: any) { return this.close(id, body, request, true); }
  private async close(id: string, body: any, request: any, reject: boolean) {
    const input = z.object({ reason: z.string().max(1000).default(''), revision: z.number().int().optional() }).parse(body);
    return this.db.serial(async tx => { const app = await tx.application.findFirst({ where: { id, customerId: request.customer.id } }); ensure(app, 404, 'NOT_FOUND', '申请不存在'); ensure(['SUBMITTED','IN_REVIEW','NEEDS_INFO','AWAITING_CONFIRMATION'].includes(app.status), 409, 'STATE_CONFLICT', '当前申请不可取消或拒绝'); if (reject) ensure(app.status === 'AWAITING_CONFIRMATION' && input.revision === app.revision && input.reason.trim(), 409, 'REVISION_CONFLICT', '请填写原因并核对最新方案版本'); const updated = await tx.application.update({ where: { id }, data: { status: reject ? 'REJECTED' : 'CANCELLED', note: input.reason }, include: applicationInclude }); await audit(tx, request.customer.id, reject ? 'REJECT' : 'CANCEL', 'applications', id, input, 'CUSTOMER'); return applicationView(updated); });
  }
}
