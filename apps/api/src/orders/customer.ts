import {billReason,withBillPeriods} from '../billing/display';
import {customerHiddenRecords} from '../customers/record-visibility';
import {readRenewalBillCancellation,customerBillVisibility} from '../order-renewals/cancellation-view';
import {readCustomerProfile,saveCustomerProfile} from '../customers/profile';
import {contractInclude,customerContractRecord,unavailableContractRecord} from './customer-contract-view';
import {customerOrderRecord,orderRecordSummary,orderGuidance} from './customer-order-view';
import {currentAssignment,assignmentView} from '../vehicle-changes/assignments';
import {effectiveTerms} from '../order-changes/context';
import { Body, Controller, Get, Inject, Param, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../common/db';
import { ensure } from '../common/errors';
import { fen, pagination } from '../common/data';
import { applicationInclude, applicationView } from '../applications/applications';
import { vehicleView,readPublicCatalog } from '../catalog/catalog';
import {EntitlementService} from '../entitlements/service';
const records: Record<string,string> = { mileages: 'mileage', applications: 'application', orders: 'order', contracts: 'contract', bills: 'bill', payments: 'payment', deposits: 'depositEntry', entitlements: 'entitlement', notifications: 'notification', services: 'serviceRequest' };
const labels: Record<string,string> = { mileages: '里程申报', orders: '车辆订阅订单', contracts: '汽车订阅服务合同', bills: '订阅账单', payments: '支付记录', deposits: '押金流水', entitlements: '订阅权益', notifications: '站内通知', services: '用车服务' };
const statuses: Record<string,string> = { DRAFT:'待发布',PENDING:'待处理',PAID:'已支付',SUCCEEDED:'已成功',CREATING:'渠道处理中',FAILED:'未成功',CLOSED:'已关闭',ACTIVE:'用车中',SETTLING:'已还车待结算',AWAITING_CONTRACT_REVIEW:'线下合同待归档',AWAITING_SIGNATURE:'待签约',AWAITING_PAYMENT:'待支付',AWAITING_HANDOVER:'待交付',SIGNED:'已签署',SUBMITTED:'待受理',ASSIGNED:'已派单',ACCEPTED:'已受理',IN_PROGRESS:'处理中',COMPLETED:'已完成',CANCELLED:'已取消',EXPIRED:'已到期',READ:'已读',UNREAD:'未读',RECEIPT:'押金收入',REFUND:'押金退回' };
function safeCustomerTerms(snapshot:any){return Object.fromEntries(['monthlyFeeAmount','depositAmount','months','startDate','firstDueDate','mileagePerMonthKm','excessMileagePriceAmount','energyDescription','conditions'].filter(k=>['string','number'].includes(typeof snapshot?.[k])).map(k=>[k,snapshot[k]]));}
export function recordView(type: string, item: any) {
  if (type === 'applications') return applicationView(item);
  if (type === 'orders') return orderRecordSummary(item);
  if (type === 'contracts') return unavailableContractRecord(item);
  const status = type === 'notifications' ? item.readAt ? 'READ' : 'UNREAD' : item.status || item.type;
  const statusText=type==='bills'&&status==='PENDING'&&!item.cancellation?'待支付':type==='bills'&&item.cancellation?(item.cancellation.serviceEffect==='NEVER_EFFECTIVE'?'新增期已取消':item.cancellation.status==='OPEN'?'取消处理中':'已取消'):type==='entitlements'?({PENDING:'待激活',ACTIVE:'可使用',EXPIRED:'已到期'} as Record<string,string>)[status]||statuses[status]||status:statuses[status]||status;
  const actions: any[] = [];
  if (type === 'notifications' && !item.readAt) actions.push({ id: 'read', label: '标记已读' });
  if (type === 'services' && status === 'SUBMITTED') actions.push({ id: 'cancel', label: '取消工单' });
  if (type === 'bills' && status === 'PENDING' && item.canPay!==false) actions.push({ id: 'pay', label: '立即支付' });
  const createdAt=item.createdAt instanceof Date?item.createdAt.toISOString():typeof item.createdAt==='string'?item.createdAt:'';
  const details = [{ label: '编号', value: item.id }, { label: '状态', value: statusText }, { label: '创建时间', value: createdAt }];
  if (item.readingKm != null) details.push({ label: '里程', value: `${item.readingKm} 公里` });
  if (item.amount != null) details.push({ label: type==='bills'?'应收金额':'金额', value: fen(item.amount) });
  if(type==='bills'&&status==='PENDING')details.push({label:'待支付金额',value:fen(Math.max(0,item.amount-item.paidAmount))});
  if (item.dueDate) details.push({ label: '应付日期', value: item.dueDate.toISOString().slice(0,10) });
  if (item.location) details.push({ label: '位置', value: item.location });
  if (item.description) details.push({ label: '说明', value: item.description });
  if (item.providerName) details.push({ label: '服务商', value: `${item.providerName} ${item.contact || ''}` });
  if (item.content) details.push({ label: '内容', value: item.content });
  if (item.note) details.push({ label: '处理说明', value: item.note });
  const safe=Object.fromEntries(['id','orderId','status','createdAt','updatedAt','amount','paidAmount','dueDate','sequence','description','title','readingKm','location','providerName','contact','note','content','readAt','reconciliationRequired','serviceRequestId','kind','unit','totalQuantity','availableQuantity','reservedQuantity','usedQuantity','expiredQuantity','pendingServiceCount','provider','conditions','validity','activatedAt','expiredAt','revision','benefitVersionId'].filter(k=>item[k]!==undefined).map(k=>[k,item[k]]));
  return { ...safe, ...(type==='bills'?{billType:item.type,period:item.period??null,cancellation:item.cancellation??null}:{}),type, title: (type==='bills'?billReason(item):item.title) || (type==='contracts'&&item.kind==='AMENDMENT'?'订阅变更补充协议':type === 'services' ? item.type === 'rescue' ? '道路救援申请' : '事故报案' : labels[type]), subtitle: item.orderId || '', status, statusText, amountText: item.amount == null ? '' : fen(type==='bills'&&status==='PENDING'?Math.max(0,item.amount-item.paidAmount):item.amount), details, timeline: [{ title: statusText, description: item.note || item.content || '', done: true }], actions, documents: [...(item.evidenceFileIds || []),item.sourceFileId,item.signedFileId].filter(Boolean).map(id => ({ id, title: type === 'bills' ? '费用证据' : '合同文件', url: `/api/customer/files/${id}` })) };
}
async function customerBillView(tx:any,item:any){const state=await readRenewalBillCancellation(tx,item);ensure(item.status!=='VOID'||state.voidReadable,404,'NOT_FOUND','记录不存在');const [display]=await withBillPeriods(tx,[item]);return {...recordView('bills',{...display,...state}),id:item.id,cancellation:state.cancellation};}
@Controller('customer')
export class CustomerController {
  constructor(@Inject(Db) private db: Db) {}
  @Get('context') async context(@Req() request: any) { const c = request.customer; const profile = await readCustomerProfile(this.db,c.id); const consents = await this.db.customerConsent.findMany({ where: { customerId: c.id }, select: {documentId:true,version:true,type:true,acceptedAt:true} }); return { mode: 'real', consents, customer: { id: c.id, name: profile.name, mobile: profile.mobile, profile, wechatBound: !!c.openId }, profile }; }
  @Get('profile') getProfile(@Req() request:any){return readCustomerProfile(this.db,request.customer.id);}
  @Put('profile') profile(@Body() body:unknown,@Req() request:any){return this.db.serial(tx=>saveCustomerProfile(tx,request.customer.id,body));}
  @Get('home') async home(@Req() request: any) {
    const customerId=request.customer.id,hidden=await customerHiddenRecords(this.db,request.customer.id);
    const visible=(type:string)=>hidden[type]?.length?{id:{notIn:hidden[type]}}:{};
    const [catalog,application,order]=await Promise.all([
      readPublicCatalog(this.db,{page:1,pageSize:2}),
      this.db.application.findFirst({where:{customerId,...visible('applications'),status:{notIn:['CANCELLED','REJECTED','FINAL_PLAN_CONFIRMED']}},orderBy:{createdAt:'desc'},include:applicationInclude}),
      this.db.order.findFirst({where:{customerId,...visible('orders'),status:{notIn:['CANCELLED','COMPLETED']}},orderBy:{createdAt:'desc'},select:{id:true,status:true}})
    ]);
    const contracts=order?.status==='AWAITING_SIGNATURE'?await this.db.contract.findMany({where:{orderId:order.id,customerId,...visible('contracts'),kind:'SUBSCRIPTION'},include:contractInclude}):[];
    const contractViews=await Promise.all(contracts.map(c=>customerContractRecord(this.db,customerId,c)));
    const bills=order?.status==='AWAITING_PAYMENT'?await this.db.bill.findMany({where:{orderId:order.id,customerId,...visible('bills'),status:{in:['PENDING','PAID']}},select:{status:true,amount:true,paidAmount:true}}):[];
    return{context:await this.context(request),vehicles:catalog.items,nextAction:order?{...orderGuidance(order.status,contractViews,bills),label:'查看订单',url:`/pages/record/index?type=orders&id=${encodeURIComponent(order.id)}`}:application?{title:applicationView(application).statusText,description:applicationView(application).nextAction,label:'查看申请',url:`/pages/application-detail/index?id=${application.id}`} :null};
  }
  @Get('dashboard') async dashboard(@Req() request: any) {
    const customerId = request.customer.id,hidden=await customerHiddenRecords(this.db,request.customer.id);
    const visible=(type:string)=>hidden[type]?.length?{id:{notIn:hidden[type]}}:{};
    const [order, bills, services, entitlements, handover, application] = await Promise.all([this.db.order.findFirst({ where: { customerId, ...visible('orders'), status: { notIn: ['CANCELLED','COMPLETED'] } }, include: { vehicle: { include: { plans: true } } }, orderBy: { createdAt: 'desc' } }), this.db.bill.findMany({ where: { customerId, ...visible('bills'), status: 'PENDING' }, orderBy: { dueDate: 'asc' } }), this.db.serviceRequest.findMany({ where: { customerId, ...visible('services') }, orderBy: { createdAt: 'desc' }, take: 5 }), this.db.entitlement.findMany({ where: { customerId, ...visible('entitlements'), status: 'ACTIVE' } }), this.db.handover.findFirst({ where: { customerId, ...visible('handovers'), status: { notIn: ['DRAFT','COMPLETED','SUPERSEDED'] } }, orderBy: { createdAt: 'desc' } }), this.db.application.findFirst({ where: { customerId, ...visible('applications'), status: { notIn: ['CANCELLED','REJECTED','FINAL_PLAN_CONFIRMED'] } }, include: applicationInclude, orderBy: { createdAt: 'desc' } })]);
    const snapshot: any = order?await effectiveTerms(this.db,order):null;
    const assignment=order?await currentAssignment(this.db,order):null,hasAssignments=order?await this.db.vehicleAssignment.count({where:{orderId:order.id}}):0,currentVehicle=assignment?.vehicle||(hasAssignments?null:order?.vehicle);
    const delayChange=order?await this.db.orderChange.findFirst({where:{orderId:order.id,status:{notIn:['CANCELLED','REJECTED']}},orderBy:{createdAt:'desc'}}):null;
    const billViews=await Promise.all(bills.map(b=>customerBillView(this.db,b)));
    const entitlementViews=await Promise.all(entitlements.filter(i=>!order||i.orderId===order.id).map(async i=>recordView('entitlements',{...await new EntitlementService().view(this.db,i),createdAt:i.createdAt})));
    return { context: await this.context(request), active: order?.status === 'ACTIVE', application: application ? applicationView(application) : null, subscription: order ? { id:order.id,applicationId:order.applicationId,status:order.status,contractMode:order.contractMode,revision:order.revision,createdAt:order.createdAt,effectiveTerms:order.effectiveTermsVersionId?safeCustomerTerms(snapshot):null, deliveryDelayChangeId:delayChange?.kind==='DELIVERY_DELAY'?delayChange.id:null,activeChangeId:delayChange&& !['APPLIED','CANCELLED','REJECTED'].includes(delayChange.status)?delayChange.id:null,currentAssignment:assignmentView(assignment), orderId: order.id, title: currentVehicle?.title||'换车待交付', vehicleName: currentVehicle?.title||'换车待交付', vehicle: currentVehicle?vehicleView(currentVehicle):null, statusText: statuses[order.status], planTitle: `${snapshot.months} 个月订阅`, nextDueDate: bills[0]?.dueDate.toISOString().slice(0,10) || '', monthlyFeeText:order.effectiveTermsVersionId?'按补充协议逐期结算':fen(snapshot.monthlyFeeAmount), periodText: `${String(snapshot.startDate).slice(0,10)} 起`, mileageText: `每月 ${snapshot.mileagePerMonthKm} 公里`, imageUrl: currentVehicle?.coverFileId ? `/api/public/media/${currentVehicle.coverFileId}` : '' } : null, vehicle: currentVehicle ? vehicleView(currentVehicle) : null, bill: billViews[0]??null, bills: billViews, services: services.map(i => recordView('services',i)), entitlements: entitlementViews, mileage: hasAssignments&&!assignment?null:order?.confirmedMileageKm || 0, handover:handover?{id:handover.id,type:handover.type,status:handover.status,executionMode:handover.executionMode,revision:handover.revision,manifestHash:handover.manifestHash}:null, todos: [...billViews.map(b => ({ title: b.cancellation?'续期取消进度':'账单待支付', label: '查看账单', url: `/pages/record/index?type=bills&id=${b.id}` })), ...(handover ? [{ title: '交接事实待核对', label: '核对交接', url: `/pages/handover/index?id=${handover.id}` }] : [])] };
  }
  @Get('records/:type') async records(@Param('type') type: string, @Query() query: any, @Req() request: any) { ensure(records[type], 404, 'NOT_FOUND', '记录类型不存在'); const p = pagination(query); const hidden=await customerHiddenRecords(this.db,request.customer.id); const where: any = { customerId: request.customer.id, ...(hidden[type]?.length?{id:{notIn:hidden[type]}}:{}) }; if (type === 'bills') Object.assign(where,customerBillVisibility(request.customer.id)); const model = (this.db as any)[records[type]]; const [items,total] = await Promise.all([model.findMany({ where, take: p.pageSize, skip: p.skip, orderBy: { createdAt:'desc' }, ...(type === 'applications' ? { include: applicationInclude } : type === 'contracts' ? {include:contractInclude} : {}) }), model.count({ where })]); return { items: await Promise.all(items.map((i:any) => type==='bills'?customerBillView(this.db,i):type==='contracts'?customerContractRecord(this.db,request.customer.id,i):type==='entitlements'?new EntitlementService().view(this.db,i).then(v=>recordView(type,{...v,createdAt:i.createdAt})):recordView(type,i))), total, page:p.page,pageSize:p.pageSize }; }
  @Get('records/:type/:id') async record(@Param('type') type: string, @Param('id') id: string, @Req() request: any) { ensure(records[type],404,'NOT_FOUND','记录类型不存在'); if(type==='orders')return customerOrderRecord(this.db,request.customer.id,id); const item = await (this.db as any)[records[type]].findFirst({ where: { id, customerId:request.customer.id, ...(type === 'bills' ? { status: { notIn:['DRAFT','REVIEWED'] } } : {}) }, ...(type === 'applications' ? { include: applicationInclude } : type === 'contracts' ? {include:contractInclude} : {}) }); ensure(item,404,'NOT_FOUND','记录不存在'); return type==='bills'?customerBillView(this.db,item):type==='contracts'?customerContractRecord(this.db,request.customer.id,item):type==='entitlements'?recordView(type,{...await new EntitlementService().view(this.db,item),createdAt:item.createdAt}):recordView(type,item); }
}
