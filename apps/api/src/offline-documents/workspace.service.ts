import {newOrderContractMode} from './mode';
import {withBillPeriods} from '../billing/display';
import {readRenewalBillCancellation} from '../order-renewals/cancellation-view';
import {withBillPublication} from '../billing/publication-view';
import {loadOrderProcessFacts} from '../orders/order-process-facts';
import {orderProcess} from '../orders/order-process';
import {workspaceTimeline,workspaceResponsibility} from './workspace-facts';
import {customerHiddenRecords} from '../customers/record-visibility';
import {Inject,Injectable} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {requireCurrentStaff} from '../auth/staff-session';
import {ensure} from '../common/errors';
import {ArchiveActor} from './schemas';
import {archiveSummary} from './projection';
import {archiveOwnerId} from './context';
import {orderBusinessHash,readinessFromArchive,feedbackHold,cooperationFeedbackOpen,readContractReady} from './readiness';
import {ownerOrderSharingValid,sharedOwnerOrderIds,requireArchivePartnerIdentity} from './partner-access';
import {readPartnerOrderWorkspace,listPartnerOrderWorkspaces} from '../partners/order-workspace';
const querySchema=z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).strict();
export function workspaceProjection(order:any,archives:any[],actor:ArchiveActor){
 const hash=orderBusinessHash(order),initialHash=order.finalPlanSnapshot?.commercialHash||'',contracts=archives.map(a=>archiveSummary({...a,customerId:order.customerId},a.handoverId?order.handovers?.find((h:any)=>h.id===a.handoverId)?.manifestHash||'':a.kind==='RENTAL'?initialHash:a.kind==='ORDER_AMENDMENT'?(a.quote?.id===a.quoteId&&a.subjectId===a.quoteId&&a.quote?.change?.orderId===order.id?a.quote.commercialHash:''):hash,actor));
 const rental=archives.find(a=>a.kind==='RENTAL'),readiness=order.contractMode==='OFFLINE'&&order.offlinePaymentReadiness?order.offlinePaymentReadiness:order.contractMode==='OFFLINE'&&order.effectiveTermsVersionId?(order.offlineContractChain||{ready:false,blockers:['AGREEMENT_TERMS_CHAIN_BROKEN']}):readinessFromArchive(rental,initialHash),open=!!order.cooperationFeedbackOpen||archives.some(a=>a.versions?.some((v:any)=>v.feedback?.some((f:any)=>f.status==='OPEN'))),holds=feedbackHold(order.status,open);
 const blockers=order.contractMode==='ELECTRONIC'?[]:[...readiness.blockers,...(open?['ARCHIVE_FEEDBACK_OPEN']:[])];
 const operator=['ADMIN','OPERATIONS'].includes(actor.role),customer=actor.role==='CUSTOMER';
 const visibleBills=actor.role==='SUPPORT'?[]:(order.bills||[]).filter((b:any)=>!['CUSTOMER','OWNER'].includes(actor.role)||(['PENDING','PAID'].includes(b.status)||b.status==='VOID'&&b.voidReadable===true));const payable=visibleBills.find((b:any)=>b.canPay!==false&&b.status==='PENDING'&&b.amount>0&&Number.isSafeInteger(b.amount)&&Number.isSafeInteger(b.paidAmount)&&b.paidAmount>=0&&b.paidAmount<b.amount);
 const latestRental=[...(rental?.versions||[])].sort((a:any,b:any)=>(b.version||0)-(a.version||0))[0],pending=latestRental?.status==='SUBMITTED'?rental:null,reviewed=latestRental?.status==='REVIEWED'?rental:null;
 let code='VIEW_ARCHIVE',label='查看合同资料',resourceId=rental?.id||order.id,resourceType='offline-archive';
 if(['COMPLETED','CANCELLED'].includes(order.status)){code='VIEW_ORDER';label='查看订单归档';resourceId=order.id;resourceType='order';}
 else if(!readiness.ready){code=operator?(reviewed?'ARCHIVE_OFFLINE_DOCUMENT':pending?'REVIEW_OFFLINE_DOCUMENT':'UPLOAD_OFFLINE_DOCUMENT'):'CONTACT_OPERATIONS';label=operator?(reviewed?'归档已审核合同':pending?'审核线下文件':'上传线下文件'):'联系运营安排线下签约';resourceId=reviewed?.id||pending?.id||resourceId;}
 else if(order.status==='AWAITING_PAYMENT'&&customer&&payable){code='PAY_BILL';label='支付账单';resourceType='bill';resourceId=payable.id;}
 else if(order.status==='AWAITING_HANDOVER'||order.status==='ACTIVE'){
  const handover=(order.handovers||[]).find((h:any)=>!['DRAFT','COMPLETED','SUPERSEDED'].includes(h.status));
  if(handover){code=customer&&handover.customerResponse!=='CONFIRM'?'CONFIRM_HANDOVER':'VIEW_HANDOVER';label=code==='CONFIRM_HANDOVER'?'核对车辆查验资料':'查看车辆交接进度';resourceType='handover';resourceId=handover.id;}
  else{code=order.status==='ACTIVE'?'VIEW_SERVICES':'ARRANGE_HANDOVER';label=order.status==='ACTIVE'?'查看用车服务与权益':'联系运营安排车辆交接';resourceType='order';resourceId=order.id;}
 }else if(order.status==='SETTLING'){code='VIEW_SETTLEMENT';label=['FINANCE','ADMIN'].includes(actor.role)?'核对退款与结算':'查看还车与结算进度';resourceType='order';resourceId=order.id;}
 if(actor.role==='OWNER'){code=contracts.some(a=>a.canRead)?'VIEW_ARCHIVE':'VIEW_ORDER';label=code==='VIEW_ARCHIVE'?'查看合同资料':'查看订单';resourceType=code==='VIEW_ARCHIVE'?'offline-archive':'order';resourceId=code==='VIEW_ARCHIVE'?(contracts.find(a=>a.canRead)?.id||order.id):order.id;}
 if(order.contractMode==='ELECTRONIC'){code='OPEN_ELECTRONIC';label='查看合同与协议';resourceId=order.id;resourceType='order';}
 const canPay=order.contractMode!=='ELECTRONIC'&&readiness.ready&&!holds.payment&&!!payable&&!['COMPLETED','CANCELLED'].includes(order.status);const enabled=code!=='PAY_BILL'||canPay;
 const snapshot=order.finalPlanSnapshot||{},parties=Array.isArray(snapshot.partiesSnapshot)?snapshot.partiesSnapshot.map((p:any)=>({role:p.role,name:p.name||''})):[{role:'OWNER',name:snapshot.lessorSnapshot?.name||''},{role:'PLATFORM',name:snapshot.platformLegalEntityName||''}];
 return{orderId:order.id,mode:order.contractMode||'ESIGN',stage:order.status,stageText:order.status==='AWAITING_CONTRACT_REVIEW'?'待线下合同审核':order.status,nextAction:{code,label,resourceType,resourceId,enabled,...(!enabled?{disabledReason:'当前文件反馈须先处理'}:{})},blockers,parties,contracts,billing:visibleBills.map((b:any)=>({id:b.id,type:b.type,description:b.description||'',period:b.period??null,status:b.status,amount:b.amount,paidAmount:b.paidAmount,dueDate:b.dueDate,cancellation:b.cancellation??null,canPay:customer&&canPay&&b.canPay!==false&&b.status==='PENDING'&&Number.isSafeInteger(b.amount)&&Number.isSafeInteger(b.paidAmount)&&b.paidAmount>=0&&b.paidAmount<b.amount,...(['ADMIN','OPERATIONS','FINANCE'].includes(actor.role)&&b.publication?{publication:b.publication}:{})})),handovers:(order.handovers||[]).map((h:any)=>({id:h.id,type:h.type,confirmationMode:h.confirmationMode||'SEPARATE_DOCUMENT',status:h.status,revision:h.revision,customerResponse:h.customerResponse,completedAt:h.completedAt})),timeline:workspaceTimeline(order,archives,actor.role),responsibility:workspaceResponsibility(order,actor.role),capabilities:{canUpload:operator&&order.contractMode!=='ELECTRONIC'&&newOrderContractMode()!=='ELECTRONIC',canReview:operator&&order.contractMode!=='ELECTRONIC'&&newOrderContractMode()!=='ELECTRONIC',canReadArchive:contracts.some(a=>a.canRead),canPay:customer&&canPay,canFeedback:actor.role==='CUSTOMER'&&contracts.some(a=>a.canRead)}};
}
@Injectable()
export class OfflineWorkspaceService {
 constructor(@Inject(Db) private db:Db){}
 private async eligible(tx:any,actor:ArchiveActor){if(['ADMIN','OPERATIONS','FINANCE','SUPPORT'].includes(actor.role)){await requireCurrentStaff(tx,actor,'orders',false);}else if(actor.role==='OWNER'){ensure(actor.ownerId,404,'NOT_FOUND','合作商不存在');await requireArchivePartnerIdentity(tx,actor,actor.ownerId);}else ensure(actor.role==='CUSTOMER',403,'FORBIDDEN','无此工作区权限');}
 private where(actor:ArchiveActor){return actor.role==='CUSTOMER'?{customerId:actor.customerId||actor.id}:{};}
 async order(id:string,actor:ArchiveActor){
   if(actor.role==='OWNER')return this.db.serial(async tx=>{await this.eligible(tx,actor);return readPartnerOrderWorkspace(tx,actor.partnerSession!,actor.ownerId!,id);});
  if(['ADMIN','OPERATIONS','FINANCE','SUPPORT'].includes(actor.role))return this.db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return this.projectOrder(tx,id,actor);},{isolationLevel:'RepeatableRead',timeout:30000});
  return this.projectOrder(this.db,id,actor);
 }
 private async projectOrder(tx:any,id:string,actor:ArchiveActor){await this.eligible(tx,actor);const order=await tx.order.findFirst({where:{id,...this.where(actor)},include:{bills:{orderBy:{sequence:'asc'}},handovers:{orderBy:{createdAt:'desc'}}}});ensure(order,404,'NOT_FOUND','订单不存在');if(actor.role==='OWNER')ensure(archiveOwnerId(order)===actor.ownerId&&ownerOrderSharingValid(order,actor.ownerId!),404,'NOT_FOUND','订单不存在');if(order.effectiveTermsVersionId){const terms=await tx.orderTermsVersion.findUnique({where:{id:order.effectiveTermsVersionId}});ensure(terms&&terms.orderId===order.id&&/^[a-f0-9]{64}$/.test(terms.hash),409,'TERMS_MISSING','当前有效商业条款缺失或归属不匹配');order.currentBusinessHash=terms.hash;}
 if(order.contractMode==='OFFLINE')order.offlinePaymentReadiness=await readContractReady(tx,id,'PAYMENT');
 const [archives,receipts,tasks]=await Promise.all([
  tx.documentArchive.findMany({where:{orderId:id},include:{quote:{select:{id:true,commercialHash:true,change:{select:{orderId:true}}}},versions:{orderBy:{version:'desc'},include:{feedback:{where:{status:'OPEN'}}}}}}),
  tx.vehicleReceiptEvent.findMany({where:{orderId:id,isCurrent:true},select:{id:true,receivedAt:true}}),
  ['ADMIN','OPERATIONS'].includes(actor.role)?tx.fieldHandoverTask.findMany({where:{orderId:id,status:{notIn:['CANCELLED','COMPLETED']}},select:{id:true,status:true,assignee:{select:{name:true}}},orderBy:{updatedAt:'desc'}}):Promise.resolve([])
 ]);
 const archivedIds=archives.filter((a:any)=>a.versions.some((v:any)=>['ARCHIVED','INVALIDATED'].includes(v.status))).map((a:any)=>a.id);
 if(archivedIds.length){
  const entries=await tx.auditLog.findMany({where:{resourceType:'offline-archives',resourceId:{in:archivedIds},action:'ARCHIVE'},select:{resourceId:true,data:true,createdAt:true},orderBy:{createdAt:'asc'}});
  for(const a of archives)for(const v of a.versions){const event=entries.find((row:any)=>row.resourceId===a.id&&(row.data as any)?.versionId===v.id);if(event)(v as any).archivedAt=event.createdAt;}
 }
 order.receiptFacts=receipts;order.fieldTaskFacts=tasks;
 const lessor=order.finalPlanSnapshot?.lessorSnapshot;
 if(lessor?.ownerId&&lessor.mode!=='SIMPLE_AGREEMENT')order.cooperationFeedbackOpen=await cooperationFeedbackOpen(tx,lessor.ownerId,order.vehicleId,lessor.cooperationVersionId);
 order.bills=await withBillPeriods(tx,await Promise.all(order.bills.map(async(b:any)=>({...b,...await readRenewalBillCancellation(tx,b)}))),order);
 if(['ADMIN','OPERATIONS','FINANCE'].includes(actor.role))order.bills=await withBillPublication(tx,order.bills);
 const view=workspaceProjection(order,archives,actor);
 if(['OFFLINE','ELECTRONIC'].includes(order.contractMode)&&['ADMIN','OPERATIONS','FINANCE','SUPPORT'].includes(actor.role)){
  const process=orderProcess(await loadOrderProcessFacts(tx,order,actor));
  return{...view,stageText:({AWAITING_SIGNATURE:'待电子签署',AWAITING_CONTRACT_REVIEW:order.contractMode==='ELECTRONIC'?'待电子合同准备':'待线下合同审核',AWAITING_PAYMENT:'待支付',AWAITING_HANDOVER:'待交付',ACTIVE:'用车中',SETTLING:'结算中',COMPLETED:'已完成',CANCELLED:'已取消'} as Record<string,string>)[order.status]||view.stageText,process};
 }
 return view;}
  async workbench(raw:unknown,actor:ArchiveActor){if(actor.role==='OWNER')return this.db.serial(async tx=>{await this.eligible(tx,actor);return listPartnerOrderWorkspaces(tx,actor.partnerSession!,actor.ownerId!,raw);});const q=querySchema.parse(raw),tx:any=this.db;await this.eligible(tx,actor);const hidden=actor.role==='CUSTOMER'?await customerHiddenRecords(tx,actor.customerId||actor.id):{};const where={...this.where(actor),...(hidden.orders?.length?{id:{notIn:hidden.orders}}:{}),...(actor.role==='OWNER'?{id:{in:await sharedOwnerOrderIds(tx,actor.ownerId!)}}:{})},[orders,total]=await Promise.all([tx.order.findMany({where,orderBy:{createdAt:'desc'},skip:(q.page-1)*q.pageSize,take:q.pageSize,select:{id:true}}),tx.order.count({where})]);return{items:await Promise.all(orders.map((o:any)=>this.order(o.id,actor))),total,page:q.page,pageSize:q.pageSize};}
}


