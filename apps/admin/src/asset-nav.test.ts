import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleForRoute,routeAllowed} from './modules/navigation.ts';
import {processHref} from './process-navigation.ts';
test('asset routes use explicit server permissions and preserve field/support exclusions',()=>{
 for(const route of ['baas-contracts','asset-cost-plans','asset-costs']){assert.equal(routeAllowed(route,'ADMIN',[route+'.read']),true);assert.equal(routeAllowed(route,'ADMIN',[]),false);assert.equal(routeAllowed(route,'SUPPORT',['*']),false);assert.equal(routeAllowed(route,'FIELD',['*']),false);}
 assert.equal(moduleForRoute('baas-contracts')?.key,'vehicles');assert.equal(moduleForRoute('asset-cost-plans')?.key,'finance');assert.equal(moduleForRoute('asset-costs')?.key,'finance');assert.equal(routeAllowed('baas-contracts','FINANCE',['baas-contracts.read']),true);assert.equal(routeAllowed('asset-cost-plans','OPERATIONS',['asset-cost-plans.read']),true);assert.equal(routeAllowed('asset-costs','OPERATIONS',['*']),false);
});
test('asset detail links preserve return position through the established route whitelist',()=>{
 for(const route of ['baas-contracts','asset-cost-plans','asset-costs'])assert.match(processHref('#'+route+'?record=target','#vehicles?record=vehicle&page=3'),/returnTo=/);
});
