const historyFields = new Set(['consents', 'history', 'auditLogs', 'events', 'statusHistory', 'changeHistory']);
export function detailSections(entity: Record<string, unknown>) {
  const details: Record<string, unknown> = {}, history: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity)) (historyFields.has(key) ? history : details)[key] = value;
  return { details, history };
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function detailSummary(entity: Record<string, unknown>): Record<string, unknown> {
  const plan = object(entity.finalPlan ?? entity.finalPlanSnapshot), customer = object(entity.customer), vehicle = object(entity.vehicle);
  const candidates = { title: entity.title ?? entity.name ?? entity.sealName, customerName: customer.name, vehicleTitle: vehicle.title, customerId: entity.customerId, orderId: entity.orderId, monthlyFeeAmount: entity.monthlyFeeAmount ?? plan.monthlyFeeAmount, depositAmount: entity.depositAmount ?? plan.depositAmount, amount: entity.amount, months: entity.months ?? plan.months, startDate: entity.startDate ?? plan.startDate, endDate: entity.endDate ?? plan.endDate, sourceFileId: entity.sourceFileId, signedFileId: entity.signedFileId, createdAt: entity.createdAt };
  return Object.fromEntries(Object.entries(candidates).filter(([, value]) => value !== undefined && value !== null && value !== '' && typeof value !== 'object'));
}
