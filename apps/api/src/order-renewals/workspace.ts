import {electronicTaskFacts} from '../electronic-documents/repository';
import {nextSigningAction} from '../electronic-documents/policy';
import {assertElectronicRenewalCommercial} from './electronic-agreement';
import {readRenewalCancellationSummary} from './cancellation-view';
import {HttpException} from '@nestjs/common';
import {z} from 'zod';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {readChangeAgreementReady} from '../order-changes/agreement-readiness';
import {assertRenewalAgreementQuote} from '../order-changes/renewal-agreement';
import {shanghaiDay} from '../usage/rules';
import {assertRenewalQuote,renewalId} from './types';
import {publicRenewalPreview} from './context';
import {readPreparedRenewalSource} from './source';

type Viewer={actor?:any;customerId?:string};
const states=['DRAFT','REVIEW_PENDING','REVIEWED','AWAITING_CONFIRMATION','AWAITING_ARCHIVE','AWAITING_SIGNATURE','AWAITING_FINANCE','SCHEDULED','APPLIED','CANCELLED','REJECTED'] as const;
const queryInput=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(12),orderId:renewalId.optional(),keyword:z.string().trim().max(100).refine(v=>!v.includes('\0')).default(''),status:z.enum(states).optional()}).strict();
async function permission(tx:any,viewer:Viewer){
 ensure(!!viewer.actor!==!!viewer.customerId,403,'FORBIDDEN','须使用单一当前身份读取续期');
 if(viewer.actor){const current=await requireCurrentStaff(tx,viewer.actor,'order-changes',false);ensure(['ADMIN','OPERATIONS','FINANCE'].includes(current.role),403,'FORBIDDEN','当前岗位不可读取续期办理');return current;}
 renewalId.parse(viewer.customerId);ensure(await tx.customer.findUnique({where:{id:viewer.customerId}}),403,'UNAUTHORIZED','请重新登录');return null;
}
function sourceCode(error:unknown){if(error instanceof HttpException&&[400,404,409].includes(error.getStatus()))return (error.getResponse() as any)?.error?.code||'RENEWAL_SOURCE_REVIEW_REQUIRED';throw error;}
function visibleQuote(change:any,q:any,order:any,viewer:Viewer,blockers:Set<string>){
 if(!q)return null;
 if(viewer.customerId&&!['PUBLISHED','CONFIRMED'].includes(q.status))return null;
 try{const s=assertRenewalQuote(change,q);if(['PUBLISHED','CONFIRMED'].includes(q.status)){if(order.contractMode==='ELECTRONIC')assertElectronicRenewalCommercial(change,q);else assertRenewalAgreementQuote(change,q,q.contract,order,q.status==='CONFIRMED'||q.confirmedAt!=null);}return s;}
 catch(error){blockers.add(sourceCode(error));return null;}
}
const documentView=(d:any,body:boolean)=>d?{id:d.id,type:d.type,version:d.version,templateHash:d.templateHash,bodyHash:d.bodyHash,...(body?{content:d.content}:{})}:null;

