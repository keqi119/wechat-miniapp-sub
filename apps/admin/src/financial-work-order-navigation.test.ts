import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleForRoute,routeAllowed} from './modules/navigation.ts';
import {recordLocation,processHref} from './process-navigation.ts';

test('work-order financial route uses its API permission and remains unavailable to non-financial roles',()=>{
 assert.equal(moduleForRoute('work-order-costs')?.key,'finance');
 for(const role of ['ADMIN','FINANCE']){
  assert.equal(routeAllowed('work-order-costs',role,['asset-work-order-costs.read']),true);
  assert.equal(routeAllowed('work-order-costs',role,['asset-work-orders.read']),false);
 }
 for(const role of ['OPERATIONS','FIELD','SUPPORT'])assert.equal(routeAllowed('work-order-costs',role,['*']),false);
 assert.equal(recordLocation('#work-order-costs?page=2','work'),'#work-order-costs?page=2&record=work');
 assert.match(processHref('#work-order-costs?record=work','#asset-cost-plans?record=plan'),/returnTo=/);
});
