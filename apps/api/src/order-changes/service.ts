import { prepareFinance,applyDelay,financeView } from './finance';
import { quote,review,publish,confirm } from './quotes';
import { Inject, Injectable } from '@nestjs/common';
import { Db } from '../common/db';
import { audit,hash } from '../common/data';
import { ensure } from '../common/errors';
import { capabilityNote,delayContext,lockOrder } from './context';
@Injectable()
export class OrderChangesService {
  constructor(@Inject(Db) readonly db:Db){}
  async context(id:string){return(await delayContext(this.db,id)).public;}
  async create(orderId:string,input:any,actor:any){return this.db.serial(async tx=>{
    const requestHash=hash(input),existing=await tx.orderChange.findUnique({where:{orderId_idempotencyKey:{orderId,idempotencyKey:input.idempotencyKey}}});
    if(existing){ensure(existing.requestHash===requestHash&&existing.createdBy===actor.id,409,'IDEMPOTENCY_CONFLICT','请求编号已用于其他变更');return this.view(tx,existing.id,actor);}
    const context=await delayContext(tx,orderId);ensure(context.public.canCreate,409,'CHANGE_BLOCKED',context.public.blockers.join('；'));
    ensure(context.order.revision===input.expectedOrderRevision&&context.public.priorTermsHash===input.priorTermsHash,409,'VERSION_CONFLICT','订单服务条款已更新，请刷新');
    await lockOrder(tx,orderId);
    const item=await tx.orderChange.create({data:{orderId,customerId:context.order.customerId,priorTermsHash:context.public.priorTermsHash,priorTerms:context.terms,originalContractId:context.contract!.id,reason:input.reason,createdBy:actor.id,idempotencyKey:input.idempotencyKey,requestHash}});
    await audit(tx,actor.id,'DELIVERY_DELAY_CREATE','order-changes',item.id,{reason:input.reason});return this.view(tx,item.id,actor);
  });}
  async act(id:string,action:string,input:any,actor?:any,customerId?:string){return this.db.serial(async tx=>{
    const change=await tx.orderChange.findFirst({where:{id,...(customerId?{customerId}:{})}});ensure(change,404,'NOT_FOUND','订单变更不存在');
    await lockOrder(tx,change.orderId);
    const actorId=actor?.id||customerId!,requestHash=hash(input),actionKey='DELAY_'+action+'_'+input.idempotencyKey;
    const previous=await tx.auditLog.findFirst({where:{resourceType:'order-changes',resourceId:id,action:actionKey,actorId}});
    if(previous){ensure((previous.data as any).requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','请求编号已用于其他内容');return this.view(tx,id,actor,customerId);}
    ensure(change.revision===input.revision,409,'VERSION_CONFLICT','变更已更新，请刷新');
    if(action==='quotes')await quote(tx,change,input,actor);
    else if(action==='review')await review(tx,change,input,actor);
    else if(action==='publish')await publish(tx,change);
    else if(action==='confirm')await confirm(tx,change,input);
    else if(action==='prepare-finance')await prepareFinance(tx,change,actor);
    else if(action==='apply')await applyDelay(tx,change);
    else if(['cancel','reject'].includes(action)){ensure(action==='reject'?change.status==='AWAITING_CONFIRMATION':['DRAFT','REVIEW_PENDING','REVIEWED','AWAITING_CONFIRMATION'].includes(change.status),409,'CHANGE_STATE','已经确认或签署的变更不可取消');await tx.orderChange.update({where:{id},data:{status:action==='reject'?'REJECTED':'CANCELLED'}});}
    else ensure(false,400,'ACTION_UNSUPPORTED','当前动作不可用');
    await tx.orderChange.update({where:{id},data:{revision:{increment:1}}});
    await audit(tx,actorId,actionKey,'order-changes',id,{requestHash,...(input.reason?{reason:input.reason}:{})},actor?'ADMIN':'CUSTOMER');return this.view(tx,id,actor,customerId);
  });}
  async summary(item:any,customerId?:string){const q=item.activeQuoteId?await this.db.delayQuote.findUnique({where:{id:item.activeQuoteId}}):null,visible=q&&(!customerId||['PUBLISHED','CONFIRMED'].includes(q.status));const s=q?.snapshot as any;return{id:item.id,orderId:item.orderId,kind:item.kind,status:item.status,revision:item.revision,reason:item.reason,createdAt:item.createdAt,quoteSummary:visible?{id:q.id,revision:q.revision,newStartDate:s.newStartDate,newEndDate:s.newEndDate,months:s.months,commercialHash:q.commercialHash,expiresAt:s.expiresAt}:null};}
  async view(tx:any,id:string,actor?:any,customerId?:string){
    const item=await tx.orderChange.findFirst({where:{id,...(customerId?{customerId}:{})},include:{quotes:{orderBy:{revision:'desc'},include:{contract:true}}}});ensure(item,404,'NOT_FOUND','订单变更不存在');
    const active=item.quotes.find((q:any)=>q.id===item.activeQuoteId), q=active&&(!customerId||!['DRAFT','REVIEWED','REJECTED'].includes(active.status))?active:null;
    const operations=actor&&['ADMIN','OPERATIONS'].includes(actor.role),finance=actor&&['ADMIN','FINANCE'].includes(actor.role);
    const quoteValid=!!q?.snapshot.expiresAt&&new Date(q.snapshot.expiresAt)>new Date();
    const expiredPublished=active?.status==='PUBLISHED'&&new Date(active.snapshot.expiresAt)<=new Date();
    const financial=await financeView(tx,item);
    const snapshot=q?{...q.snapshot,document:q.snapshot.document?{...q.snapshot.document,...(!customerId&&!operations?{content:undefined}:{})}:null}:null;
    return{id:item.id,orderId:item.orderId,customerId:item.customerId,kind:item.kind,status:item.status,revision:item.revision,reason:item.reason,createdAt:item.createdAt,
      quote:q?{id:q.id,revision:q.revision,commercialHash:q.commercialHash,...snapshot,createdBy:q.createdBy,reviewedBy:q.reviewedBy,reviewNote:q.reviewNote,confirmedAt:q.confirmedAt}:null,
      history:item.quotes.filter((v:any)=>!customerId||['PUBLISHED','CONFIRMED','SUPERSEDED'].includes(v.status)).map((v:any)=>({id:v.id,revision:v.revision,status:v.status,commercialHash:v.commercialHash})),
      contract:q?.contract?{id:q.contract.id,kind:'AMENDMENT',status:q.contract.status,sourceFileId:customerId||operations?q.contract.sourceFileId:undefined,signedFileId:customerId||operations?q.contract.signedFileId:undefined}:null,
      finance:financial,canQuote:!!operations&&(['DRAFT','REVIEW_PENDING','REVIEWED'].includes(item.status)||(item.status==='AWAITING_CONFIRMATION'&&expiredPublished)||(item.status==='AWAITING_SIGNATURE'&&(['REJECTED','EXPIRED'].includes(active?.contract?.status)||(active?.contract?.status==='DRAFT'&&!active.contract.providerTaskId&&!active.contract.signingLeaseUntil)))),canReview:!!finance&&item.status==='REVIEW_PENDING'&&active?.createdBy!==actor.id,canPublish:!!operations&&item.status==='REVIEWED'&&quoteValid,canPrepareSignature:!!operations&&item.status==='AWAITING_SIGNATURE'&&q?.contract?.status==='DRAFT',canPrepareFinance:!!finance&&item.status==='AWAITING_FINANCE'&&(!q?.financePreparedAt||financial.canRetryRefund),canApply:!!operations&&item.status==='AWAITING_FINANCE'&&financial.blockers.length===0,canCancel:!!operations&&['DRAFT','REVIEW_PENDING','REVIEWED','AWAITING_CONFIRMATION'].includes(item.status),canConfirm:!!customerId&&item.status==='AWAITING_CONFIRMATION'&&quoteValid&&!!q?.snapshot.document,canReject:!!customerId&&item.status==='AWAITING_CONFIRMATION',canSign:!!customerId&&item.status==='AWAITING_SIGNATURE'&&!!q?.snapshot.document&&['DRAFT','PENDING'].includes(q?.contract?.status),canSync:!!customerId&&!!q?.contract&&['AWAITING_SIGNATURE','AWAITING_FINANCE'].includes(item.status),blockers:[],capabilityNote};
  }
}
