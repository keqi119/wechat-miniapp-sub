import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertElectronicArchiveProof} from '../src/electronic-documents/proof';
import {electronicProof,sha} from './electronic-fixtures';
const rejected=(proof:any,expected:any)=>assert.throws(()=>assertElectronicArchiveProof(proof,expected),(error:any)=>String(error?.getResponse?.().error?.code||'').startsWith('ELECTRONIC_'));

test('three separately verified signatures, provider filing and a bound final PDF constitute electronic archive evidence',()=>{
  const {proof,expected}=electronicProof();assert.doesNotThrow(()=>assertElectronicArchiveProof(proof,expected));
});
test('missing Ningda or duplicating another party cannot make a complete archive',()=>{
  for(const mutate of [(p:any)=>p.parties.pop(),(p:any)=>p.parties[2]={...p.parties[1]},(p:any)=>p.parties[2].status='PENDING',(p:any)=>p.parties[2].queryEvidenceHash=null]){
    const {proof,expected}=electronicProof();mutate(proof);rejected(proof,expected);
  }
});
test('archive proof is not transferable between resources, contracts, identities, seals, transactions or frozen source files',()=>{
  for(const mutate of [(p:any)=>p.taskId='other-task',(p:any)=>p.archiveVersionId='other-version',(p:any)=>p.businessHash=sha('0'),(p:any)=>p.providerContractId='other-contract',(p:any)=>p.sourceFile.id='other-source',(p:any)=>p.sourceFile.sha256=sha('0'),(p:any)=>p.parties[1].providerCustomerId='api-company',(p:any)=>p.parties[1].identityVersion=2,(p:any)=>p.parties[1].identityHash=sha('0'),(p:any)=>p.parties[1].signatureId='other-seal',(p:any)=>p.parties[1].certSerialNo='other-cert',(p:any)=>p.parties[1].transactionId=p.parties[0].transactionId,(p:any)=>p.parties[1].sourceSha256=sha('0'),(p:any)=>p.parties[1].providerContractId='other-contract',(p:any)=>p.parties[1].authorityEvidenceHash=null]){
    const {proof,expected}=electronicProof();mutate(proof);rejected(proof,expected);
  }
});
test('a provider response, source PDF or unfinished filing is not a signed final archive',()=>{
  for(const mutate of [(p:any)=>p.status='ARCHIVING',(p:any)=>p.finalFile.id=p.sourceFile.id,(p:any)=>p.finalFile.sha256=p.sourceFile.sha256,(p:any)=>p.finalFile.mimeType='text/html',(p:any)=>p.finalFile.size=0,(p:any)=>p.filing.status='UNKNOWN',(p:any)=>p.filing.responseHash='',(p:any)=>p.filing.providerContractId='other-contract',(p:any)=>p.finalFile.id='other-final']){
    const {proof,expected}=electronicProof();mutate(proof);rejected(proof,expected);
  }
});
test('the final file digest and automatic authority must match the frozen archive binding',()=>{
  for(const mutate of [(p:any)=>p.finalFile.sha256=sha('0'),(p:any)=>p.parties[1].authorityEvidenceHash=sha('0'),(p:any)=>p.parties[1].mode='MANUAL']){
    const {proof,expected}=electronicProof();mutate(proof);rejected(proof,expected);
  }
});
test('filing cannot precede the last signer, archive cannot precede filing, and impossible evidence times are rejected',()=>{
  for(const mutate of [(p:any)=>p.filing.confirmedAt='2026-11-02T06:23:00Z',(p:any)=>p.archivedAt='2026-11-02T07:20:00Z',(p:any)=>p.archivedAt='2027-11-02T07:20:00Z',(p:any)=>p.parties[1].attemptedAt='invalid-date',(p:any)=>p.parties[1].verifiedAt='2026-11-02T04:00:00Z']){
    const {proof,expected}=electronicProof();mutate(proof);rejected(proof,expected);
  }
});
test('cooperation has exactly its two parties and cannot acquire a customer signature slot',()=>{
  const {proof,expected}=electronicProof();proof.kind='COOPERATION';expected.kind='COOPERATION';proof.parties=proof.parties.slice(1);expected.parties=expected.parties.slice(1);
  assert.doesNotThrow(()=>assertElectronicArchiveProof(proof,expected));proof.parties.push(electronicProof().proof.parties[0]);rejected(proof,expected);
});
test('even a persisted automatic claim cannot sign for a natural person or omit an enterprise seal',()=>{
  let pair=electronicProof();pair.proof.parties[1].subjectType='INDIVIDUAL';pair.expected.parties[1].subjectType='INDIVIDUAL';rejected(pair.proof,pair.expected);
  pair=electronicProof();delete pair.proof.parties[2].signatureId;delete pair.expected.parties[2].signatureId;rejected(pair.proof,pair.expected);
});
