import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationFor, moduleForRoute, routeAllowed, routeVisible, resourceHref, orderSections, orderSectionData, declaredActions, roleDetail } from './modules/navigation.ts';

test('simple cooperation role access stays discoverable without defaulting to legacy signing', () => {
  for (const role of ['ADMIN', 'OPERATIONS']) {
    const views = navigationFor(role).find(m => m.key === 'vehicles')!.views.filter(v => routeVisible(v.key, role, ['*'], []));
    assert.equal(views.some(view => view.key === 'partners'), true);
    assert.equal(routeAllowed('partners', role, ['*'], []), true);
    assert.equal(routeVisible('partner-rules', role, ['*'], []), false);
  }
  for (const role of ['FIELD', 'CUSTOMER', undefined]) assert.equal(routeVisible('partners', role, ['*'], ['partner.cooperation.read']), false);
  assert.equal(routeVisible('partners', 'SUPPORT', ['*'], []), false);
  assert.equal(routeVisible('partners', 'FINANCE', [], ['partner.cooperation.read']), false);
});

test('ADMIN groups implemented business modules with customers first and independent finance', () => {
  const nav = navigationFor('ADMIN');
  assert.deepEqual(nav.filter(item => item.kind === 'business').map(item => item.key), ['customers', 'vehicles', 'depreciation', 'products', 'goods', 'orders', 'contract-center', 'finance']);
  assert.deepEqual(nav.filter(item => item.kind === 'shared').map(item => item.key), ['dashboard', 'settings']);
  assert.deepEqual(nav.map(item => item.label), ['驾驶舱', '客户管理', '车辆管理', '折旧管理', '产品中心', '商品中心', '订单管理中心', '合同管理中心', '财务管理', '系统管理']);
  assert.equal(moduleForRoute('goods')?.key, 'goods');
  assert.equal(moduleForRoute('plans'), undefined);
  assert.equal(routeAllowed('plans','ADMIN',['*']),false);
  for (const route of ['bills', 'payments', 'deposits', 'refunds', 'return-settlements']) assert.equal(moduleForRoute(route)?.key, 'finance');
  for (const route of ['partners', 'insurance', 'insurance-renewals', 'vehicle-owners', 'partner-rules', 'partner-settlements']) assert.equal(moduleForRoute(route)?.key, 'vehicles');
  assert.equal(moduleForRoute('notifications')?.key, 'orders');
  assert.equal(moduleForRoute('benefit-definitions')?.key, 'products');
});
test('regrouped finance and vehicle deep links retain permission and role boundaries', () => {
  for (const route of ['bills', 'payments', 'deposits', 'refunds', 'return-settlements']) {
    assert.equal(routeAllowed(route, 'FINANCE', [route + '.read']), true);
    assert.equal(routeAllowed(route, 'FINANCE', []), false);
    assert.equal(routeAllowed(route, 'SUPPORT', ['*']), false);
  }
  for (const route of ['insurance', 'coverage-requirements', 'vehicle-owners', 'customer-risk']) assert.equal(routeAllowed(route, 'FINANCE', ['*']), false);
  assert.equal(routeAllowed('notifications', 'SUPPORT', ['notifications.read']), true);
  assert.equal(routeAllowed('notifications', 'SUPPORT', []), false);
  assert.equal(routeAllowed('contracts', 'OPERATIONS', ['contracts.read']), false);
  assert.equal(routeAllowed('contract-center', 'OPERATIONS', ['contracts.read']), false);
});
test('unknown and FIELD roles receive no full-admin navigation even with wildcard permissions', () => {
  for (const role of ['FIELD', 'CUSTOMER', undefined]) {
    assert.deepEqual(navigationFor(role), []);
    assert.equal(routeAllowed('orders', role, ['*']), false);
  }
});
test('FINANCE cannot enter risk detail, SUPPORT cannot enter revenue or payment views', () => {
  assert.equal(routeAllowed('customer-risk', 'FINANCE', ['*']), false);
  assert.equal(routeAllowed('applications', 'FINANCE', ['*']), false);
  assert.equal(routeAllowed('partner-settlements', 'FINANCE', ['*']), false);
  for (const route of ['partner-rules', 'partner-settlements', 'bills', 'payments', 'refunds']) assert.equal(routeAllowed(route, 'SUPPORT', ['*']), false);
  assert.equal(routeAllowed('services', 'SUPPORT', ['services.read']), true);
  assert.equal(routeAllowed('services', 'SUPPORT', []), false);
});
test('server permission declaration is required in addition to fixed role access', () => {
  assert.equal(routeAllowed('insurance', 'OPERATIONS', ['vehicles.read']), false);
  assert.equal(routeAllowed('insurance', 'OPERATIONS', ['insurance-policies.read']), true);
  assert.equal(routeAllowed('vehicles', 'OPERATIONS', ['vehicles.read']), true);
  assert.equal(routeAllowed('benefit-definitions', 'OPERATIONS', ['benefit-definitions.read']), true);
  assert.equal(routeAllowed('benefit-definitions', 'OPERATIONS', ['products.read']), false);
  assert.equal(routeAllowed('benefit-definitions', 'SUPPORT', ['*']), false);
  assert.equal(routeVisible('benefit-definitions', 'OPERATIONS', ['benefit-definitions.read']), false);
  assert.equal(moduleForRoute('coverage-requirements'), undefined);
  assert.equal(routeAllowed('coverage-requirements', 'OPERATIONS', ['coverage-requirements.read']), false);
  assert.equal(routeAllowed('coverage-requirements', 'SUPPORT', ['*']), false);
});
test('read-only order roles keep the execution mode needed to render workflow without private details',()=>{
  for(const role of ['FINANCE','SUPPORT']){
    const value=roleDetail('orders',{id:'o',contractMode:'OFFLINE',privateData:'secret'},role);
    assert.equal(value.contractMode,'OFFLINE');assert.equal(value.privateData,undefined);
  }
});
test('cross-module links preserve the same resource ID and explicit view', () => {
  const id = 'archive/同一档案';
  assert.equal(resourceHref('offline-archives', id, 'cooperation'), '#offline-archives?record=archive%2F%E5%90%8C%E4%B8%80%E6%A1%A3%E6%A1%88&view=cooperation');
  assert.equal(resourceHref('orders', 'order-1', 'funds'), '#orders?record=order-1&view=funds');
});
test('order workspace has seven fixed sections and uses only authoritative section data', () => {
  assert.deepEqual(orderSections.map(section => section.label), ['概览', '方案', '合同', '资金', '交还车', '用车服务', '记录']);
  const entity = { id: 'o', status: 'ACTIVE', finalPlanSnapshot: { monthlyFeeAmount: 100 }, contract: { archiveId: 'same-archive' }, bills: [{ id: 'b' }], events: [{ action: 'CREATED' }] };
  assert.deepEqual(orderSectionData(entity, 'plan'), { finalPlanSnapshot: entity.finalPlanSnapshot });
  assert.deepEqual(orderSectionData(entity, 'contracts'), { contract: entity.contract });
  assert.deepEqual(orderSectionData(entity, 'funds'), { bills: entity.bills });
  assert.deepEqual(orderSectionData(entity, 'records'), { events: entity.events });
  assert.deepEqual(orderSectionData(entity, 'handover'), {});
});
test('missing server action declarations never imply a ready business action', () => {
  assert.deepEqual(declaredActions({ id: 'a', status: 'DRAFT' }), []);
  assert.deepEqual(declaredActions({ id: 'a', allowedActions: ['SUBMIT', 'REVIEW'], actions: ['MOCK'] }), ['SUBMIT', 'REVIEW']);
});
test('SUPPORT projections never render identity, risk, revenue or payment detail fields', () => {
  const source = { id: 'o', status: 'ACTIVE', customerId: 'c', profile: { idCardNo: 'private' }, riskReview: { reason: 'internal' }, bills: [{ id: 'money' }], finalPlanSnapshot: { monthlyFeeAmount: 100, revenueRatioBps: 900, creditBand: 'private' }, customer: { id: 'c', name: '姓名', idCardNo: 'private' } };
  const projected = roleDetail('orders', source, 'SUPPORT');
  assert.deepEqual(projected, { id: 'o', status: 'ACTIVE', customerId: 'c', finalPlanSnapshot: { monthlyFeeAmount: 100 }, customer: { id: 'c', name: '姓名' } });
  assert.deepEqual(roleDetail('customers', source, 'SUPPORT'), { id: 'o', status: 'ACTIVE' });
  assert.deepEqual(roleDetail('orders', source, 'ADMIN'), source);
});
