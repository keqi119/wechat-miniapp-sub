import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationFor, moduleForRoute, routeAllowed, routeVisible } from './modules/navigation.ts';
import { presentationFor } from './navigation-group-model.ts';

const routes = ['depreciation-policies', 'residual-observations', 'residual-imports', 'residual-curves', 'residual-forecasts', 'vehicle-valuations'];
test('depreciation deep links belong to one independent group and retain each business permission', () => {
  for (const role of ['ADMIN', 'OPERATIONS', 'FINANCE']) {
    const expected = role === 'OPERATIONS' ? routes.slice(1) : routes;
    const navigation = navigationFor(role);
    const group = navigation.find(item => item.key === 'depreciation');
    assert.equal(group?.label, '折旧管理');
    assert.deepEqual(group?.views.map(view => view.key), expected);
    assert.equal(navigation.find(item => item.key === 'vehicles')?.views.some(view => routes.includes(view.key)), false);
    for (const route of expected) {
      assert.equal(moduleForRoute(route)?.key, 'depreciation');
      assert.equal(navigation.flatMap(item => item.views).filter(view => view.key === route).length, 1);
      assert.equal(routeAllowed(route, role, [route + '.read']), true);
      assert.equal(routeAllowed(route, role, ['vehicles.read']), false);
      assert.equal(presentationFor(navigation, `#${route}?record=synthetic&view=history`).selectedRoute, route);
    }
  }
  assert.equal(routeAllowed('depreciation-policies', 'OPERATIONS', ['*']), false);
  for (const role of ['SUPPORT', 'FIELD', 'CUSTOMER', undefined]) {
    assert.equal(navigationFor(role).some(item => item.key === 'depreciation'), false);
    for (const route of routes) assert.equal(routeVisible(route, role, ['*']), false);
  }
});
