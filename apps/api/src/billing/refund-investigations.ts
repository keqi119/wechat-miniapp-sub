import {z} from 'zod';
import {ensure} from '../common/errors';
import {audit,key} from '../common/data';
import {canonicalHash} from '../customers/types';
import {archiveCommand} from '../offline-documents/command';
import {lockOrder} from '../offline-documents/readiness';
import {assertIndependentStaffReview} from '../partners/capabilities';
import {assertNotAssetFiles} from '../files/asset-files';
import {refundStaff} from './refund-execution';
import {hasRefundReceipt} from './refund-proof';

const resourceType='refund-conflict-investigations';
const reportAction='REFUND_CONFLICT_INVESTIGATION_EVIDENCE',reviewAction='REFUND_CONFLICT_INVESTIGATION_REVIEW';
const digest=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().trim().min(1).max(2000);
const nextAction=z.enum(['VERIFY_BANK','VERIFY_ORIGINAL_CHANNEL','CONTACT_CUSTOMER','RECONCILE_RECEIPT_EVIDENCE','REQUEST_VERIFIED_FINANCIAL_DISPOSITION']);
const command=z.object({revision:z.number().int().nonnegative(),headHash:digest.nullable(),sourceHash:digest,idempotencyKey:key});
const reportInput=command.extend({responsibleStaffId:z.string().min(1),findings:text,nextAction,nextActionNote:text,evidenceFileIds:z.array(z.string().min(1)).min(1).max(20)}).strict();
const reviewInput=command.extend({reportId:z.string().min(1),decision:z.enum(['REVIEWED_UNRESOLVED','MORE_EVIDENCE_REQUIRED']),findings:text,nextAction,nextActionNote:text}).strict();
type Evidence={id:string;sha256:string;adminId:string};
type EventData={version:1;revision:number;previousHash:string|null;sourceHash:string;sourceSnapshot:unknown;actorId:string;actorPersonId:string;recordedAt:string;responsibleStaffId:string;responsiblePersonId:string;findings:string;nextAction:string;nextActionNote:string;files?:Evidence[];reportId?:string;reportHash?:string;decision?:string;eventHash:string};
export function refundInvestigationActions(paymentId:string,id:string){const base=`/admin/payments/${paymentId}/reconciliations/${id}/investigation`;return{read:base,append:`${base}/evidence`,review:`${base}/review`};}
async function responsible(tx:any,id:string){const staff=await tx.adminUser.findUnique({where:{id}});ensure(staff?.active&&['ADMIN','FINANCE'].includes(staff.role)&&staff.staffPersonId,409,'REFUND_RESPONSIBLE_STAFF_INVALID');return staff;}
async function files(tx:any,ids:string[],ownerId:string):Promise<Evidence[]>{
 await assertNotAssetFiles(tx,ids);const found=await tx.storedFile.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}});
 ensure(found.length===new Set(ids).size&&found.every((f:any)=>f.adminId===ownerId&&!f.customerId&&!f.fieldTaskId&&f.purpose==='refund-bank'&&['application/pdf','image/png','image/jpeg'].includes(f.mimeType)&&f.size>0&&f.size<=10485760&&/^[a-f0-9]{64}$/.test(f.sha256)),403,'FILE_OWNERSHIP');
 return found.map((f:any)=>({id:f.id,sha256:f.sha256,adminId:f.adminId}));
}
async function conflictSource(tx:any,paymentId:string,id:string){
 const reference=await tx.payment.findUnique({where:{id:paymentId},include:{bill:true}});ensure(reference,404,'NOT_FOUND');
 await lockOrder(tx,reference.bill.orderId);await tx.$queryRaw`SELECT id FROM "PaymentReconciliation" WHERE id=${id} FOR UPDATE`;
 const payment=await tx.payment.findUniqueOrThrow({where:{id:paymentId}}),record=await tx.paymentReconciliation.findUnique({where:{id}});
 ensure(record?.paymentId===paymentId&&record.resolution==='DUPLICATE_REFUND_CHANNEL_RECEIPT',404,'NOT_FOUND');
 ensure(record.status==='SUBMITTED'&&payment.reconciliationRequired,409,'REFUND_CONFLICT_STATE');
 const frozen=record.paymentSnapshot?.conflict,refundId=record.paymentSnapshot?.refundId;
 ensure(frozen?.version===1&&record.paymentSnapshot.paymentId===paymentId&&refundId,409,'REFUND_CONFLICT_SOURCE_CHANGED');
 const ids=[...new Set([refundId,frozen.normalRefundId,frozen.additionalRefundId].filter(Boolean))] as string[];
 const refunds=await tx.refund.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}}),anchor=refunds.find((r:any)=>r.id===refundId);
 ensure(refunds.length===ids.length&&refunds.every((r:any)=>r.paymentId===paymentId&&r.customerId===payment.customerId)&&anchor?.duplicateReceipt,409,'REFUND_CONFLICT_SOURCE_CHANGED');
 for(const field of Object.keys(frozen))if(field!=='verifiedExtraAmount')ensure(canonicalHash(anchor.duplicateReceipt[field])===canonicalHash(frozen[field]),409,'REFUND_CONFLICT_SOURCE_CHANGED');
 if(frozen.kind==='ORIGINAL_REISSUE')ensure(refunds.every(hasRefundReceipt),409,'REFUND_CONFLICT_SOURCE_CHANGED');
 else ensure(anchor.bankExecution?.sourceHash===frozen.bank?.sourceHash&&canonicalHash(anchor.bankExecution.source)===anchor.bankExecution.sourceHash,409,'REFUND_CONFLICT_SOURCE_CHANGED');
 // Exact public financial proofs and hashes only. Encrypted or plaintext account
 // details and unrelated order activity never enter investigation events.
 const currentProofs=refunds.map((r:any)=>({id:r.id,paymentId:r.paymentId,customerId:r.customerId,obligationId:r.obligationId,amount:r.amount,method:r.method,status:r.status,providerRefundId:r.providerRefundId,succeededAt:r.succeededAt,bankAccountHash:r.bankAccount?.hash??null,bankExecution:r.bankExecution??null,duplicateReceipt:r.duplicateReceipt??null,channelEvidenceHash:r.channelEvidence?canonicalHash(r.channelEvidence):null}));
 const sourceSnapshot={paymentId,amount:payment.amount,providerTransactionId:payment.providerTransactionId,reconciliationId:id,frozen:record.paymentSnapshot,currentProofs};
 return{record,sourceSnapshot,sourceHash:canonicalHash(sourceSnapshot)};
}
async function events(tx:any,id:string){
 const rows=await tx.auditLog.findMany({where:{resourceType,resourceId:id,action:{in:[reportAction,reviewAction]}}});rows.sort((a:any,b:any)=>a.data.revision-b.data.revision);
 let headHash:string|null=null;
 rows.forEach((row:any,index:number)=>{const{eventHash,...data}=row.data as EventData;ensure(data.version===1&&data.revision===index+1&&data.previousHash===headHash&&data.actorId===row.actorId&&canonicalHash(data)===eventHash,409,'REFUND_INVESTIGATION_HISTORY_CHANGED');headHash=eventHash;});
 return{rows,headHash,revision:rows.length};
}
async function view(tx:any,paymentId:string,id:string,source:any,history:any){
 const latest=history.rows.at(-1),responsibleStaff=latest?await tx.adminUser.findUnique({where:{id:latest.data.responsibleStaffId}}):null;
 return{reconciliationId:id,paymentId,sourceHash:source.sourceHash,source:source.sourceSnapshot,revision:history.revision,headHash:history.headHash,cashStatus:'UNRESOLVED',investigationStatus:!latest?'NOT_STARTED':latest.action===reportAction?'AWAITING_REVIEW':latest.data.decision,responsibleStaff:responsibleStaff?{id:responsibleStaff.id,name:responsibleStaff.name,role:responsibleStaff.role,active:responsibleStaff.active}:null,events:history.rows.map((r:any)=>({id:r.id,action:r.action,...r.data})),actions:refundInvestigationActions(paymentId,id),financialDisposition:{available:false,blocker:'VERIFIED_FINANCIAL_DISPOSITION_REQUIRED',cashReleaseAllowed:false}};
}
function current(input:any,source:any,history:any){ensure(input.revision===history.revision&&input.headHash===history.headHash,409,'REVISION_CONFLICT');ensure(input.sourceHash===source.sourceHash,409,'REFUND_CONFLICT_SOURCE_CHANGED');}
async function append(tx:any,actor:any,id:string,action:string,data:Omit<EventData,'eventHash'>){return audit(tx,actor.id,action,resourceType,id,{...data,eventHash:canonicalHash(data)});}
export async function readRefundInvestigation(tx:any,actor:any,paymentId:string,id:string){await refundStaff(tx,actor);const source=await conflictSource(tx,paymentId,id);return view(tx,paymentId,id,source,await events(tx,id));}
export async function appendRefundInvestigation(tx:any,actor:any,paymentId:string,id:string,raw:unknown){
 const input=reportInput.parse(raw),staff=await refundStaff(tx,actor),source=await conflictSource(tx,paymentId,id);
 return archiveCommand(tx,actor,`${resourceType}:${id}`,'APPEND_INVESTIGATION',input,async()=>{
  const history=await events(tx,id);current(input,source,history);const owner=await responsible(tx,input.responsibleStaffId),evidence=await files(tx,input.evidenceFileIds,actor.id);
  await append(tx,actor,id,reportAction,{version:1,revision:history.revision+1,previousHash:history.headHash,sourceHash:source.sourceHash,sourceSnapshot:source.sourceSnapshot,actorId:actor.id,actorPersonId:staff.staffPersonId,recordedAt:new Date().toISOString(),responsibleStaffId:owner.id,responsiblePersonId:owner.staffPersonId,findings:input.findings,nextAction:input.nextAction,nextActionNote:input.nextActionNote,files:evidence});
  return view(tx,paymentId,id,source,await events(tx,id));
 });
}
export async function reviewRefundInvestigation(tx:any,actor:any,paymentId:string,id:string,raw:unknown){
 const input=reviewInput.parse(raw),staff=await refundStaff(tx,actor),source=await conflictSource(tx,paymentId,id);
 return archiveCommand(tx,actor,`${resourceType}:${id}`,'REVIEW_INVESTIGATION',input,async()=>{
  const history=await events(tx,id);current(input,source,history);const report=history.rows.at(-1);
  ensure(report?.id===input.reportId&&report.action===reportAction,409,'REFUND_INVESTIGATION_STATE');const data=report.data as EventData;
  ensure(data.sourceHash===source.sourceHash,409,'REFUND_CONFLICT_SOURCE_CHANGED');await responsible(tx,data.responsibleStaffId);
  const currentFiles=await files(tx,(data.files??[]).map(f=>f.id),report.actorId);ensure(canonicalHash(currentFiles)===canonicalHash(data.files),409,'REFUND_EVIDENCE_CHANGED');
  await assertIndependentStaffReview(tx,actor.id,[report.actorId,data.responsibleStaffId,...currentFiles.map(f=>f.adminId)],'DUAL_APPROVAL');ensure(![data.actorPersonId,data.responsiblePersonId].includes(staff.staffPersonId),409,'DUAL_APPROVAL');
  await append(tx,actor,id,reviewAction,{version:1,revision:history.revision+1,previousHash:history.headHash,sourceHash:source.sourceHash,sourceSnapshot:source.sourceSnapshot,actorId:actor.id,actorPersonId:staff.staffPersonId,recordedAt:new Date().toISOString(),responsibleStaffId:data.responsibleStaffId,responsiblePersonId:data.responsiblePersonId,reportId:report.id,reportHash:data.eventHash,decision:input.decision,findings:input.findings,nextAction:input.nextAction,nextActionNote:input.nextActionNote});
  // Reviewing investigation does not resolve cash, alter capacity, or close the
  // immutable reconciliation. Further evidence can be appended to this history.
  return view(tx,paymentId,id,source,await events(tx,id));
 });
}
