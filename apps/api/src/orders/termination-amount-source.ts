import {exitResponses} from './exit-amount-responses';
import {canonicalHash} from '../customers/types';
import {ensure} from '../common/errors';
import {serviceBillSequences} from '../order-changes/obligations';
import {terminationAmounts} from './termination-source';
export async function exitAmountSource(tx:any,source:any,s:any,custody:any,money:any){
 const effective=s?.facts.find((f:any)=>f.kind==='EFFECTIVE'),pin=source.pin,originalEndAt=pin.scope==='ACTUAL_SERVICE'?new Date(pin.periods.at(-1).endDate+'T00:00:00+08:00'):null;
 const normalExpiry=!!custody&&!!originalEndAt&&custody.receivedAt>=originalEndAt;
 if(!effective&&!normalExpiry||pin.scope==='ACTUAL_SERVICE'&&!custody)return null;
 if(effective)ensure(s.record.sourceHash===source.sourceHash,409,'TERMINATION_SOURCE_CHANGED');
 const claim=await tx.orderOccupancyClaim.findFirst({where:{orderId:pin.orderId,status:'VERIFIED'},orderBy:{createdAt:'desc'}});if(claim)ensure(canonicalHash(claim.source)===claim.sourceHash&&claim.source.receiptId===custody?.id&&claim.source.receiptHash===custody?.hash&&claim.source.sourceHash===source.sourceHash,409,'OCCUPANCY_SOURCE_CHANGED');const occupancyClaim=claim?{id:claim.id,sourceHash:claim.sourceHash,responsibility:claim.responsibility,amount:claim.source.amount,disputedAmount:claim.source.disputedAmount,from:claim.source.from,until:claim.source.until,basis:claim.source.basis,evidence:claim.source.evidence,reviewedAt:claim.reviewedAt?.toISOString(),rule:claim.source.rule}:null;
 const paymentReferences=money.payments.map(({refunds,refundedAmount,...p}:any)=>p),binding={occupancyClaimHash:claim?.sourceHash??null,sourceHash:source.sourceHash,terminationId:s?.record.id??null,effectiveFactId:effective?.id??null,effectiveFactHash:effective?.factHash??null,normalExpiry,receipt:custody?{kind:custody.kind,id:custody.id,hash:custody.hash,receivedAt:custody.receivedAt.toISOString()}:null,paymentsHash:canonicalHash(paymentReferences)},bindingHash=canonicalHash(binding);
 const response=await exitResponses(tx,pin.orderId,bindingHash),previous=response.first;
 if(previous)return{...previous.source,hash:previous.sourceHash,confirmation:{id:previous.id,confirmedAt:previous.confirmedAt,sourceHash:previous.sourceHash},responses:response.view};
 const seq=await serviceBillSequences(tx,pin.orderId),amounts=pin.scope==='ACTUAL_SERVICE'?terminationAmounts(pin,custody.receivedAt,s?.record.proposal.reasonKind??'NO_FAULT',s?.record.proposal.earlierAgreement?.stopAt):{fullOriginalRefundAmount:money.receivedAmount-money.refundedAmount,compensationAmount:0};
 const statement={version:1,occupancyClaim,orderId:pin.orderId,customerId:pin.customerId,binding,bindingHash,scenario:pin.scope==='NEVER_DELIVERED'?'ORIGINAL_CANCELLATION':'ACTUAL_RETURN',terminationId:s?.record.id??null,legalBasis:s?.record.kind??'NORMAL_EXPIRY',effectiveAt:effective?.occurredAt.toISOString()??originalEndAt?.toISOString(),actualReceiptAt:custody?.receivedAt.toISOString()??null,amounts,depositBalanceAmount:money.payments.filter((p:any)=>['DEPOSIT','DEPOSIT_ADJUSTMENT'].includes(p.billType)).reduce((n:number,p:any)=>n+p.amount-p.refundedAmount,0),paymentReferences,financialObservation:{payments:money.payments,sourceHash:money.hash},periods:(pin.periods??[]).map((p:any)=>({...p,paymentIds:money.payments.filter((r:any)=>seq.get(r.billId)===p.sequence).map((r:any)=>r.paymentId)})),refundExecutionAuthority:'EXISTING_LEDGER_TASK9',separateClaims:true};
 return{...statement,hash:canonicalHash(statement),confirmation:null,responses:response.view};
}

/** Task9c replaces this handoff only with checked obligations, cash and dispositions. */
export async function exitFinancialGate(tx:any,order:any){
 const {terminationSource,terminationCustody}=await import('./termination-source'),{readTermination}=await import('./termination'),{cancellation04Money}=await import('./cancellation04-source');
 const source=await terminationSource(tx,order.id),row=await tx.orderTermination.findFirst({where:{orderId:order.id},orderBy:{version:'desc'}}),s=row?await readTermination(tx,row.id):null,custody=await terminationCustody(tx,order),statement=await exitAmountSource(tx,source,s,custody,await cancellation04Money(tx,order.id));
 const {refundObligationReadiness}=await import('../billing/refund-obligations');
 const refundObligations=await refundObligationReadiness(tx,order.id);
 return{refundObligations,sourceHash:statement?.hash??null,amountConfirmation:statement?.confirmation??null,ready:false,blockers:[...(!statement?['EXIT_AMOUNT_SOURCE_REQUIRED']:!statement.confirmation?['EXIT_AMOUNT_CONFIRMATION_REQUIRED']:[]),'EXIT_FINANCE_SOURCE_REVIEW_REQUIRED']};
}
