import type { Field } from './resources';
const roles = ['FIELD', 'OPERATIONS', 'FINANCE', 'SUPPORT', 'ADMIN'];
const revision: Field = { key: 'revision', label: '当前人员版本', type: 'number', readOnly: true, required: true, min: 0 };
const reason: Field = { key: 'reason', label: '操作原因', type: 'textarea', required: true };
export const staffEditFields: Field[] = [{ key: 'name', label: '姓名', required: true }, revision];
export function staffCommandFields(command: string): Field[] { return [revision, reason, ...(command === 'role' ? [{ key: 'role', label: '调整后角色', type: 'select' as const, required: true, options: roles.map(role => [role, ({ FIELD: '现场交接', OPERATIONS: '运营', FINANCE: '财务', SUPPORT: '客服', ADMIN: '管理员' } as Record<string, string>)[role]] as [string, string]) }] : []), ...(command === 'reset-password' ? [{ key: 'newPassword', label: '新密码', type: 'password' as const, required: true, minLength: 8, maxLength: 256 }] : [])]; }
export function staffPayload(command: string, body: Record<string, unknown>, idempotencyKey?: string): Record<string, unknown> {
  if (!idempotencyKey || idempotencyKey.length < 8) throw new Error('业务请求编号缺失，请重新打开表单');
  if (command !== 'create' && (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0)) throw new Error('当前人员版本缺失，请刷新详情');
  if (['create', 'role'].includes(command) && !roles.includes(String(body.role))) throw new Error('请选择固定角色');
  const keys = command === 'create' ? ['username', 'name', 'role', 'password'] : command === 'edit' ? ['name', 'revision'] : ['revision', 'reason', ...(command === 'role' ? ['role'] : []), ...(command === 'reset-password' ? ['newPassword'] : [])];
  return { ...Object.fromEntries(keys.filter(key => body[key] !== undefined).map(key => [key, body[key]])), idempotencyKey };
}
