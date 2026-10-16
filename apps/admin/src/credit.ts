import { moneyToCents, type Entity } from './core.ts';

export const creditBandLabels: Record<string, string> = { GE750: '750及以上 · 免押金', B700_749: '700–749 · 月费1倍押金', B650_699: '650–699 · 月费2倍押金', LT650: '低于650 · 转人工处理', UNVERIFIABLE: '无法核验 · 转人工处理' };
export type CreditReview = {
  applicationId: string; creditRevision: number; ruleVersion: string; status: string;
  document: { id: string; type: string; version: number; title: string; content: string } | null;
  consent: { id: string; status: string; documentId: string; version: number; acceptedAt?: string | null; withdrawnAt?: string | null } | null;
  verification: { id: string; band: string; verifiedBy: string; verifiedAt: string; consentId: string } | null;
  canConsent: boolean; canDecline?: boolean; consentRequirementsMet?: boolean; canWithdraw: boolean; canVerify: boolean; canFinalize: boolean; depositMultiplier: number | null;
};
export function creditReviewMessage(review: CreditReview): string {
  if (review.status === 'HISTORICAL') return '已确认方案保留当时核验与押金事实；后续撤回不修改历史订单金额。';
  if (review.consentRequirementsMet === false) return '客户需先阅读并同意当前用户协议与隐私政策，再继续本申请信用核验；后台不能代为同意。';
  if (review.consent?.status === 'DECLINED') return '客户暂不授权本申请信用核验，请联系人工处理；不能录入信用档位或发布正式方案。';
  if (review.status === 'MANUAL_REVIEW') return '低于650或无法核验，转人工联系处理，不能发布正式方案。';
  if (review.canFinalize) return '按当前有效核验与月费计算押金。核验变更或撤回会使未确认的旧方案失效，须刷新并发布新方案。';
  if (review.canVerify) return '客户已独立授权本申请；请在客户主动出示页面后，仅录入信用档位。';
  return '等待客户在本申请中阅读当前信用说明并自行明确授权。后台不能代替客户勾选或录入授权。';
}
export function creditDeposit(monthlyAmount: number, band: string): number | undefined {
  if (!Number.isSafeInteger(monthlyAmount) || monthlyAmount < 0 || monthlyAmount > 2147483647) throw new Error('月费不是有效整数分');
  const factor = ({ GE750: 0, B700_749: 1, B650_699: 2 } as Record<string, number>)[band];
  if (factor === undefined) return undefined;
  const amount = monthlyAmount * factor;
  if (amount > 2147483647) throw new Error('按信用档位计算的押金超出金额范围');
  return amount;
}
export function creditReady(value: unknown, applicationId: string, action: 'verify' | 'finalize'): boolean {
  const review = value as CreditReview | undefined;
  if (!review || review.applicationId !== applicationId || !Number.isSafeInteger(review.creditRevision) || review.creditRevision < 0 || review.ruleVersion !== 'ZHIMA_MANUAL_V1') return false;
  const { consent, document, verification } = review;
  if (!document || document.type !== 'credit-verification' || !consent || consent.status !== 'ACCEPTED' || consent.withdrawnAt || consent.documentId !== document.id || consent.version !== document.version) return false;
  if (action === 'verify') return review.canVerify === true;
  return review.canFinalize === true && review.status === 'VERIFIED' && !!verification?.id && verification.consentId === consent.id && ['GE750', 'B700_749', 'B650_699'].includes(verification.band);
}
export function creditVerificationPayload(body: Record<string, unknown>, idempotencyKey?: string): Record<string, unknown> {
  if (!idempotencyKey || idempotencyKey.length < 8) throw new Error('信用核验请求编号缺失，请关闭后重新录入');
  if (Object.keys(body).some(key => !['consentId', 'creditRevision', 'band', 'customerPresented'].includes(key)) || typeof body.consentId !== 'string' || !body.consentId || !Number.isSafeInteger(body.creditRevision) || Number(body.creditRevision) < 0 || !Object.hasOwn(creditBandLabels, String(body.band)) || body.customerPresented !== true) throw new Error('请核对申请授权、信用档位及客户主动出示声明');
  return { consentId: body.consentId, creditRevision: body.creditRevision, band: body.band, customerPresented: true, idempotencyKey };
}
export function creditPlanInitial(entity: Entity, review?: CreditReview): Record<string, unknown> {
  return { ...(entity.subscriptionPlan as Record<string, unknown> ?? entity.plan as Record<string, unknown> ?? {}), ...(entity.finalPlan as Record<string, unknown> ?? {}), mileagePerMonthKm: 1500, excessMileagePriceAmount: 150, revision: entity.revision ?? 0, creditVerificationId: review?.verification?.id ?? '', creditBand: review?.verification?.band ?? '', creditRevision: review?.creditRevision, creditRuleVersion: review?.ruleVersion };
}
export function creditDepositPreview(values: Record<string, string>, initial: Record<string, unknown>): string {
  try { const amount = creditDeposit(moneyToCents(values.monthlyFeeAmount ?? ''), String(initial.creditBand ?? '')); return amount === undefined ? '待有效信用核验' : (amount / 100).toFixed(2); }
  catch (error) { return error instanceof Error ? error.message : '请核对月费'; }
}
