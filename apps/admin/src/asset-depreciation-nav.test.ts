import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleForRoute,routeAllowed} from './modules/navigation.ts';
import {processHref} from './process-navigation.ts';
test('depreciation belongs to vehicles with explicit finance/admin permission and valid return links',()=>{
 assert.equal(moduleForRoute('depreciation-policies')?.key,'vehicles');
 for(const role of ['ADMIN','FINANCE']){assert.equal(routeAllowed('depreciation-policies',role,['depreciation-policies.read']),true);assert.equal(routeAllowed('depreciation-policies',role,[]),false);}
 for(const role of ['OPERATIONS','SUPPORT','FIELD'])assert.equal(routeAllowed('depreciation-policies',role,['*']),false);
 assert.match(processHref('#depreciation-policies?record=policy','#vehicles?record=vehicle&page=3'),/returnTo=/);
});
