import test from 'node:test';
import assert from 'node:assert/strict';
import {goodsAppDisplayView} from './goods-app-display-model.ts';

test('published and allowed flags never substitute for actual App display',()=>{
 const view=goodsAppDisplayView({visible:false,available:false,state:'NOT_VISIBLE',reasons:[{code:'VEHICLE_NOT_PUBLISHED',message:'车辆尚未上架'}],checkedAt:'2026-11-05T00:00:00Z'});
 assert.equal(view.label,'App 未展示');assert.deepEqual(view.reasons,['车辆尚未上架']);
});
test('visible but unavailable is distinct from hidden and unknown never claims visibility',()=>{
 const view=goodsAppDisplayView({visible:true,available:false,state:'VISIBLE_UNAVAILABLE',reasons:[{code:'VEHICLE_RESERVED',message:'车辆已预留'}],checkedAt:'2026-11-05T00:00:00Z'});
 assert.equal(view.label,'App 可查看，暂不可申请');assert.deepEqual(view.reasons,['车辆已预留']);
 assert.equal(goodsAppDisplayView(undefined).label,'App 展示待核对');
 assert.equal(goodsAppDisplayView({visible:false,available:true,state:'VISIBLE_AVAILABLE',reasons:[],checkedAt:'2026-11-05T00:00:00Z'}).label,'App 展示待核对');
});
