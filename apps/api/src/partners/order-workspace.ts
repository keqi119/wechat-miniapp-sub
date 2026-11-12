import {sharedElectronicOrderArchive} from './electronic-portal';
import {readRenewalCancellationSummary} from '../order-renewals/cancellation-view';
import {HttpException} from '@nestjs/common';
import {z} from 'zod';
import {ensure} from '../common/errors';
import {requirePartnerReadAccess,type PartnerPortalSession} from './portal-session';
import {ownerOrderSharingValid,sharedOwnerOrderIds} from '../offline-documents/partner-access';
import {readEffectiveContractChain,readChangeAgreementReady} from '../order-changes/agreement-readiness';
import {AgreementFactError,assertConfirmedQuote,assertHistoricalPreparedQuote} from '../order-changes/agreement-facts';
import {assertRenewalAgreementQuote} from '../order-changes/renewal-agreement';
import {readPreparedRenewalSource} from '../order-renewals/source';
import {readServiceStage} from '../order-service-stages/readiness';
import {stagePeriods,stageDay} from '../order-service-stages/source';
import {freezeUsagePricing} from '../usage/pricing';
import {freezeSwapPolicy} from '../swap-purchases/policy';
import {shanghaiDay} from '../usage/rules';
import {assertNotAssetFiles} from '../files/asset-files';

const id=z.string().min(1).max(500).refine(v=>v.trim()===v&&!v.includes('\0'));
const query=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).strict();
const cents=(v:any)=>Number.isInteger(v)&&v>=0&&v<=2147483647?v:null;
const text=(v:any)=>typeof v==='string'?v:'';
function sourceError(error:unknown):string{
 if(error instanceof AgreementFactError)return error.code;
 if(error instanceof HttpException&&[400,404,409].includes(error.getStatus()))return (error.getResponse() as any)?.error?.code||'PARTNER_ORDER_SOURCE';
 throw error;
}
function summary(terms:any,period:{startDate:string;endDate:string;months:number},pricing:any,swap:any){
 return{startDate:period.startDate,endDate:period.endDate,months:period.months,monthlyFeeAmount:cents(terms.monthlyFeeAmount),depositAmount:cents(terms.depositAmount),productName:text((terms.currentVehicleProductSnapshot??terms.productSnapshot)?.name),baseAllowanceKm:cents(pricing.baseAllowanceKm),excessPriceAmount:cents(pricing.excessPriceAmount),includedSwapCount:swap?.policyVersion==='SWAP_TERM_V2'?cents(swap.includedCount):null};
}
/** No body, metadata, source file or private review payload is returned. File routes recheck grants. */
async function archiveRef(tx:any,order:any,ownerId:string,contract:any,q?:any){
 if(contract?.executionMode==='ELECTRONIC')return sharedElectronicOrderArchive(tx,order,ownerId,contract);
 if(!contract?.offlineArchiveId)return null;
 const a=await tx.documentArchive.findUnique({where:{id:contract.offlineArchiveId},include:{versions:{include:{files:{include:{file:true}}}}}});
 if(!a||a.ownerId!==ownerId||a.orderId!==order.id||a.handoverId||(q?(a.kind!=='ORDER_AMENDMENT'||a.quoteId!==q.id||a.subjectType!=='ORDER_CHANGE_QUOTE'||a.subjectId!==q.id):(a.kind!=='RENTAL'||a.subjectType!=='ORDER'||a.subjectId!==order.id)))return null;
 const businessHash=q?.commercialHash??order.finalPlanSnapshot.commercialHash;
 const versions=(a.versions||[]).filter((v:any)=>v.archiveId===a.id&&['ARCHIVED','INVALIDATED'].includes(v.status)&&v.businessSnapshotHash===businessHash&&(!q||v.templateId===q.snapshot.document.id&&v.templateVersion===q.snapshot.document.version));
 if(!versions.length)return null;
 await assertNotAssetFiles(tx,versions.flatMap((v:any)=>[v.sourceFileId,...(v.files||[]).map((f:any)=>f.fileId)]).filter(Boolean));
 return{id:a.id,kind:a.kind,currentApprovedVersionId:versions.some((v:any)=>v.id===a.currentApprovedVersionId)?a.currentApprovedVersionId:null,versions:versions.map((v:any)=>({id:v.id,version:v.version,status:v.status,contractNumber:text(v.contractNumber),signedOn:v.signedOn?stageDay(v.signedOn):null})),canRead:true};
}

