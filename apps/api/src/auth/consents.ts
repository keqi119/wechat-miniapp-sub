import { z } from 'zod';
import { ensure } from '../common/errors';
export const consentInput = z.array(z.object({ documentId: z.string().min(1), version: z.number().int().positive() })).max(10);
export async function currentDocuments(tx: any, types: string[]) {
  return Promise.all(types.map(async type => { const doc = await tx.legalDocument.findFirst({ where: { type, status: 'PUBLISHED', confirmedAt: { not: null } }, orderBy: { version: 'desc' } }); ensure(doc, 409, 'LEGAL_UNAVAILABLE', '当前协议尚未发布'); return doc; }));
}
export async function acceptConsents(tx: any, customerId: string, input: {documentId:string;version:number}[], types: string[], source: string) {
  const docs = await currentDocuments(tx, types);
  for (const doc of docs) ensure(input.some(c => c.documentId === doc.id && c.version === doc.version), 409, 'CONSENT_VERSION', '请阅读并同意当前版本协议');
  await tx.customerConsent.createMany({ data: docs.map(doc => ({ customerId, documentId: doc.id, type: doc.type, version: doc.version, source })), skipDuplicates: true });
}
export async function requireCurrentConsents(tx: any, customerId: string, types: string[]) {
  for (const doc of await currentDocuments(tx, types)) ensure(await tx.customerConsent.count({ where: { customerId, documentId: doc.id, version: doc.version } }), 409, 'CONSENT_REQUIRED', '请先阅读并同意最新用户协议及隐私政策');
}
