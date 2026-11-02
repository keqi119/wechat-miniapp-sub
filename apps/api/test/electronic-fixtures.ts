import type { ElectronicArchiveProof, ElectronicBinding, ElectronicTaskFacts, SigningContext, SigningPartyInput } from '../src/electronic-documents/types';

export const esignNow = new Date('2026-11-02T08:00:00.000Z');
export const sha = (value: string) => value.repeat(64).slice(0, 64);
export const signingContext = (): SigningContext => ({kind:'SUBSCRIPTION',platformSubjectId:'ninda',cooperationVersionId:'cooperation-v1',vehicleIds:['vehicle-a']});
export function signingParties(): SigningPartyInput[] {
  return (['CUSTOMER','OWNER','PLATFORM'] as const).map(role => {
    const subjectId = role === 'PLATFORM' ? 'ninda' : role.toLowerCase();
    return {
      role,subjectId,subjectType:role==='CUSTOMER'?'INDIVIDUAL':'ENTERPRISE',providerCustomerId:`account-${role}`,identityVersion:1,identityHash:sha('a'),
      identityVerified:true,certificate:{serialNo:`certificate-${role}`,status:'VALID',validFrom:'2026-01-01T00:00:00Z',validUntil:'2027-01-01T00:00:00Z',checkedAt:'2026-11-02T07:00:00Z'},
      ...(role==='CUSTOMER'?{}:{signatureId:`seal-${role}`,autoAuthority:{id:`grant-${role}`,subjectId,providerCustomerId:`account-${role}`,signatureId:`seal-${role}`,delegateSubjectId:'ninda',enabled:true,providerStatus:'AUTHORIZED',granteeVerified:true,businessEvidenceHash:sha('b'),channelEvidenceHash:sha('c'),validFrom:'2026-11-01T00:00:00Z',validUntil:'2026-12-01T00:00:00Z',checkedAt:'2026-11-02T07:00:00Z',documentKinds:['SUBSCRIPTION'],cooperationVersionIds:['cooperation-v1'],vehicleIds:['vehicle-a']}})
    };
  });
}
export function electronicTask(): ElectronicTaskFacts {
  return {id:'task-a',kind:'SUBSCRIPTION',context:signingContext(),status:'SIGNING',uploadStatus:'UPLOADED',filingStatus:'NOT_STARTED',businessApproved:true,sourceSha256:sha('d'),
    parties:signingParties().map(p=>({...p,transactionId:`transaction-${p.role}`,mode:p.role==='CUSTOMER'?'MANUAL':'AUTO',status:'PENDING'}))};
}
export function electronicProof(): {proof:ElectronicArchiveProof;expected:ElectronicBinding} {
  const task=electronicTask();
  const proof:ElectronicArchiveProof={taskId:task.id,archiveVersionId:'archive-v1',kind:task.kind,businessHash:sha('e'),providerContractId:'provider-contract-a',status:'ARCHIVED',
    sourceFile:{id:'source-pdf',sha256:sha('d')},finalFile:{id:'final-pdf',sha256:sha('f'),mimeType:'application/pdf',size:2048},
    uploadedAt:'2026-11-02T05:00:00Z',filing:{status:'CONFIRMED',providerContractId:'provider-contract-a',responseHash:sha('b'),confirmedAt:'2026-11-02T07:30:00Z'},archivedAt:'2026-11-02T07:40:00Z',
    parties:task.parties.map((p,i)=>({role:p.role,subjectId:p.subjectId,subjectType:p.subjectType,providerCustomerId:p.providerCustomerId,identityVersion:p.identityVersion,identityHash:p.identityHash,certSerialNo:p.certificate.serialNo,signatureId:p.signatureId,transactionId:p.transactionId,providerContractId:'provider-contract-a',sourceSha256:sha('d'),status:'SIGNED',mode:p.mode,attemptedAt:`2026-11-02T06:${i}0:00Z`,verifiedAt:`2026-11-02T06:${i}5:00Z`,queryEvidenceHash:sha(String(i+1)),...(p.mode==='AUTO'?{authorityEvidenceHash:sha('a')}:{} )}))};
  const expected:ElectronicBinding={taskId:task.id,archiveVersionId:'archive-v1',kind:task.kind,businessHash:sha('e'),providerContractId:'provider-contract-a',sourceFileId:'source-pdf',sourceSha256:sha('d'),finalFileId:'final-pdf',finalSha256:sha('f'),now:esignNow,parties:proof.parties.map(({role,subjectId,subjectType,providerCustomerId,identityVersion,identityHash,certSerialNo,signatureId,transactionId,mode,authorityEvidenceHash})=>({role,subjectId,subjectType,providerCustomerId,identityVersion,identityHash,certSerialNo,signatureId,transactionId,mode,authorityEvidenceHash}))};
  return {proof,expected};
}