/** Independent partner authority; never impersonates customer/staff or initializes an INITIAL stage. */
export async function readPartnerOrderWorkspace(tx:any,session:PartnerPortalSession,ownerId:string,orderId:string,now=new Date()){
 const grant=await requirePartnerReadAccess(tx,session,id.parse(ownerId)),order=await tx.order.findUnique({where:{id:id.parse(orderId)}});
 ensure(order&&ownerOrderSharingValid(order,ownerId),404,'NOT_FOUND','订单不存在');
 const blockers=new Set<string>(),today=shanghaiDay(now),initial=order.finalPlanSnapshot;
 const [contracts,changes,stages]=await Promise.all([tx.contract.findMany({where:{orderId,customerId:order.customerId},orderBy:{createdAt:'asc'}}),tx.orderChange.findMany({where:{orderId,customerId:order.customerId},orderBy:[{createdAt:'desc'},{id:'desc'}]}),tx.orderServiceStage.findMany({where:{orderId,customerId:order.customerId},orderBy:{sequence:'asc'}})]);
 const original=contracts.find((c:any)=>['SUBSCRIPTION','RENTAL'].includes(c.kind)&&c.orderId===orderId&&c.customerId===order.customerId&&!c.delayQuoteId),originalArchive=original?await archiveRef(tx,order,ownerId,original):null;
 let currentPeriod:any=null,vehicle:any=null;
 const chain=['OFFLINE','ELECTRONIC'].includes(order.contractMode)?await readEffectiveContractChain(tx,orderId):null;
 if(chain&&!chain.ready)chain.blockers.forEach(b=>blockers.add(b));
 const originalPin=chain?.ready?chain.original:null;
 const originalContractNumber=originalPin&&originalArchive&&originalPin.contractId===original?.id&&originalPin.archiveId===originalArchive.id?text(originalArchive.versions.find((v:any)=>v.id===originalPin.archiveVersionId)?.contractNumber):'';
 if(chain?.ready&&order.status==='ACTIVE')try{
  let terms=initial;if(chain.termsVersionId){const t=await tx.orderTermsVersion.findUnique({where:{id:chain.termsVersionId}});ensure(t?.orderId===orderId&&t.hash===chain.termsHash&&t.snapshot?.commercialHash===t.hash,409,'PARTNER_ORDER_SOURCE','有效条款来源不完整');terms=t.snapshot;}
  const assignment=order.currentAssignmentId?await tx.vehicleAssignment.findUnique({where:{id:order.currentAssignmentId}}):null;
  const vehicleId=terms.lessorSnapshot?.vehicleId;
  ensure(terms.lessorSnapshot?.ownerId===ownerId&&assignment?.orderId===orderId&&assignment.customerId===order.customerId&&assignment.status==='ACTIVE'&&!assignment.endAt&&assignment.vehicleId===vehicleId&&(terms.vehicleId==null||terms.vehicleId===vehicleId),409,'PARTNER_ORDER_SOURCE','当前车辆来源待核对');
  const car=await tx.vehicle.findUnique({where:{id:vehicleId}});ensure(car?.id===vehicleId,409,'PARTNER_ORDER_SOURCE','当前车辆来源待核对');vehicle={id:car.id,title:text(car.title),plateNumber:text(car.plateNumber)};
  const live=stages.filter((s:any)=>s.orderId===orderId&&s.customerId===order.customerId&&s.status==='ACTIVE'&&stageDay(s.startDate)<=today&&today<stageDay(s.endDate));
  ensure(live.length<=1,409,'SERVICE_STAGE_SOURCE','当前租期来源冲突');
  if(live.length){const r=await readServiceStage(tx,order,live[0].id);if(r.snapshot.kind==='RENEWAL')await readPreparedRenewalSource(tx,r.stage.id);currentPeriod={serviceStageId:r.stage.id,...summary(terms,r.snapshot.period,r.snapshot.usagePricing,r.snapshot.swapPolicy)};}
  else if(!stages.length&&order.contractMode==='OFFLINE'){const schedule=stagePeriods(terms.startDate,terms.months,1,terms.monthlyFeeAmount),period={startDate:schedule[0].startDate,endDate:schedule.at(-1)!.endDate,months:terms.months};if(period.startDate<=today&&today<period.endDate)currentPeriod={serviceStageId:null,...summary(terms,period,freezeUsagePricing(initial),freezeSwapPolicy(order))};}
 }catch(error){blockers.add(sourceError(error));}
 const futureRenewals:any[]=[],cancelledRenewals:any[]=[],amendments:any[]=[];
 for(const change of changes){
  if(change.orderId!==orderId||change.customerId!==order.customerId)continue;
  const cancellation=change.kind==='SUBSCRIPTION_EXTENSION'?await readRenewalCancellationSummary(tx,change,order,now):null;
  const quotes=await tx.delayQuote.findMany({where:{changeId:change.id},orderBy:{revision:'desc'},include:{contract:true}});
  if(change.activeQuoteId&&!quotes.some((q:any)=>q.id===change.activeQuoteId))blockers.add('PARTNER_QUOTE_SOURCE');
  for(const q of quotes){
   if(!q.confirmedAt||!['CONFIRMED','SUPERSEDED'].includes(q.status))continue;
   try{
    const contract=q.contract??contracts.find((c:any)=>c.delayQuoteId===q.id);
    if(q.financePreparedAt)assertHistoricalPreparedQuote(change,q,contract,order);else assertConfirmedQuote(change,q,contract,order);
    const renewal=change.kind==='SUBSCRIPTION_EXTENSION',s=renewal?assertRenewalAgreementQuote(change,q,contract,order):null;
    if(s)ensure(s.source.ownerId===ownerId,404,'NOT_FOUND','续期来源不存在');
    const archive=await archiveRef(tx,order,ownerId,contract,q);
    if(archive)amendments.push({changeId:change.id,kind:change.kind,quoteId:q.id,contractId:contract.id,status:change.status,confirmedAt:new Date(q.confirmedAt).toISOString(),archive});
    if(s&&cancellation?.status==='COMPLETED'&&change.activeQuoteId===q.id){const stage=stages.find((row:any)=>row.changeId===change.id||row.quoteId===q.id);cancelledRenewals.push({changeId:change.id,quoteId:q.id,contractId:contract.id,serviceStageId:stage?.id??null,status:'CANCELLED',cancellation,...summary(s.renewalTerms,{startDate:s.startDate,endDate:s.endDate,months:s.months},s.usagePricing,s.swapPolicy),confirmedAt:new Date(q.confirmedAt).toISOString(),archive});continue;}
    if(!s||change.activeQuoteId!==q.id||q.status!=='CONFIRMED'||!['AWAITING_ARCHIVE','AWAITING_FINANCE','SCHEDULED'].includes(change.status))continue;
    const stage=stages.find((row:any)=>row.changeId===change.id||row.quoteId===q.id);let validArchive=archive;
    if(stage){const source=await readPreparedRenewalSource(tx,stage.id);ensure(source.order.id===orderId&&source.change.id===change.id&&source.quote.id===q.id&&source.snapshot.identity.ownerId===ownerId&&['PREPARED','SCHEDULED'].includes(source.stage.status),409,'PARTNER_ORDER_SOURCE','未来续期来源待核对');}
    else{const ready=await readChangeAgreementReady(tx,change.id);if(!ready.ready)validArchive=null;}
    futureRenewals.push({cancellation,changeId:change.id,quoteId:q.id,contractId:contract.id,serviceStageId:stage?.id??null,status:stage?.status??change.status,...summary(s.renewalTerms,{startDate:s.startDate,endDate:s.endDate,months:s.months},s.usagePricing,s.swapPolicy),confirmedAt:new Date(q.confirmedAt).toISOString(),archive:validArchive});
   }catch(error){blockers.add(sourceError(error));}
  }
 }
 return{ownerId,accessVersion:grant.accessVersion,orderId,orderStatus:order.status,vehicle,originalContract:original?{id:original.id,executionMode:original.executionMode,contractNumber:originalContractNumber,archive:originalArchive}:null,currentPeriod,futureRenewals,cancelledRenewals,amendments,blockers:[...blockers],readOnly:true as const};
}

export async function listPartnerOrderWorkspaces(tx:any,session:PartnerPortalSession,ownerId:string,raw:unknown={},now=new Date()){
 await requirePartnerReadAccess(tx,session,id.parse(ownerId));const q=query.parse(raw),shared=await sharedOwnerOrderIds(tx,ownerId),where={id:{in:shared}};
 const [rows,total]=await Promise.all([tx.order.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize,select:{id:true}}),tx.order.count({where})]);
 return{items:await Promise.all(rows.map((r:any)=>readPartnerOrderWorkspace(tx,session,ownerId,r.id,now))),total,page:q.page,pageSize:q.pageSize};
}