/** Current authority and customer ownership are checked before any quote, document or stage projection. No writes. */
export async function readRenewalWorkspace(tx:any,id:string,viewer:Viewer,now:Date){
 const actor=await permission(tx,viewer),change=await tx.orderChange.findUnique({where:{id:renewalId.parse(id)}});
 ensure(change?.kind==='SUBSCRIPTION_EXTENSION'&&(!viewer.customerId||change.customerId===viewer.customerId),404,'NOT_FOUND','续期变更不存在');
 const order=await tx.order.findUnique({where:{id:change.orderId}});ensure(order?.customerId===change.customerId,404,'NOT_FOUND','续期订单来源不存在');
 const quotes=await tx.delayQuote.findMany({where:{changeId:id},orderBy:{revision:'desc'},include:{contract:true}}),q=quotes.find((row:any)=>row.id===change.activeQuoteId),blockers=new Set<string>();
 if(change.activeQuoteId&&!q)blockers.add('RENEWAL_QUOTE_MISSING');
 const operations=!!actor&&['ADMIN','OPERATIONS'].includes(actor.role),finance=!!actor&&['ADMIN','FINANCE'].includes(actor.role),s=visibleQuote(change,q,order,viewer,blockers),valid=!!s&&new Date(s.expiresAt).getTime()>now.getTime();
 let agreement:any=null,stage:any=null,stageValid=false;
 if(s&&q.status==='CONFIRMED'&&!['CANCELLED','REJECTED'].includes(change.status)){try{agreement=await readChangeAgreementReady(tx,change.id);}catch(error){if(order.contractMode!=='ELECTRONIC')throw error;agreement={ready:false,blockers:[sourceCode(error)]};}for(const blocker of agreement.blockers)blockers.add(blocker);}
 const row=await tx.orderServiceStage.findFirst({where:{changeId:change.id,orderId:order.id,customerId:order.customerId}});
 if(row)try{const source=await readPreparedRenewalSource(tx,row.id);ensure(source.change.id===change.id&&source.order.id===order.id,409,'RENEWAL_STAGE_SOURCE','续期服务期归属不一致');const r=source.stage;stage={id:r.id,status:r.status,revision:r.revision,startDate:source.snapshot.period.startDate,endDate:source.snapshot.period.endDate,firstPeriodSequence:source.snapshot.period.firstPeriodSequence,lastPeriodSequence:source.snapshot.period.lastPeriodSequence,scheduledAt:r.scheduledAt??null,activatedAt:r.activatedAt??null};stageValid=true;}catch(error){blockers.add(sourceCode(error));}
 const electronicTask=order.contractMode==='ELECTRONIC'&&q?.contract?await tx.electronicSigningTask.findUnique({where:{contractId:q.contract.id},include:{parties:true}}):null;
 const electronicDocument=electronicTask?{id:electronicTask.id,archiveVersionId:electronicTask.archiveVersionId,status:electronicTask.status,sourceFileId:electronicTask.sourceFileId,sourceSha256:electronicTask.sourceSha256,legalSigningStatus:electronicTask.parties.every((p:any)=>p.status==='SIGNED'&&p.providerSignedAt&&p.verifiedAt)?'SIGNED':'PENDING',filingStatus:electronicTask.filingStatus}:null;
 const signingAction=electronicTask&&!electronicTask.retiredAt&&!electronicTask.withdrawnAt?nextSigningAction(electronicTaskFacts(electronicTask),now):null;
 const cancellation=await readRenewalCancellationSummary(tx,change,order,now),clean=blockers.size===0&&!cancellation,canQuoteState=['DRAFT','REVIEW_PENDING','REVIEWED'].includes(change.status)||change.status==='AWAITING_CONFIRMATION'&&q?.status==='PUBLISHED'&&!!s&&!valid,customer=!!viewer.customerId;
 return{executionMode:order.contractMode,id:change.id,orderId:change.orderId,kind:change.kind,status:change.status,revision:change.revision,reason:change.reason,createdAt:change.createdAt,
  quote:s?{id:q.id,revision:q.revision,status:q.status,commercialHash:q.commercialHash,...publicRenewalPreview(s,s.previewHash),productName:s.product.name,expiresAt:s.expiresAt,reason:s.input.reason,settlementExplanation:s.input.settlementExplanation,cancellationTerms:s.input.cancellationTerms,document:documentView(s.document,customer||operations),...(actor?{createdBy:q.createdBy,reviewedBy:q.reviewedBy??null,reviewNote:q.reviewNote??null}:{}),confirmedAt:q.confirmedAt??null}:null,
  contract:s&&q.contract?{id:q.contract.id,kind:q.contract.kind,executionMode:q.contract.executionMode,status:q.contract.status,delayQuoteId:q.contract.delayQuoteId,offlineArchiveId:q.contract.offlineArchiveId??null}:null,
  electronicDocument,canPrepareElectronic:operations&&!!s&&!cancellation&&order.status==='ACTIVE'&&order.contractMode==='ELECTRONIC'&&change.status==='AWAITING_SIGNATURE'&&!electronicTask,
  cancellation,history:quotes.filter((r:any)=>!customer||['PUBLISHED','CONFIRMED','SUPERSEDED'].includes(r.status)).map((r:any)=>({id:r.id,revision:r.revision,status:r.status,commercialHash:r.commercialHash})),stage,blockers:[...blockers],
  canQuote:operations&&clean&&canQuoteState,canReview:finance&&clean&&!!s&&change.status==='REVIEW_PENDING'&&q.status==='DRAFT'&&q.createdBy!==actor?.id,canPublish:operations&&clean&&valid&&change.status==='REVIEWED'&&q.status==='REVIEWED',canCancel:operations&&!cancellation&&['DRAFT','REVIEW_PENDING','REVIEWED','AWAITING_CONFIRMATION'].includes(change.status)&&!q?.confirmedAt&&!q?.financePreparedAt,
  canPrepareFinance:finance&&clean&&change.status==='AWAITING_FINANCE'&&agreement?.ready===true&&!row&&!q?.financePreparedAt,canSchedule:finance&&clean&&stageValid&&stage.status==='PREPARED'&&change.status==='AWAITING_FINANCE',canActivate:operations&&clean&&stageValid&&stage.status==='SCHEDULED'&&change.status==='SCHEDULED'&&stage.startDate<=shanghaiDay(now)&&shanghaiDay(now)<stage.endDate,
  canConfirm:customer&&clean&&valid&&change.status==='AWAITING_CONFIRMATION'&&q.status==='PUBLISHED'&&!!s.document,canReject:customer&&!cancellation&&change.status==='AWAITING_CONFIRMATION',canSign:customer&&!cancellation&&signingAction?.kind==='SIGN'&&signingAction.role==='CUSTOMER'&&signingAction.mode==='MANUAL',canSync:!!electronicTask&&!cancellation&&!electronicTask.retiredAt&&!electronicTask.withdrawnAt&&electronicTask.status!=='ARCHIVED'};
}

