import test from 'node:test';
import assert from 'node:assert/strict';
import { applicableVehicles, batchAction } from './goods-batch-model.ts';

test('产品同时适配指定车辆和车型，去重且不包含其他车辆',()=>{
 const cars=[{id:'a',modelDefinitionId:'m1'},{id:'b',modelDefinitionId:'m2'},{id:'c',modelDefinitionId:'m3'}];
 assert.deepEqual(applicableVehicles({vehicleIds:['a'],modelDefinitionIds:['m1','m2']},cars).map(x=>x.id),['a','b']);
});
test('发布和下架仅处理所选产品版本的正确状态',()=>{
 assert.equal(batchAction('publish',undefined),'create');
 assert.equal(batchAction('publish','DRAFT'),'publish');
 assert.equal(batchAction('publish','WITHDRAWN'),'publish');
 assert.equal(batchAction('publish','PUBLISHED'),'skip');
 assert.equal(batchAction('withdraw','PUBLISHED'),'withdraw');
 assert.equal(batchAction('withdraw','DRAFT'),'skip');
 assert.throws(()=>batchAction('publish','UNKNOWN'));
});
