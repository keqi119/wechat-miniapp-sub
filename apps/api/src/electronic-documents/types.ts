export const electronicDocumentKinds = [
  'SUBSCRIPTION','DELIVERY_DELAY','VEHICLE_SWAP','RENEWAL','PRE_DELIVERY_CANCELLATION',
  'EARLY_TERMINATION','RETURN_SETTLEMENT','RENEWAL_CANCELLATION',
  'COOPERATION','COOPERATION_AMENDMENT','COOPERATION_TERMINATION'
] as const;
export type ElectronicDocumentKind = typeof electronicDocumentKinds[number];
export type SignerRole = 'CUSTOMER'|'OWNER'|'PLATFORM';
export type SigningMode = 'MANUAL'|'AUTO';
export type SignerStatus = 'PENDING'|'ISSUED'|'UNKNOWN'|'SIGNED'|'DECLINED'|'EXPIRED';
export type ElectronicTaskStatus = 'PREPARED'|'SIGNING'|'SIGNED'|'FILING'|'ARCHIVING'|'ARCHIVED'|'WITHDRAWN'|'DECLINED'|'EXPIRED'|'RETIRED';
export type OperationStatus = 'NOT_STARTED'|'REQUESTED'|'UNKNOWN'|'CONFIRMED';
export interface SigningContext {
  kind: ElectronicDocumentKind;
  platformSubjectId: string;
  cooperationVersionId: string|null;
  vehicleIds: string[];
}
export interface AutoAuthorityEvidence {
  id: string;
  subjectId: string;
  providerCustomerId: string;
  signatureId: string;
  delegateSubjectId: string;
  enabled: boolean;
  providerStatus: string;
  granteeVerified: boolean;
  businessEvidenceHash: string;
  channelEvidenceHash: string;
  validFrom: string;
  validUntil: string;
  checkedAt: string;
  documentKinds: ElectronicDocumentKind[];
  cooperationVersionIds: string[]|null;
  vehicleIds: string[]|null;
}
export interface SigningPartyInput {
  role: SignerRole;
  subjectId: string;
  subjectType: 'INDIVIDUAL'|'ENTERPRISE';
  providerCustomerId: string;
  identityVersion: number;
  identityHash: string;
  identityVerified: boolean;
  certificate: {serialNo:string;status:string;validFrom:string;validUntil:string;checkedAt:string};
  signatureId?: string;
  autoAuthority?: AutoAuthorityEvidence|null;
}
export interface SigningModes {
  modes: Partial<Record<SignerRole,SigningMode>>;
  reasonCodes: string[];
}
export interface ElectronicPartyFacts extends SigningPartyInput {
  transactionId: string;
  mode: SigningMode;
  status: SignerStatus;
}
export interface ElectronicTaskFacts {
  id: string;
  kind: ElectronicDocumentKind;
  context: SigningContext;
  status: ElectronicTaskStatus;
  uploadStatus: 'NOT_STARTED'|'REQUESTED'|'UNKNOWN'|'UPLOADED';
  filingStatus: OperationStatus;
  businessApproved: boolean;
  sourceSha256: string;
  parties: ElectronicPartyFacts[];
}
export type ElectronicAction =
  | {kind:'SIGN';role:SignerRole;mode:SigningMode}
  | {kind:'QUERY';role:SignerRole}
  | {kind:'UPLOAD'|'QUERY_UPLOAD'|'FILE'|'QUERY_FILING'|'ARCHIVE'|'DONE'}
  | {kind:'BLOCKED';code:string}
  | {kind:'NONE';reason:string};
export interface ElectronicPartyBinding {
  role: SignerRole;
  subjectId: string;
  subjectType: 'INDIVIDUAL'|'ENTERPRISE';
  providerCustomerId: string;
  identityVersion: number;
  identityHash: string;
  certSerialNo: string;
  signatureId?: string;
  transactionId: string;
  mode: SigningMode;
  authorityEvidenceHash?: string;
}
export interface ElectronicSignerProof extends ElectronicPartyBinding {
  providerContractId: string;
  sourceSha256: string;
  status: 'SIGNED';
  attemptedAt: string;
  verifiedAt: string;
  queryEvidenceHash: string;
}
export interface ElectronicArchiveProof {
  taskId: string;
  archiveVersionId: string;
  kind: ElectronicDocumentKind;
  businessHash: string;
  providerContractId: string;
  status: 'ARCHIVED';
  sourceFile: {id:string;sha256:string};
  finalFile: {id:string;sha256:string;mimeType:string;size:number};
  uploadedAt: string;
  parties: ElectronicSignerProof[];
  filing: {status:'CONFIRMED';providerContractId:string;responseHash:string;confirmedAt:string};
  archivedAt: string;
}
export interface ElectronicBinding {
  taskId: string;
  archiveVersionId: string;
  kind: ElectronicDocumentKind;
  businessHash: string;
  providerContractId: string;
  sourceFileId: string;
  sourceSha256: string;
  finalFileId: string;
  finalSha256: string;
  now: Date;
  parties: ElectronicPartyBinding[];
}