export async function listRenewalWorkspaces(tx:any,raw:unknown,viewer:Viewer,now:Date){
 await permission(tx,viewer);const q=queryInput.parse(raw),where={kind:'SUBSCRIPTION_EXTENSION',...(viewer.customerId?{customerId:viewer.customerId}:{}),...(q.orderId?{orderId:q.orderId}:{}),...(q.status?{status:q.status}:{}),...(q.keyword?{id:{contains:q.keyword}}:{})};
 const [rows,total]=await Promise.all([tx.orderChange.findMany({where,skip:(q.page-1)*q.pageSize,take:q.pageSize,orderBy:[{createdAt:'desc'},{id:'desc'}]}),tx.orderChange.count({where})]);
 const items=await Promise.all(rows.map(async(c:any)=>{
  ensure(c.kind==='SUBSCRIPTION_EXTENSION'&&(!viewer.customerId||c.customerId===viewer.customerId),404,'NOT_FOUND','续期归属不一致');
  const quote=c.activeQuoteId?await tx.delayQuote.findUnique({where:{id:c.activeQuoteId},include:{contract:true}}):null,order=await tx.order.findUnique({where:{id:c.orderId}}),blockers=new Set<string>(),s=visibleQuote(c,quote,order,viewer,blockers);
  const cancellation=await readRenewalCancellationSummary(tx,c,order,now);
  return{executionMode:order.contractMode,cancellation,id:c.id,orderId:c.orderId,kind:c.kind,status:c.status,revision:c.revision,reason:c.reason,createdAt:c.createdAt,blockers:[...blockers],quoteSummary:s?{id:quote.id,revision:quote.revision,newStartDate:s.startDate,newEndDate:s.newEndDate,months:s.months,monthlyFeeAmount:s.monthlyFeeAmount,depositAmount:s.depositAmount,productName:s.product.name,commercialHash:quote.commercialHash,expiresAt:s.expiresAt,confirmationExpired:quote.status==='PUBLISHED'&&new Date(s.expiresAt).getTime()<=now.getTime()}:null};
 }));return{items,total,page:q.page,pageSize:q.pageSize};
}
