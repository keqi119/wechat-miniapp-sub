import type { Entity } from './core';

export type UsageAccount = {
  orderId: string; orderStatus: string; policyVersion: string; startedOn: string | null; returnedOn: string | null;
  baseAllowanceKm: number; excessPriceAmount: number; packBalanceKm: number; packStatus: string;
  periods: Entity[]; packs: Array<{ id: string; km: number; amount: number; status: string; billId: string; remainingKm: number }>;
  ledger: Array<{ id: string; type: string; periodId?: string; packId?: string; deltaKm: number; createdAt: string }>;
  products: Array<{ id: string; version: number; km: number; amount: number }>;
  purchaseTerms: { version: number | string; hash: string; content: string; documentId?: string; documentVersion?: number } | null; canPurchase: boolean;
  returnSettlement: { id: string; status: string; revision: number } | null;
};
const statuses: Record<string, Record<string, string>> = {
  'usage-periods': { OPEN: '本期进行中', AWAITING_READING: '待月界读数', REVIEW_PENDING: '待审核照片与读数', READY: '可核对结算', SETTLED: '已结算', CANCELLED: '已取消' },
  'return-settlements': { READINGS_REQUIRED: '待补齐月界证据', PENDING_PAYMENT: '待核清账款', DISPUTED: '争议人工处理中', COMPLETED: '退订结算完成' },
  packs: { ACTIVE: '已到账', PENDING_PAYMENT: '待客户付款', EXPIRED: '未用余额已失效', VOID: '已作废', REFUND_PENDING: '退款核验中，权益冻结', REFUNDED: '已退款并收回权益' },
  'pack-account': { ACTIVE: '订阅期内可用', FROZEN: '冻结待历史用量结清', EXPIRED: '未用余额已失效' },
};
export function usageStatusLabel(resource: string | undefined, status: string): string | undefined { return statuses[resource ?? '']?.[status]; }
export function usageLedgerLabel(type: string): string { return ({ GRANT: '到账发放', CONSUME: '用量扣减', EXPIRE: '期满失效', REFUND: '退款收回' } as Record<string, string>)[type] ?? type; }
export function usageActionAllowed(resource: string, path: string, entity: Entity): boolean | undefined {
  if (resource === 'usage-periods') return path === 'request-evidence' ? ['READY', 'REVIEW_PENDING'].includes(String(entity.status)) && entity.canRequestEvidence === true : path === 'settle' && entity.status === 'READY' && entity.canSettle === true;
  if (resource === 'return-settlements') return path === 'resolve' ? entity.status === 'DISPUTED' && entity.canResolve === true : path === 'complete' && ['READINGS_REQUIRED', 'PENDING_PAYMENT'].includes(String(entity.status)) && entity.canComplete === true;
  return undefined;
}
export function shanghaiDateTime(value: unknown): string {
  if (!value) return '';
  const date = new Date(String(value)); if (!Number.isFinite(date.getTime())) return '';
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}
export function parseShanghaiDateTime(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('请填写实际交接时间（上海时区）');
  const date = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(date.getTime()) || shanghaiDateTime(date.toISOString()) !== value) throw new Error('实际交接日期或时间无效');
  return date.toISOString();
}
