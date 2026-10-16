import { moneyToCents, type Entity } from './core.ts';
import type { Action, Field } from './resources.ts';
import { statusLabel } from './resources.ts';
import { parseCommercialTerms, handoverFactLabels } from './business-terms.ts';
import { parseShanghaiDateTime } from './usage.ts';
export function serializeForm(fields: Field[], values: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.submit === false) continue;
    const value = values[field.key] ?? '';
    if (field.required && !value.trim()) throw new Error(`请填写${field.label}`);
    if (field.type === 'password' && !value) continue;
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
  if (resource === 'mileages') return (action.fields ?? []).filter(field => field.key !== 'boundaryConfirmed' || !!entity.periodId || !!entity.segmentId);
  if (resource === 'esign-approvals' && action.path === 'renew') return (action.fields ?? []).map(field => field.key === 'policyId' ? { ...field, sourceFilters: { status: 'ACTIVE', kind: String(entity.kind), sealId: String(entity.sealId) }, hint: '选择已启用、文档类型一致且使用原印章的策略；服务端核验原任务企业身份不变' } : field);
  if (resource !== 'services' || action.path !== 'status') return action.fields ?? [];
  const transitions: Record<string, string[]> = { SUBMITTED: ['ACCEPTED', 'CANCELLED'], ACCEPTED: ['CANCELLED'], ASSIGNED: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['COMPLETED'] };
  return (action.fields ?? []).map(field => field.key === 'status' ? { ...field, options: (transitions[String(entity.status)] ?? []).map(status => [status, statusLabel(status)] as [string, string]) } : field);
}
export function mutationPayload(resource: string, kind: string, body: Record<string, unknown>, idempotencyKey?: string): Record<string, unknown> {
  if(resource==='swap-credit-purchases'&&kind==='action'){if(!idempotencyKey||idempotencyKey.length<8)throw new Error('业务请求编号缺失，请重新打开表单');return{idempotencyKey};}
  if (!(['refunds', 'bills'].includes(resource) && kind === 'create') && !(['usage-periods', 'return-settlements'].includes(resource) && kind === 'action')) return body;
  if (!idempotencyKey || idempotencyKey.length < 8) throw new Error('业务请求编号缺失，请关闭表单后重新发起');
  return { ...body, idempotencyKey };
}
