import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
export async function readExitEvidence(tx:any,kind:'cancellation04'|'termination',caseId:string,fileId:string,actor:any){
 await requireCurrentStaff(tx,actor,'orders',false);ensure(['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN');
 const record=await (kind==='cancellation04'?tx.orderPreDeliveryCancellation:tx.orderTermination).findUnique({where:{id:caseId}}),fixed=record?.proposal?.evidence?.find((e:any)=>e.id===fileId);ensure(fixed,404,'NOT_FOUND');
 const file=await tx.storedFile.findUnique({where:{id:fileId}});ensure(file&&file.purpose==='evidence'&&file.sha256===fixed.sha256&&file.customerId===fixed.customerId&&file.adminId===fixed.adminId,409,'AGREEMENT_EVIDENCE_CHANGED');return file;
}
