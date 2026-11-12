import { moneyToCents, type Entity } from './core.ts';
import type { Action, Field } from './resources.ts';
import { statusLabel } from './resources.ts';
import { parseCommercialTerms, handoverFactLabels } from './business-terms.ts';
import { parseShanghaiDateTime } from './usage.ts';
import { scopedAcceptanceOffer, type CreditReview } from './credit.ts';
export function serializeForm(fields: Field[], values: Record<string, string>): Record<string, unknown> {
  if (['V1_ONE_FEN','V2_ONE_YUAN'].includes(values.pricingMode) && !fields.find(field => field.key === 'pricingMode')?.options?.some(option => option[0] === values.pricingMode)) throw new Error('本单验收报价授权已失效，请刷新并重新核对报价方式');
  const body: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.submit === false) continue;
    const raw = values[field.key] ?? '';
    const value = field.key==='vin'?raw.trim().toUpperCase():raw;
    if (field.required && !value.trim()) throw new Error(`请填写${field.label}`);
    if (field.type === 'password' && !value) continue;
    if (field.minLength !== undefined && value.length < field.minLength) throw new Error(`${field.label}至少需要${field.minLength}位`);
    if (field.maxLength !== undefined && value.length > field.maxLength) throw new Error(`${field.label}最多允许${field.maxLength}位`);
    if(field.key==='vin'&&value&&!/^[A-HJ-NPR-Z0-9]{17}$/.test(value))throw new Error('请填写17位有效VIN，不能包含I、O、Q');
    if (field.type === 'commercial') body[field.key] = parseCommercialTerms(value);
    else if (field.type === 'money') body[field.key] = moneyToCents(value);
    else if (field.type === 'datetime-local') body[field.key] = parseShanghaiDateTime(value);
    else if (field.type === 'number') {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || (field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) throw new Error(`${field.label}超出范围或不是有效整数`);
      body[field.key] = n;
    } else if (field.type === 'attestation') { if (value !== 'true') throw new Error(`请确认：${field.label}`); body[field.key] = true; }
    else if (field.type === 'boolean') body[field.key] = value === 'true';
    else if (field.type === 'lines' || (field.type === 'files' && !field.key.endsWith('FileId'))) body[field.key] = value.split('\n').map(item => item.trim()).filter(Boolean);
    else if (field.type === 'checklist') {
      const rows: unknown = JSON.parse(value);
      if (!Array.isArray(rows) || !rows.length || rows.length > 100 || rows.some(row => !row || typeof row.label !== 'string' || typeof row.value !== 'string' || !row.label.trim() || !row.value.trim())) throw new Error('请至少填写一项完整交接检查记录');
      if (field.requireFacts) for (const [key, label] of Object.entries(handoverFactLabels)) if (rows.filter(row => row.label === key).length !== 1) throw new Error(`请完整填写且勿重复交接事实：${label}`);
      body[field.key] = rows;
    } else if (field.key === 'coverFileId') body[field.key] = value || null;
    else if (value || field.required || field.type === 'textarea') body[field.key] = value;
  }
  return body;
}
export function fieldsForAction(resource: string, action: Action, entity: Entity): Field[] {
  if (resource === 'applications' && action.path === 'final-plan') {
    const available = scopedAcceptanceOffer(entity.creditReview as CreditReview | undefined, entity.id);
    const final = entity.finalPlan as Record<string, unknown> | undefined;
    const previous = final?.acceptancePricing || final?.pricingMode === 'V1_ONE_FEN' || final?.pricingMode === 'V2_ONE_YUAN';
    return (action.fields ?? []).filter(field => field.key !== 'pricingMode' || !!available || !!previous).map(field => field.key === 'pricingMode' ? { ...field, options: (field.options ?? []).filter(option => option[0] === 'STANDARD' || option[0] === available?.mode) } : field);
  }
  if (resource === 'mileages') return (action.fields ?? []).filter(field => field.key !== 'boundaryConfirmed' || !!entity.periodId || !!entity.segmentId);
  if (resource === 'esign-approvals' && action.path === 'renew') return (action.fields ?? []).map(field => field.key === 'policyId' ? { ...field, sourceFilters: { status: 'ACTIVE', kind: String(entity.kind), sealId: String(entity.sealId) }, hint: '选择已启用、文档类型一致且使用原印章的策略；服务端核验原任务企业身份不变' } : field);
  if (resource !== 'services' || action.path !== 'status') return action.fields ?? [];
  const transitions: Record<string, string[]> = { SUBMITTED: ['ACCEPTED', 'CANCELLED'], ACCEPTED: ['CANCELLED'], ASSIGNED: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['COMPLETED'] };
  return (action.fields ?? []).map(field => field.key === 'status' ? { ...field, options: (transitions[String(entity.status)] ?? []).filter(status => !(entity.viewerRole === 'SUPPORT' && entity.entitlementId && ['COMPLETED', 'CANCELLED'].includes(status))).map(status => [status, statusLabel(status)] as [string, string]) } : field);
}
export function mutationPayload(resource: string, kind: string, body: Record<string, unknown>, idempotencyKey?: string): Record<string, unknown> {
  if(resource==='swap-credit-purchases'&&kind==='action'){if(!idempotencyKey||idempotencyKey.length<8)throw new Error('业务请求编号缺失，请重新打开表单');return{idempotencyKey};}
  if (!(['refunds', 'bills'].includes(resource) && kind === 'create') && !(['usage-periods', 'return-settlements'].includes(resource) && kind === 'action')) return body;
  if (!idempotencyKey || idempotencyKey.length < 8) throw new Error('业务请求编号缺失，请关闭表单后重新发起');
  return { ...body, idempotencyKey };
}
