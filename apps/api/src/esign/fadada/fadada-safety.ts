import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ensure } from '../../common/errors';
import { verifyFadadaCallbackDigest } from './fadada-digest';
import { matchesFadadaQuery } from '../fadada-query-binding';
export function accountReadiness(account: any, now = new Date()) {
  const providerBacked = account?.verificationSource === 'QUERY' || account?.verificationSource === 'CALLBACK';
  const recent = account?.checkedAt && now.getTime() - new Date(account.checkedAt).getTime() < 24 * 60 * 60 * 1000;
  const registered = account?.registrationStatus === 'REGISTERED' && Boolean(account?.providerCustomerId);
  const identityBound = Boolean(account?.identityCiphertext && account?.verifiedIdentityHash === createHash('sha256').update(account.identityCiphertext).digest('hex') && account?.verifiedSerialNo && account?.verificationTransactionNo && !account?.verificationLeaseToken);
  const realName = registered && identityBound && account?.realNameStatus === 'VERIFIED' && Boolean(account?.verifiedAt) && providerBacked;
  const certBound = realName && account?.certStatus === 'BOUND' && Boolean(account?.certSerialNo);
  const ready = Boolean(certBound && recent);
  return { readyForSigning: ready, signingEligible: ready, state: ready ? 'SIGNING_ENABLED' : !registered ? 'NOT_STARTED' : !realName ? 'REALNAME_PENDING' : !certBound ? 'CERT_BINDING_PENDING' : 'UNKNOWN', realNameStatus: realName ? 'VERIFIED' : account?.realNameStatus === 'VERIFIED' ? 'UNKNOWN' : account?.realNameStatus || 'NOT_STARTED', certBound: Boolean(certBound), nextAction: ready ? 'NONE' : !registered ? 'REGISTER_PROVIDER_ACCOUNT' : !realName ? 'START_REALNAME_VERIFICATION' : 'QUERY_PROVIDER_STATUS' };
}
function encryptionKey(value: string) { const key = Buffer.from(value || '', 'base64'); ensure(key.length === 32, 503, 'IDENTITY_KEY_MISSING', '实名资料加密配置未就绪'); return key; }
export function encryptIdentity(value: unknown, customerId: string, key: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(key), iv); cipher.setAAD(Buffer.from(customerId)); const content = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]); return [iv, cipher.getAuthTag(), content].map(b=>b.toString('base64url')).join('.'); }
export function decryptIdentity(value: string, customerId: string, key: string): any { const parts = value.split('.').map(v=>Buffer.from(v,'base64url')); ensure(parts.length === 3, 409, 'IDENTITY_CIPHERTEXT', '实名资料不可读取'); const decipher = createDecipheriv('aes-256-gcm', encryptionKey(key), parts[0]); decipher.setAAD(Buffer.from(customerId)); decipher.setAuthTag(parts[1]); return JSON.parse(Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString('utf8')); }
export function verifiedCallback(payload: unknown, config: { appId: string; appSecret: string }) {
  let record: Record<string,string> = {};
  if (typeof payload === 'string' || payload instanceof URLSearchParams) {
    const values = typeof payload === 'string' ? new URLSearchParams(payload) : payload;
    for (const [key,value] of values) { ensure(!(key in record),400,'CALLBACK_FIELDS','回调参数重复'); record[key] = value; }
  } else {
    ensure(payload && typeof payload === 'object' && !Array.isArray(payload),400,'CALLBACK_FIELDS','回调格式无效');
    for(const [key,value] of Object.entries(payload as Record<string,unknown>)) { ensure(typeof value === 'string' && value.length < 16000,400,'CALLBACK_FIELDS','回调参数无效'); record[key] = value; }
  }
  const transactionId = record.transaction_id || record.transactionNo || record.transaction_no;
  ensure(transactionId && /^[A-Za-z0-9_-]{1,100}$/.test(transactionId) && /^\d{14}$/.test(record.timestamp || ''),400,'CALLBACK_FIELDS','回调身份无效');
  ensure(verifyFadadaCallbackDigest({ ...config, timestamp: record.timestamp, receivedMsgDigest: record.msg_digest || '', businessParams: record, explicitSortString: transactionId }),401,'CALLBACK_SIGNATURE','回调验签失败');
  return { record, transactionId, providerContractId: record.contract_id };
}
export function assertSignerResult(value: any, expected: { contractId: string; customerId: string; transactionId: string }) {
  ensure(matchesFadadaQuery(value,expected),502,'PROVIDER_IDENTITY_MISMATCH','签署结果身份不匹配');
}
export function assertApprovedText(document: any) { ensure(document?.status === 'PUBLISHED' && document.confirmedBy && document.confirmedAt && typeof document.content === 'string' && document.content.trim().length > 0,409,'LEGAL_NOT_APPROVED','正式文案尚未审定发布'); ensure(!/\{\{[^}]*\}\}|待补齐|待填写/.test(document.content),409,'LEGAL_PLACEHOLDERS','正式文案仍有未填写字段'); }
export function certificateCurrentlyValid(raw: unknown, now = Date.now()) {
  function field(value: any, keys: string[], depth = 0): string | undefined {
    if (depth > 4) return;
    if (typeof value === 'string') { try { return field(JSON.parse(value), keys, depth + 1); } catch { return; } }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const key of keys) if (typeof value[key] === 'string' || typeof value[key] === 'number') return String(value[key]);
    for (const nested of Object.values(value)) { const found = field(nested, keys, depth + 1); if (found) return found; }
  }
  function time(value?: string): number {
    if (!value) return NaN;
    const compact = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
    const local = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/);
    const parts = compact || local;
    if (parts) return Date.UTC(Number(parts[1]), Number(parts[2])-1, Number(parts[3]), Number(parts[4] || 0)-8, Number(parts[5] || 0), Number(parts[6] || 0));
    if (/^\d{10,13}$/.test(value)) return Number(value) * (value.length <= 10 ? 1000 : 1);
    return Date.parse(value);
  }
  const start = time(field(raw, ['startTime','start_time','validStartTime','valid_start_time']));
  const end = time(field(raw, ['endTime','end_time','validEndTime','valid_end_time']));
  return Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end;
}
