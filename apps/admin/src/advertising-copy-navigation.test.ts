import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moduleForRoute,navigationFor,routeAllowed,routeVisible} from './modules/navigation.ts';

test('advertising copy is a distinct product center entry for administrators and operations',()=>{
 for(const role of ['ADMIN','OPERATIONS']){
  const module=navigationFor(role).find(item=>item.key==='products');
  assert(module?.views.some(item=>item.key==='advertising-copy'&&item.label==='广告词'&&item.permission==='advertising-copy.read'));
  assert.equal(routeAllowed('advertising-copy',role,['advertising-copy.read']),true);
  assert.equal(routeAllowed('advertising-copy',role,['products.read']),false);
 }
 assert.equal(moduleForRoute('advertising-copy')?.key,'products');
});
test('direct advertising routes remain unavailable to finance, support and field even with a wildcard',()=>{
 for(const role of ['FINANCE','SUPPORT','FIELD',undefined]){
  assert.equal(routeAllowed('advertising-copy',role,['*']),false);
  assert.equal(routeVisible('advertising-copy',role,['*']),false);
 }
});
