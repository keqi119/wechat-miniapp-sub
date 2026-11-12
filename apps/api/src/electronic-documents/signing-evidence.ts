import {electronicHash} from './policy';
/** Migrated SIGNED is a trusted old fact, but may still need original-transaction enrichment. */
export function hasActualSigningEvidence(p:any):boolean{
 return p?.status==='SIGNED'&&p.providerSignedAt instanceof Date&&Number.isFinite(p.providerSignedAt.getTime())&&typeof p.providerSignedAtRaw==='string'&&p.providerSignedAtRaw.length>0&&[1,10,100,1000].includes(p.providerSignedAtPrecisionMs)&&electronicHash(p.queryEvidenceHash);
}
export function signingEvidenceUpdate(p:any,result:any,now:Date){
 return{status:'SIGNED',verifiedAt:p.verifiedAt??now,evidenceCheckedAt:now,...(p.status==='SIGNED'&&!p.originalQueryEvidenceHash?{originalQueryEvidenceHash:p.queryEvidenceHash}:{}),providerSignedAt:new Date(result.providerSignedAt),providerSignedAtRaw:result.providerSignedAtRaw,providerSignedAtPrecisionMs:result.providerSignedAtPrecisionMs,queryEvidenceHash:p.status==='SIGNED'?p.queryEvidenceHash:result.evidenceHash,...(p.status==='SIGNED'?{enrichmentQueryEvidenceHash:result.evidenceHash}:{})};
}
