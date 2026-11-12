import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleForRoute,routeAllowed} from './modules/navigation.ts';
import {recordLocation,processHref} from './process-navigation.ts';

test('internal work and maintenance routes require their exact role and read grant',()=>{
 for(const route of ['asset-work-orders','vehicle-maintenance']){
  assert.equal(moduleForRoute(route)?.key,'vehicles');
  for(const role of ['ADMIN','OPERATIONS']){
   assert.equal(routeAllowed(route,role,[route+'.read']),true);
   assert.equal(routeAllowed(route,role,[]),false);
  }
  assert.equal(routeAllowed(route,'FINANCE',[route+'.read']),route==='asset-work-orders');
  for(const role of ['SUPPORT','FIELD'])assert.equal(routeAllowed(route,role,['*']),false);
  assert.equal(recordLocation('#'+route+'?page=2','saved'),'#'+route+'?page=2&record=saved');
  assert.match(processHref('#'+route+'?record=saved','#vehicles?record=v'),/returnTo=/);
 }
});
