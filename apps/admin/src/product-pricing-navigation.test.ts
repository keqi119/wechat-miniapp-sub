import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleForRoute,routeAllowed,navigationFor} from './modules/navigation.ts';

test('pricing reference is a product-center entry with its own permission',()=>{
 for(const role of ['ADMIN','OPERATIONS','FINANCE']){
  assert.equal(routeAllowed('pricing-reference',role,['pricing-reference.read']),true);
  assert.equal(routeAllowed('pricing-reference',role,['products.read']),false);
  assert(navigationFor(role).find(m=>m.key==='products')?.views.some(v=>v.key==='pricing-reference'));
 }
 assert.equal(moduleForRoute('pricing-reference')?.key,'products');
 for(const role of ['SUPPORT','FIELD',undefined])assert.equal(routeAllowed('pricing-reference',role,['*']),false);
});
