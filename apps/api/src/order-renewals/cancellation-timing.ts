import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {assertNotAssetFiles} from '../files/asset-files';

const fields=['mutuallyAgreedAt','mutualAgreementVerifiedBy','mutualAgreementVerifiedAt','mutualAgreementNote','mutualAgreementHash'] as const;
const present=(record:any)=>!!record&&(fields.some(key=>record[key]!=null)||(record.mutualAgreementEvidenceFileIds?.length??0)>0);
const validId=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&!value.includes('\0');
function valid(value:unknown,message='双方取消约定的时间或证据不完整，请核对原始记录'):asserts value{ensure(value,409,'RENEWAL_CANCELLATION_AGREEMENT_INVALID',message);}
function instant(value:unknown){const n=value instanceof Date?value.getTime():typeof value==='string'?Date.parse(value):NaN;valid(Number.isFinite(n));return n;}
function startTime(day:string){
 valid(/^\d{4}-\d{2}-\d{2}$/.test(day));const n=Date.parse(`${day}T00:00:00+08:00`);
 valid(Number.isFinite(n)&&new Date(n+8*60*60*1000).toISOString().slice(0,10)===day);return n;
}
function source(record:any){
 valid(record&&['OPEN','COMPLETED'].includes(record.status)&&['id','orderId','customerId','ownerId','changeId','quoteId'].every(key=>validId(record[key])));
 valid(record.sourceSnapshot&&typeof record.sourceSnapshot==='object'&&!Array.isArray(record.sourceSnapshot)&&record.sourceSnapshot.version===1&&/^[a-f0-9]{64}$/.test(record.sourceHash)&&canonicalHash(record.sourceSnapshot)===record.sourceHash,'取消案冻结来源与双方确认记录不一致');
}
async function evidence(tx:any,ids:unknown,verifiedBy:string){
 valid(Array.isArray(ids)&&ids.length>0&&ids.length<=20&&ids.every(validId)&&new Set(ids).size===ids.length);
 await assertNotAssetFiles(tx,ids);
 const rows=await tx.storedFile.findMany({where:{id:{in:ids}}});
 valid(rows.length===ids.length&&new Set(rows.map((f:any)=>f.id)).size===ids.length&&rows.every((f:any)=>ids.includes(f.id)&&f.adminId===verifiedBy&&!f.customerId&&!f.fieldTaskId&&f.purpose==='evidence'&&['application/pdf','image/jpeg','image/png'].includes(f.mimeType)&&Number.isSafeInteger(f.size)&&f.size>0&&f.size<=10*1024*1024&&/^[a-f0-9]{64}$/.test(f.sha256)),'请提供由本次核实人员上传的真实双方取消证据');
 return rows.map((f:any)=>({fileId:f.id,sha256:f.sha256 as string,size:f.size as number,mimeType:f.mimeType as string})).sort((a:any,b:any)=>a.fileId.localeCompare(b.fileId));
}
async function proof(tx:any,record:any,startDate:string,now:Date){
 source(record);const agreed=instant(record.mutuallyAgreedAt),verified=instant(record.mutualAgreementVerifiedAt),time=instant(now);
 valid(agreed<startTime(startDate)&&agreed<=verified&&verified<=time,'取消约定必须真实达成于上海时区起租日之前，核实时间不得在未来');
 valid(validId(record.mutualAgreementVerifiedBy)&&typeof record.mutualAgreementNote==='string'&&record.mutualAgreementNote.trim().length>0&&record.mutualAgreementNote.length<=2000);
 return{version:1 as const,cancellationId:record.id as string,sourceHash:record.sourceHash as string,orderId:record.orderId as string,customerId:record.customerId as string,ownerId:record.ownerId as string,changeId:record.changeId as string,quoteId:record.quoteId as string,startDate,mutuallyAgreedAt:new Date(agreed).toISOString(),verifiedBy:record.mutualAgreementVerifiedBy as string,verifiedAt:new Date(verified).toISOString(),note:record.mutualAgreementNote as string,evidence:await evidence(tx,record.mutualAgreementEvidenceFileIds,record.mutualAgreementVerifiedBy)};
}

/** Read-only. OPEN time, original signature and refund initiation cannot substitute for mutual agreement. */
export async function assertRenewalCancellationTiming(tx:any,record:any|null,startDate:string,now:Date){
 const boundary=startTime(startDate),time=instant(now);
 if(!present(record)){
  ensure(time<boundary,409,'RENEWAL_CANCELLATION_AGREEMENT_REQUIRED','已到新租期开始日，请先核实双方在起租前同意取消的时间和证据');
  return null;
 }
 const result=await proof(tx,record,startDate,now),hash=canonicalHash(result);
 valid(record.mutualAgreementHash===hash,'双方取消约定的来源、时间或证据已变化');return{...result,hash};
}

/** Returns server-generated immutable data; caller must hold Order lock, recheck current staff and CAS the case. */
export async function buildRenewalCancellationMutualAgreement(tx:any,record:any,input:{startDate:string;mutuallyAgreedAt:string;evidenceFileIds:string[];note:string},actor:{id:string},now:Date){
 source(record);valid(record.status==='OPEN'&&!present(record),'双方取消约定已经记录或取消案已完成，不能覆盖原记录');
 valid(validId(actor.id)&&typeof input.mutuallyAgreedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.mutuallyAgreedAt),'请填写带时区的真实双方同意时间');
 startTime(input.mutuallyAgreedAt.slice(0,10));
 const data={mutuallyAgreedAt:new Date(input.mutuallyAgreedAt),mutualAgreementVerifiedBy:actor.id,mutualAgreementVerifiedAt:new Date(now),mutualAgreementEvidenceFileIds:[...input.evidenceFileIds].sort(),mutualAgreementNote:input.note,mutualAgreementHash:''};
 const result=await proof(tx,{...record,...data},input.startDate,now);data.mutualAgreementHash=canonicalHash(result);return data;
}
