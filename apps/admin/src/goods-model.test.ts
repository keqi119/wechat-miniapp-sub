import test from 'node:test';
import assert from 'node:assert/strict';
import {goodsAccess,goodsCreatePayload,goodsDisplayPayload,publishedGoodsVersions,goodsStatusLabel} from './goods-model.ts';
import {routeAllowed,moduleForRoute,navigationFor} from './modules/navigation.ts';
import {recordLocation,updateListLocation,processHref} from './process-navigation.ts';

test('goods needs an operator role and explicit server permission; internal plans have no navigation or deep-link authorization',()=>{
 for(const role of ['ADMIN','OPERATIONS']){
  assert.deepEqual(goodsAccess(role,['goods.read']),{read:true,write:false,create:false});
  assert.deepEqual(goodsAccess(role,['goods.read','goods.write','vehicles.read','products.read']),{read:true,write:true,create:true});
  assert.equal(routeAllowed('goods',role,['goods.read']),true);
  assert.equal(routeAllowed('goods',role,['products.read','plans.read']),false);
  assert.equal(routeAllowed('plans',role,['plans.read']),false);
  assert.equal(routeAllowed('plans',role,['*']),false);
  assert.equal(navigationFor(role).flatMap(module=>module.views).some(view=>view.key==='plans'),false);
 }
 for(const role of ['FINANCE','SUPPORT','FIELD',undefined])assert.deepEqual(goodsAccess(role,['*']),{read:false,write:false,create:false});
 assert.equal(moduleForRoute('plans'),undefined);
});
test('creation binds only a published explicit version and display settings, never price, source or publication',()=>{
 const source=[{id:'product',versions:[{id:'draft',status:'DRAFT',version:3,name:'草稿'},{id:'published',status:'PUBLISHED',version:2,name:'城市订阅',monthlyFeeAmount:123456},{id:'retired',status:'RETIRED',version:1,name:'旧版本'}]}];
 const versions=publishedGoodsVersions(source);assert.deepEqual(versions.map(v=>v.id),['published']);
 const input={vehicleId:'car',productVersionId:'published',visible:true,recommended:false,sortOrder:'12',monthlyFeeAmount:1,source:'LEGACY_MIGRATED',status:'PUBLISHED'};
 assert.deepEqual(goodsCreatePayload(input,versions),{vehicleId:'car',productVersionId:'published',visible:true,recommended:false,sortOrder:12,revision:0});
 assert.throws(()=>goodsCreatePayload({...input,productVersionId:'draft'},versions),/已发布/);
 assert.throws(()=>goodsDisplayPayload({...input,sortOrder:'1.5'}),/整数/);
 assert.throws(()=>goodsDisplayPayload({...input,sortOrder:'-1'}),/非负整数/);
 assert.deepEqual(goodsDisplayPayload(input),{visible:true,recommended:false,sortOrder:12});
 assert.equal(goodsStatusLabel('WITHDRAWN'),'方案已下架');assert.equal(goodsStatusLabel('FUTURE'),'未知状态');
});
test('goods detail and list locations preserve filters and return navigation',()=>{
 assert.equal(recordLocation('#goods?keyword=ET5&status=DRAFT&page=2','good-1'),'#goods?keyword=ET5&status=DRAFT&page=2&record=good-1');
 assert.equal(updateListLocation('#goods',{keyword:'本地',status:'PUBLISHED',page:2}),'#goods?keyword=%E6%9C%AC%E5%9C%B0&status=PUBLISHED&page=2');
 assert.ok(processHref('#products?record=product-1','#goods?record=good-1').includes('returnTo='));
});
