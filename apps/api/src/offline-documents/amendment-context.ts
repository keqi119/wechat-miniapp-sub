import {hash} from '../common/data';
import {ensure} from '../common/errors';
import {AgreementFactError,assertConfirmedQuote,assertOfflineContract,offlineChangeScope} from '../order-changes/agreement-facts';
import {requireEffectiveContractChain,requireRenewalAgreementSource} from '../order-changes/agreement-readiness';
import type {AmendmentPrintContext} from './print';

/** Generate a new paper version from the customer's exact confirmed quote. */
export async function resolveAmendmentContext(tx:any,archive:any){
 ensure(archive.kind==='ORDER_AMENDMENT'&&archive.subjectType==='ORDER_CHANGE_QUOTE',400,'VALIDATION','补充协议必须关联明确报价');
 const quote=await tx.delayQuote.findUnique({where:{id:archive.subjectId},include:{contract:true}});
 ensure(quote,404,'NOT_FOUND','补充协议报价不存在');
 const change=await tx.orderChange.findUnique({where:{id:quote.changeId}}),order=change?await tx.order.findUnique({where:{id:change.orderId}}):null,contract=quote.contract;
 ensure(order?.contractMode==='OFFLINE',409,'OFFLINE_ARCHIVE_REQUIRED','仅线下模式订单可办理纸质补充协议');
 let scopeSnapshot:ReturnType<typeof offlineChangeScope>;
 try{assertConfirmedQuote(change,quote,contract,order);assertOfflineContract(contract);scopeSnapshot=offlineChangeScope(change,quote,contract);}catch(error){if(error instanceof AgreementFactError)ensure(false,409,error.code,'报价、确认正文或线下合同资料不一致');throw error;}
 ensure(change.status!=='APPLIED',409,'AMENDMENT_ALREADY_EFFECTIVE','已生效补充协议保留原版，更正须另办明确变更');
 try{await requireRenewalAgreementSource(tx,order,change,quote);}catch(error){if(error instanceof AgreementFactError)ensure(false,409,error.code,'续期前段或实际车辆分配来源已变化');throw error;}
 const chain=await requireEffectiveContractChain(tx,order.id),prior=chain.termsVersionId?(await tx.orderTermsVersion.findUnique({where:{id:chain.termsVersionId}}))?.snapshot:order.finalPlanSnapshot;
 ensure(chain.original&&chain.original.contractId===change.originalContractId&&chain.original.archiveVersionId===change.originalArchiveVersionId&&(change.priorTermsVersionId??null)===chain.termsVersionId&&prior&&hash(prior)===change.priorTermsHash&&hash(change.priorTerms)===change.priorTermsHash,409,'AGREEMENT_PRIOR_TERMS_MISMATCH','原合同或先前有效条款已变化，请重新出具报价');
 const parties=order.finalPlanSnapshot.partiesSnapshot;
 ensure(Array.isArray(parties)&&parties.length===3&&['CUSTOMER','OWNER','PLATFORM'].every(role=>parties.filter((p:any)=>p?.role===role&&typeof p.partyId==='string'&&p.partyId&&typeof p.name==='string'&&p.name.trim()).length===1)&&parties.find((p:any)=>p.role==='CUSTOMER').partyId===order.customerId,409,'PRINT_PARTIES_REQUIRED','原合同缺少完整冻结签署主体');
 const ownerId=parties.find((p:any)=>p.role==='OWNER').partyId;
 const originalArchive=await tx.documentArchive.findUnique({where:{id:chain.original.archiveId},include:{versions:{where:{id:chain.original.archiveVersionId},select:{id:true,archiveId:true,status:true,contractNumber:true}}}}),originalVersion=originalArchive?.versions?.find((v:any)=>v.id===chain.original!.archiveVersionId);
 ensure(originalArchive?.id===chain.original.archiveId&&originalArchive.orderId===order.id&&originalArchive.ownerId===ownerId&&originalArchive.kind==='RENTAL'&&originalArchive.subjectType==='ORDER'&&originalArchive.subjectId===order.id&&!originalArchive.handoverId&&!originalArchive.quoteId&&originalVersion?.archiveId===originalArchive.id&&originalVersion.status==='ARCHIVED',409,'AGREEMENT_ARCHIVE_OWNERSHIP_MISMATCH','原合同编号须来自已核验的原纸质档案版本');
 const originalContractNumber=originalVersion.contractNumber;ensure(typeof originalContractNumber==='string'&&originalContractNumber.trim()&&!originalContractNumber.includes('\0'),409,'PRINT_ORIGINAL_CONTRACT_NUMBER_REQUIRED','原纸质合同编号缺失，请核对原归档版本');
 ensure((!archive.orderId||archive.orderId===order.id)&&(!archive.ownerId||archive.ownerId===ownerId)&&(!archive.quoteId||archive.quoteId===quote.id)&&!archive.handoverId,409,'AGREEMENT_ARCHIVE_OWNERSHIP_MISMATCH','档案与本报价归属不一致');
 const document=quote.snapshot.document,rows:Array<{label:string;value:string}>=[];
 const add=(label:string,value:unknown)=>{if(typeof value==='string'&&value.trim())rows.push({label,value});};
 add('变更事项',change.kind==='DELIVERY_DELAY'?'交付延期':change.kind==='SUBSCRIPTION_EXTENSION'?'原单续期':'同出租方车辆更换');add('变更原因',quote.snapshot.reason??change.reason);
 add('原起租日',String(change.priorTerms.startDate||'').slice(0,10));add('变更后起租日',quote.snapshot.newStartDate);add(change.kind==='DELIVERY_DELAY'?'变更后到期日':'原合同到期日',quote.snapshot.newEndDate);add('旧车归还安排',quote.snapshot.plannedReturnAt);add('新车交付安排',quote.snapshot.plannedDeliveryAt);
 if(change.kind==='SUBSCRIPTION_EXTENSION'){rows.splice(2);add('续期起租日',quote.snapshot.startDate);add('续期最后用车日',quote.snapshot.newEndDate);add('生效安排','完成纸档与财务核对后，运营在续期开始日或之后显式生效；保留原期规则及实际车辆分配。');}
 const amendmentContext:AmendmentPrintContext={changeId:change.id,kind:change.kind,quoteId:quote.id,quoteRevision:quote.revision,contractId:contract.id,originalContractId:change.originalContractId,originalContractNumber,originalArchiveVersionId:change.originalArchiveVersionId,commercialHash:quote.commercialHash,body:contract.body,bodyHash:document.bodyHash,templateId:document.id,templateVersion:document.version,templateHash:document.templateHash,rows};
 return{ownerId,orderId:order.id,quoteId:quote.id,handoverId:null,customerId:order.customerId,businessSnapshotHash:quote.commercialHash,businessSnapshot:change.priorTerms,partiesSnapshot:parties,requiredSigners:['CUSTOMER','OWNER','PLATFORM'],scopeSnapshot,amendmentContext,terminationContext:undefined};
}
