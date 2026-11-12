import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleForRoute,routeAllowed} from './modules/navigation.ts';
import {processHref,recordLocation} from './process-navigation.ts';

test('overdue and collection routes require financial role and their exact read grant',()=>{
 for(const route of ['overdue-bills','collection-cases']){
  assert.equal(moduleForRoute(route)?.key,'finance');
  for(const role of ['ADMIN','FINANCE']){
   assert.equal(routeAllowed(route,role,[route+'.read']),true);
   assert.equal(routeAllowed(route,role,['bills.read']),false);
  }
  for(const role of ['OPERATIONS','SUPPORT','FIELD'])assert.equal(routeAllowed(route,role,['*']),false);
 }
 assert.equal(recordLocation('#collection-cases?page=3&status=ACTIVE','case-1'),'#collection-cases?page=3&status=ACTIVE&record=case-1');
 assert.match(processHref('#overdue-bills?page=2&status=D2','#collection-cases?record=case-1'),/returnTo=/);
});
