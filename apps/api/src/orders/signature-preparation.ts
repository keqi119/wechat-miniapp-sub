import { Db } from '../common/db';
import { ensure } from '../common/errors';
export type SigningKind = 'SUBSCRIPTION' | 'HANDOVER' | 'AMENDMENT';
const leaseMs = 45_000;
function fields(kind: SigningKind) { return kind !== 'HANDOVER' ? { model: 'contract', state: 'status', hash: 'documentHash' } : { model: 'handover', state: 'signatureStatus', hash: 'manifestHash' }; }
async function persistedTask(tx: any, kind: SigningKind, item: any) {
  const f = fields(kind);
  const task = await tx.fadadaTask.findUnique({ where: { kind_resourceId_documentHash: { kind, resourceId: item.id, documentHash: item[f.hash] } } });
  if (task) ensure(task.customerId === item.customerId && (!item.providerTaskId || item.providerTaskId === task.id), 409, 'SIGNING_TASK_MISMATCH', '签署任务归属或版本不匹配');
  return task;
}
export async function claimSigning(tx: any, kind: SigningKind, item: any) {
  const f = fields(kind), now = new Date(), task = await persistedTask(tx, kind, item);
  ensure(!item.signingLeaseUntil || item.signingLeaseUntil <= now, 409, 'SIGNATURE_PREPARING', '签署任务正在准备，请稍后查询');
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const claimed = await tx[f.model].updateMany({ where: { id: item.id, [f.state]: item[f.state], [f.hash]: item[f.hash], signingLeaseUntil: item.signingLeaseUntil, providerTaskId: item.providerTaskId }, data: { [f.state]: 'PENDING', signingLeaseUntil: leaseUntil, ...(task ? { providerTaskId: task.id } : {}) } });
  ensure(claimed.count === 1, 409, 'SIGNATURE_PREPARING', '签署准备状态已变化，请刷新');
  return { item, task, leaseUntil };
}
export async function finishSigning(db: Db, kind: SigningKind, item: any, leaseUntil: Date, taskId: string) {
  const f = fields(kind);
  return db.serial(async tx => {
    const current = await (tx as any)[f.model].findUnique({ where: { id: item.id } });
    ensure(current && current[f.hash] === item[f.hash], 409, 'DOCUMENT_MISMATCH', '签署文档版本已变化');
    const task = await persistedTask(tx, kind, current);
    ensure(!task || task.id === taskId, 409, 'SIGNING_TASK_MISMATCH', '签署结果与持久任务不匹配');
    const updated = await (tx as any)[f.model].updateMany({ where: { id: item.id, [f.state]: 'PENDING', [f.hash]: item[f.hash], signingLeaseUntil: leaseUntil, OR: [{ providerTaskId: null }, { providerTaskId: taskId }] }, data: { providerTaskId: taskId, signingLeaseUntil: null } });
    ensure(updated.count === 1, 409, 'SIGNATURE_LEASE_LOST', '签署准备已由其他请求恢复，请刷新状态');
  });
}
export async function failSigning(db: Db, kind: SigningKind, item: any, leaseUntil: Date) {
  const f = fields(kind);
  await db.serial(async tx => {
    const current = await (tx as any)[f.model].findUnique({ where: { id: item.id } });
    if (!current || current[f.hash] !== item[f.hash] || current.signingLeaseUntil?.getTime() !== leaseUntil.getTime()) return;
    const task = await persistedTask(tx, kind, current);
    // The production gateway persists its task before issuing any signing request.
    // A caught precondition failure with no task can return to DRAFT; a process crash
    // leaves PENDING and its lease for a later request to recover.
    await (tx as any)[f.model].updateMany({ where: { id: item.id, [f.state]: 'PENDING', signingLeaseUntil: leaseUntil }, data: { signingLeaseUntil: null, ...(task ? { providerTaskId: task.id } : current.providerTaskId ? {} : { [f.state]: 'DRAFT' }) } });
  });
}
export async function recoverSigning(db: Db, kind: SigningKind, id: string, customerId?: string) {
  const f = fields(kind);
  return db.serial(async tx => {
    let item = await (tx as any)[f.model].findFirst({ where: { id, ...(customerId ? { customerId } : {}) } }); ensure(item, 404, 'NOT_FOUND', '签署记录不存在');
    const task = await persistedTask(tx, kind, item);
    if (task && !item.providerTaskId && item[f.state] === 'PENDING') item = await (tx as any)[f.model].update({ where: { id }, data: { providerTaskId: task.id } });
    const pendingPreparation = item[f.state] === 'PENDING' && (!item.providerTaskId || (task && !task.uploadedAt));
    const retryAfterSeconds = Math.max(0, Math.ceil((Math.max(item.signingLeaseUntil?.getTime() || 0, task?.processingUntil?.getTime() || 0) - Date.now()) / 1000));
    return { item, task, pendingPreparation, state: { status: item[f.state], retryable: Boolean(pendingPreparation && retryAfterSeconds === 0), retryAfterSeconds } };
  });
}
