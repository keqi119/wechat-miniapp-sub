import {ensure} from '../common/errors';
import {assertElectronicParties,electronicHash,electronicId,electronicInstant,requiredSignerRoles} from './policy';
import type {ElectronicArchiveProof,ElectronicBinding} from './types';

/** Only persisted provider evidence may reach this boundary; never accept it in a client command. */
export function assertElectronicArchiveProof(proof:ElectronicArchiveProof,expected:ElectronicBinding):void{
  ensure(proof&&expected&&proof.status==='ARCHIVED',409,'ELECTRONIC_ARCHIVE_REQUIRED','电子合同尚未完整归档');
  for(const key of ['taskId','archiveVersionId','providerContractId'] as const)ensure(electronicId(expected[key])&&proof[key]===expected[key],409,'ELECTRONIC_BINDING_MISMATCH','电子归档与本业务任务不匹配');
  ensure(proof.kind===expected.kind&&electronicHash(expected.businessHash)&&proof.businessHash===expected.businessHash,409,'ELECTRONIC_BINDING_MISMATCH','电子归档业务版本不匹配');
  assertElectronicParties(expected.parties,expected.kind);assertElectronicParties(proof.parties,proof.kind);
  const source=proof.sourceFile,final=proof.finalFile;
  ensure(source&&electronicId(expected.sourceFileId)&&source.id===expected.sourceFileId&&electronicHash(expected.sourceSha256)&&source.sha256===expected.sourceSha256,409,'ELECTRONIC_SOURCE_MISMATCH','签署源文件不匹配');
  ensure(final&&electronicId(expected.finalFileId)&&final.id===expected.finalFileId&&final.id!==source.id&&electronicHash(expected.finalSha256)&&final.sha256===expected.finalSha256&&final.sha256!==source.sha256&&final.mimeType==='application/pdf'&&Number.isSafeInteger(final.size)&&final.size>0,409,'ELECTRONIC_FINAL_PDF_REQUIRED','签后最终 PDF 尚未核验或与原件相同');
  const uploaded=electronicInstant(proof.uploadedAt),archived=electronicInstant(proof.archivedAt),now=expected.now.getTime();
  ensure(Number.isFinite(uploaded)&&Number.isFinite(archived)&&Number.isFinite(now)&&uploaded<=archived&&archived<=now,409,'ELECTRONIC_EVIDENCE_TIME_INVALID','电子归档时间证据不完整');
  const transactions=new Set<string>();let lastVerified=uploaded;
  for(const role of requiredSignerRoles(proof.kind)){
    const party=proof.parties.find(p=>p.role===role)!,binding=expected.parties.find(p=>p.role===role)!;
    ensure(party.status==='SIGNED'&&electronicId(binding.subjectId)&&electronicId(binding.providerCustomerId)&&electronicId(binding.certSerialNo)&&electronicId(binding.transactionId)&&Number.isSafeInteger(binding.identityVersion)&&binding.identityVersion>0&&electronicHash(binding.identityHash),409,'ELECTRONIC_SIGNER_PROOF_REQUIRED','必需签署方尚未核验');
    for(const key of ['subjectId','subjectType','providerCustomerId','certSerialNo','transactionId','identityVersion','identityHash','signatureId','mode'] as const)ensure(party[key]===binding[key],409,'ELECTRONIC_SIGNER_MISMATCH','签署主体、证书、印章或交易不匹配');
    ensure(['INDIVIDUAL','ENTERPRISE'].includes(binding.subjectType)&&(binding.subjectType!=='ENTERPRISE'||electronicId(binding.signatureId))&&(party.role!=='PLATFORM'||binding.subjectType==='ENTERPRISE')&&(party.role!=='CUSTOMER'||binding.subjectType==='INDIVIDUAL')&&(party.mode!=='AUTO'||binding.subjectType==='ENTERPRISE'),409,'ELECTRONIC_SIGNER_MISMATCH','主体类型或企业印章不匹配，自然人须本人签署');
    ensure(['MANUAL','AUTO'].includes(party.mode)&&party.providerContractId===proof.providerContractId&&party.sourceSha256===source.sha256&&electronicHash(party.queryEvidenceHash)&&!transactions.has(party.transactionId),409,'ELECTRONIC_SIGNER_PROOF_REQUIRED','签署查询证据不完整或重复');
    if(party.mode==='AUTO')ensure(party.role!=='CUSTOMER'&&electronicHash(binding.authorityEvidenceHash)&&party.authorityEvidenceHash===binding.authorityEvidenceHash,409,'ELECTRONIC_AUTHORITY_PROOF_REQUIRED','自动签缺少本次用印授权证据');
    const attempted=electronicInstant(party.attemptedAt),verified=electronicInstant(party.verifiedAt);
    ensure(Number.isFinite(attempted)&&Number.isFinite(verified)&&attempted>=lastVerified&&verified>=attempted&&verified<=archived,409,'ELECTRONIC_EVIDENCE_TIME_INVALID','逐方签署时间或顺序不匹配');
    transactions.add(party.transactionId);lastVerified=verified;
  }
  const filing=proof.filing,filed=electronicInstant(filing?.confirmedAt);
  ensure(filing?.status==='CONFIRMED'&&filing.providerContractId===proof.providerContractId&&electronicHash(filing.responseHash)&&Number.isFinite(filed)&&filed>=lastVerified&&filed<=archived,409,'ELECTRONIC_FILING_REQUIRED','法大大归档尚未在全部签署后完成');
}
