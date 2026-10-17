import { z } from 'zod';
import { ensure } from '../common/errors';
import { hash } from '../common/data';

const place = { name: z.string().trim().max(100), address: z.string().trim().min(2).max(500) };
export const locationInput = z.discriminatedUnion('source', [
  z.object({ ...place, source: z.literal('MANUAL') }).strict(),
  z.object({ ...place, source: z.literal('MAP'), accepted: z.literal(true), policyHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]).nullable().optional();
const binding = z.object({ documentId: z.string().min(1), version: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const policy = z.object({ privacy: binding, application: binding, 'handover-location': binding }).strict();
const disabled = { enabled: false, mapEnabled: false, notice: null, policyHash: null };

export async function locationCapabilities(db: any): Promise<any> {
  let pinned: z.infer<typeof policy>;
  try { pinned = policy.parse(JSON.parse(process.env.HANDOVER_LOCATION_POLICY_JSON || '')); } catch { return disabled; }
  const documents: any[] = [];
  for (const type of ['privacy', 'application', 'handover-location'] as const) {
    const doc = await db.legalDocument.findFirst({ where: { type, status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
    const expected = pinned[type];
    if (!doc?.confirmedAt || !doc.confirmedBy || !doc.content?.trim() || doc.id !== expected.documentId || doc.version !== expected.version || hash(doc.content) !== expected.contentHash) return disabled;
    documents.push(doc);
  }
  const notice = documents[2];
  // Canonical ordered bindings make configuration key order irrelevant.
  const policyHash = hash(documents.map(d => ({ type: d.type, documentId: d.id, version: d.version, contentHash: hash(d.content) })));
  return { enabled: true, mapEnabled: process.env.HANDOVER_LOCATION_MAP_ENABLED === 'true', notice: { id: notice.id, type: notice.type, version: notice.version, title: notice.title, content: notice.content }, policyHash };
}

export async function resolveLocation(db: any, value: unknown, customerId: string, previous?: any): Promise<any> {
  if (value === undefined) return previous;
  if (value === null) return null;
  const input = locationInput.parse(value)!;
  const cap = await locationCapabilities(db);
  ensure(cap.enabled, 409, 'LOCATION_UNAVAILABLE', '交接地点说明正在更新，请稍后填写或联系客服');
  const location = { source: input.source, name: input.name, address: input.address };
  if (input.source === 'MANUAL') return location;
  ensure(cap.mapEnabled, 409, 'LOCATION_MAP_DISABLED', '地图选点暂未启用，请改为手动填写地址');
  ensure(input.policyHash === cap.policyHash, 409, 'LOCATION_POLICY_CHANGED', '交接地点说明已更新，请重新阅读并选择地点');
  return { ...location, consent: { customerId, documentId: cap.notice.id, version: cap.notice.version, contentHash: hash(cap.notice.content), policyHash: cap.policyHash, acceptedAt: new Date().toISOString() } };
}
