import { z } from 'zod';
import { ensure } from '../common/errors';
import { hash } from '../common/data';
import { dateOnly } from '../billing/rules';

const id = z.string().trim().min(1).max(200);
const day = z.string().refine(v => { try { dateOnly(v); return true; } catch { return false; } });
const scopeSchema = z.object({ applicationId: id, customerId: id, vehicleId: id, startDate: day, firstDueDate: day, reference: z.string().trim().min(1).max(500) }).strict();
const snapshotSchema = z.object({ ruleVersion: z.literal('V1_ONE_FEN'), scope: scopeSchema, scopeHash: z.string().length(64), standardDepositAmount: z.number().int().nonnegative().max(2147483647), authorizedBy: id, authorizedAt: z.string().datetime() }).strict();
export const ACCEPTANCE_DESCRIPTION = '本单验收报价：12期租金各0.01元（合计0.12元），押金一次性0.01元；本单押金按双方确认金额收取，信用核验档位不变。';
function configuredScope(env = process.env) {
  try { const value = scopeSchema.safeParse(JSON.parse(env.ORDER_ACCEPTANCE_SCOPE_JSON || '')); return value.success ? value.data : null; }
  catch { return null; }
}
const sameApplication = (app: any, scope: z.infer<typeof scopeSchema>) => app?.id === scope.applicationId && app.customerId === scope.customerId && app.vehicleId === scope.vehicleId;
const dateValue = (value: unknown) => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T00:00:00\.000Z)?$/.test(value) ? value.slice(0, 10) : '';
function matchesPrice(value: any, scope: z.infer<typeof scopeSchema>) {
  return value.monthlyFeeAmount === 1 && value.depositAmount === 1 && value.months === 12 && dateValue(value.startDate) === scope.startDate && dateValue(value.firstDueDate) === scope.firstDueDate;
}
export function acceptancePricingOffer(application: any, env = process.env) {
  const scope = configuredScope(env); if (!scope || !sameApplication(application, scope)) return null;
  return { mode: 'V1_ONE_FEN', monthlyFeeAmount: 1, depositAmount: 1, months: 12, startDate: scope.startDate, firstDueDate: scope.firstDueDate, reference: scope.reference, description: ACCEPTANCE_DESCRIPTION };
}
export function finalPlanPricing(application: any, input: any, standardDeposit: number, actor: { id: string; role?: string }) {
  if (!input.pricingMode || input.pricingMode === 'STANDARD') {
    ensure(input.depositAmount === undefined || input.depositAmount === standardDeposit, 409, 'DEPOSIT_POLICY', '押金必须按当前人工核验档位和月费计算');
    return { depositAmount: standardDeposit, acceptancePricing: undefined };
  }
  ensure(input.pricingMode === 'V1_ONE_FEN', 400, 'PRICING_MODE', '报价方式无效');
  ensure(actor.role === 'ADMIN', 403, 'ACCEPTANCE_PRICE_ROLE', '本单验收报价仅限管理员发布');
  const scope = configuredScope();
  ensure(scope && sameApplication(application, scope), 409, 'ACCEPTANCE_PRICE_SCOPE', '本申请尚未配置有效验收报价授权');
  ensure(matchesPrice({ ...input, depositAmount: input.depositAmount ?? 1 }, scope), 409, 'ACCEPTANCE_PRICE_MISMATCH', '验收报价须为约定日期的12期各0.01元及押金0.01元');
  return { depositAmount: 1, acceptancePricing: snapshotSchema.parse({ ruleVersion: 'V1_ONE_FEN', scope, scopeHash: hash(scope), standardDepositAmount: standardDeposit, authorizedBy: actor.id, authorizedAt: new Date().toISOString() }) };
}
function storedSnapshot(final: any) {
  const parsed = snapshotSchema.safeParse(final.acceptancePricing);
  ensure(parsed.success, 409, 'ACCEPTANCE_PRICE_SNAPSHOT', '验收报价授权记录不完整');
  const snapshot = parsed.data;
  // Parse before hashing: PostgreSQL JSONB may reorder object keys.
  ensure(snapshot.scopeHash === hash(snapshot.scope) && matchesPrice(final, snapshot.scope), 409, 'ACCEPTANCE_PRICE_MISMATCH', '验收报价金额、期限或授权范围已变化');
  return snapshot;
}
export function assertFinalPricing(application: any, final: any, standardDeposit: number) {
  if (final.acceptancePricing == null) { ensure(final.depositAmount === standardDeposit, 409, 'CREDIT_REVIEW_REQUIRED', '押金规则已更新，请重新确认最终方案'); return; }
  const snapshot = storedSnapshot(final), current = configuredScope();
  ensure(current && sameApplication(application, current) && sameApplication(application, snapshot.scope) && hash(current) === snapshot.scopeHash && snapshot.standardDepositAmount === standardDeposit, 409, 'ACCEPTANCE_PRICE_SCOPE', '验收授权或信用核验已变化，请重新核对最终方案');
}
export function acceptancePricingDescription(final: any): string {
  if (final?.acceptancePricing == null) return '';
  storedSnapshot(final); return ACCEPTANCE_DESCRIPTION;
}
