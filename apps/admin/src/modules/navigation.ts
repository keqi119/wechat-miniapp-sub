import { hasPartnerCapability } from '../partner-operations.ts';
export type AdminRole = 'ADMIN' | 'OPERATIONS' | 'FINANCE' | 'SUPPORT' | 'FIELD';
export type ModuleView = { key: string; label: string; permission: string; roles?: AdminRole[] };
export type ModuleNavigation = { key: string; label: string; kind: 'business' | 'shared'; description: string; views: ModuleView[] };
const operators: AdminRole[] = ['ADMIN', 'OPERATIONS'];
export const retiredContractRoutes=new Set(['contracts','enterprise-seals','seal-authorities','signature-policies','esign-approvals','technical-acceptances']);
const view = (key: string, label: string, permission = `${key}.read`, roles?: AdminRole[]): ModuleView => ({ key, label, permission, roles });
const modules: ModuleNavigation[] = [
  { key: 'dashboard', label: '驾驶舱', kind: 'shared', description: '当前待办、责任与阻断项', views: [] },
  { key: 'customers', label: '客户管理', kind: 'business', description: '客户档案、资料核验与本次申请风控', views: [view('customers', '客户档案', undefined, ['ADMIN', 'OPERATIONS', 'SUPPORT']), view('customer-risk', '风控审核', 'applications.read', operators)] },
  { key: 'vehicles', label: '车辆管理', kind: 'business', description: '车辆台账、车型、保单保障与合作商', views: [view('vehicles', '车辆台账'), view('asset-work-orders', '内部工单', 'asset-work-orders.read', ['ADMIN','OPERATIONS','FINANCE']), view('vehicle-maintenance', '保养提醒', 'vehicle-maintenance.read', operators), view('license-plates', '牌照档案', 'license-plates.read', operators), view('baas-contracts', 'BAAS合同', 'baas-contracts.read', ['ADMIN','OPERATIONS','FINANCE']), view('model-definitions', '车型', undefined, operators), view('insurance', '保单档案', 'insurance-policies.read', operators), view('insurance-renewals', '续保待办', 'insurance-policies.read', operators), view('partners', '合作商档案', 'partners.read', operators)] },
  { key: 'depreciation', label: '折旧管理', kind: 'business', description: '折旧策略、市场样本、残值预测与人工估值', views: [view('depreciation-policies', '折旧策略', 'depreciation-policies.read', ['ADMIN','FINANCE']), view('residual-observations', '市场样本', 'residual-observations.read', ['ADMIN','OPERATIONS','FINANCE']), view('residual-imports', 'CSV导入', 'residual-imports.read', ['ADMIN','OPERATIONS','FINANCE']), view('residual-curves', '残值曲线', 'residual-curves.read', ['ADMIN','OPERATIONS','FINANCE']), view('residual-forecasts', '车辆预测', 'residual-forecasts.read', ['ADMIN','OPERATIONS','FINANCE']), view('vehicle-valuations', '人工估值', 'vehicle-valuations.read', ['ADMIN','OPERATIONS','FINANCE'])] },
  { key: 'products', label: '产品中心', kind: 'business', description: '订阅组合、发布版本与服务配置', views: [view('products', '产品工作台', 'products.read', operators), view('product-warehouse', '产品仓库', 'products.read', operators), view('advertising-copy', '广告词', 'advertising-copy.read', operators)] },
  { key: 'goods', label: '商品中心', kind: 'business', description: '车辆与明确产品版本的组合及显式发布', views: [view('goods', '车辆基本套餐', 'goods.read', operators), view('mileage-packs', '里程包', 'addon-products.read', operators), view('swap-addon-products', '换车权益', 'addon-products.read', operators)] },
  { key: 'orders', label: '订单管理中心', kind: 'business', description: '申请、订单、交还车、权益与客户服务', views: [view('orders', '订单列表'), view('applications', '申请与报价', undefined, operators), view('handover-tasks', '现场任务', undefined, operators), view('handovers', '交还车', undefined, operators), view('services', '服务工单'), view('entitlements', '权益管理', undefined, ['ADMIN', 'OPERATIONS', 'SUPPORT']), view('mileages', '里程申报', undefined, operators), view('usage-periods', '里程账户', undefined, ['ADMIN', 'OPERATIONS', 'FINANCE']), view('order-changes', '交车延期', undefined, operators), view('vehicle-changes', '车辆更换', 'order-changes.read', operators), view('order-renewals', '同车续期', 'order-changes.read', ['ADMIN','OPERATIONS','FINANCE']), view('notifications', '通知中心')] },
  { key: 'contract-center', label: '合同管理中心', kind: 'business', description: '合作协议、逐单合同、交还车单与统一档案', views: [view('contract-center', '合同工作台', 'electronic-documents.read', ['ADMIN','OPERATIONS','FINANCE','SUPPORT']), view('legal-documents', '模板与文案', undefined, operators), view('offline-archives', '线下档案', undefined, operators), view('partner-archives', '合作协议依据', 'partner.cooperation.read')] },
  { key: 'finance', label: '财务管理', kind: 'business', description: '账单、收退款、押金与还车结算', views: [view('overdue-bills', '逾期账单', 'overdue-bills.read', ['ADMIN','FINANCE']), view('collection-cases', '催收案件', 'collection-cases.read', ['ADMIN','FINANCE']), view('work-order-costs', '工单费用', 'asset-work-order-costs.read', ['ADMIN','FINANCE']), view('asset-cost-plans', '内部成本计划', 'asset-cost-plans.read', ['ADMIN','OPERATIONS','FINANCE']), view('asset-costs', '内部成本台账', 'asset-costs.read', ['ADMIN','FINANCE']), view('bills', '账单中心', undefined, ['ADMIN', 'OPERATIONS', 'FINANCE']), view('payments', '支付记录', undefined, ['ADMIN', 'OPERATIONS', 'FINANCE']), view('deposits', '押金台账', undefined, ['ADMIN', 'OPERATIONS', 'FINANCE']), view('refunds', '退款审核', undefined, ['ADMIN', 'OPERATIONS', 'FINANCE']), view('return-settlements', '还车结算', undefined, ['ADMIN', 'OPERATIONS', 'FINANCE']), view('swap-credit-purchases', '换车权益购买', undefined, ['ADMIN', 'OPERATIONS', 'FINANCE']), view('payment-verifications', '支付验收', undefined, ['ADMIN'])] },
  { key: 'settings', label: '系统管理', kind: 'shared', description: '人员权限、业务配置与审计', views: [view('settings', '系统概览', 'users.read', ['ADMIN']), view('users', '用户管理', undefined, ['ADMIN']), view('audit-logs', '操作日志', undefined, ['ADMIN'])] },
];
export function navigationFor(role?: string): ModuleNavigation[] {
  if (!['ADMIN', 'OPERATIONS', 'FINANCE', 'SUPPORT'].includes(role ?? '')) return [];
  return modules.map(module => ({ ...module, views: module.views.filter(item => !item.roles || item.roles.includes(role as AdminRole)) })).filter(module => module.key === 'dashboard' || module.views.length > 0);
}
export function moduleForRoute(route: string): ModuleNavigation | undefined { return modules.find(module => module.key === route || module.views.some(item => item.key === route)||module.key==='vehicles'&&['partner-rules','partner-settlements','vehicle-owners'].includes(route)||module.key==='products'&&route==='benefit-definitions'||module.key==='contract-center'&&retiredContractRoutes.has(route)); }
export function routeAllowed(route: string, role: string | undefined, permissions: string[], partnerCapabilities: string[] = []): boolean {
  if(route==='benefit-definitions')return operators.includes(role as AdminRole)&&(permissions.includes('*')||permissions.includes('benefit-definitions.read'));
  if(route==='partners')return ['ADMIN','OPERATIONS'].includes(role??'');
  if(route==='vehicle-owners')return ['ADMIN','OPERATIONS'].includes(role??'')&&(permissions.includes('*')||permissions.includes('vehicle-owners.read'));
  if(route==='partner-settlements'&&hasPartnerCapability({role,partnerCapabilities},'partner.accounts.read'))return true;
  if(['partner-rules','partner-settlements'].includes(route))return hasPartnerCapability({role,partnerCapabilities},route==='partner-rules'?'partner.rules.read':'partner.settlements.read');
  return navigationFor(role).some(module => route === 'dashboard' ? module.key === route : module.views.some(item => item.key === route && (item.permission.startsWith('partner.') ? hasPartnerCapability({role,partnerCapabilities}, item.permission) : permissions.includes('*') || permissions.includes(item.permission))));
}
// The landing page may explain missing grants; this never authorizes domain data.
export function routeVisible(route: string, role: string | undefined, permissions: string[], partnerCapabilities: string[] = []): boolean {
  if (route === 'vehicle-owners' || route === 'benefit-definitions') return false;
  return route === 'partners' && ['ADMIN', 'OPERATIONS'].includes(role ?? '') || routeAllowed(route, role, permissions, partnerCapabilities);
}
export function resourceHref(resource: string, id: string, view: string): string { return `#${resource}?${new URLSearchParams({ record: id, view }).toString()}`; }
export const orderSections = [{ key: 'overview', label: '概览' }, { key: 'plan', label: '方案' }, { key: 'contracts', label: '合同' }, { key: 'funds', label: '资金' }, { key: 'handover', label: '交还车' }, { key: 'services', label: '用车服务' }, { key: 'records', label: '记录' }];
const sectionFields: Record<string, string[]> = { overview: ['id', 'status', 'customer', 'vehicle', 'customerId', 'vehicleId', 'assignee', 'assigneeId', 'blockers', 'allowedActions', 'createdAt'], plan: ['finalPlan', 'finalPlanSnapshot', 'productSnapshot', 'productVersionId', 'benefitSnapshot', 'monthlyFeeAmount', 'depositAmount', 'months', 'startDate'], contracts: ['contract', 'contracts', 'archive', 'archives', 'contractArchiveId', 'archiveId', 'signingMode'], funds: ['bills', 'payments', 'deposits', 'refunds', 'paidAmount', 'outstandingAmount'], handover: ['handovers', 'handover', 'handoverTasks', 'returnReceipt', 'handoverArrangement'], services: ['services', 'serviceRequests', 'entitlements'], records: ['history', 'auditLogs', 'events', 'statusHistory', 'changeHistory'] };
export function orderSectionData(entity: Record<string, unknown>, section: string): Record<string, unknown> { return Object.fromEntries((sectionFields[section] ?? []).filter(key => entity[key] != null).map(key => [key, entity[key]])); }
export function declaredActions(entity: Record<string, unknown>): string[] { return Array.isArray(entity.allowedActions) ? entity.allowedActions.filter((value): value is string => typeof value === 'string') : []; }
export function roleDetail(resource: string, entity: Record<string, unknown>, role?: string): Record<string, unknown> {
  if(resource==='customers'&&!['ADMIN','OPERATIONS'].includes(role||''))return Object.fromEntries(Object.entries(entity).filter(([key])=>['id','status','name','mobile','createdAt','updatedAt'].includes(key)));
  if (!['SUPPORT', 'FINANCE'].includes(role ?? '')) return entity;
  const pick = (value: unknown, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => keys.includes(key))) : undefined;
  const common = ['id', 'status', 'name', 'mobile', 'title', 'type', 'createdAt', 'updatedAt', 'orderId', 'customerId', 'vehicleId', 'assigneeName'];
  if (resource === 'customers') return pick(entity, ['id', 'status', 'name', 'mobile', 'createdAt', 'updatedAt']) ?? {};
  if (resource !== 'orders') return entity;
  const safe = pick(entity, common) ?? {};
  if(['OFFLINE','ESIGN','ELECTRONIC'].includes(String(entity.contractMode)))safe.contractMode=entity.contractMode;
  for (const key of ['finalPlan', 'finalPlanSnapshot']) if (entity[key]) safe[key] = pick(entity[key], ['monthlyFeeAmount', 'depositAmount', 'months', 'startDate', 'firstDueDate', 'mileagePerMonthKm', 'excessMileagePriceAmount', 'energyDescription', 'benefits', 'conditions']);
  if (entity.customer) safe.customer = pick(entity.customer, ['id', 'name', 'mobile']);
  if (entity.vehicle) safe.vehicle = pick(entity.vehicle, ['id', 'title', 'brand', 'model', 'city']);
  if (role === 'FINANCE') for (const key of ['bills', 'payments', 'deposits', 'refunds']) if (Array.isArray(entity[key])) safe[key] = (entity[key] as unknown[]).map(row => {
    const summary=pick(row,['id','orderId','billId','paymentId','type','status','amount','paidAmount','createdAt','paidAt','dueDate']);
    if(key==='bills'&&summary&&row&&typeof row==='object'){
      const publication=pick((row as Record<string,unknown>).publication,['mode','scheduledDate','state','message','blockers']);
      if(publication)summary.publication=publication;
    }
    return summary;
  });
  return safe;
}
