import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderListCell,orderVehicleContext} from './order-list-model.ts';
test('order cells show actual car identity and frozen product/term/money without catalog fallbacks',()=>{
 const row={vehicle:{plateNumber:'沪A12345',brand:'宁达',model:'纯电',vin:'VIN123'},productName:'冻结产品',months:6,monthlyFeeAmount:123456};
 assert.deepEqual(orderListCell(row,'vehicle'),['沪A12345','宁达 纯电','VIN：VIN123']);assert.deepEqual(orderListCell(row,'productName'),['冻结产品']);assert.deepEqual(orderListCell(row,'months'),['6 个月']);assert.deepEqual(orderListCell(row,'monthlyFeeAmount'),['¥1,234.56']);
});
test('incomplete sources are explicit pending verification including zero and malformed amounts',()=>{
 assert.deepEqual(orderListCell({},'vehicle'),['车辆待核']);assert.deepEqual(orderListCell({},'productName'),['产品待核']);assert.deepEqual(orderListCell({},'months'),['期限待核']);assert.deepEqual(orderListCell({},'monthlyFeeAmount'),['月费待核']);assert.deepEqual(orderListCell({monthlyFeeAmount:0},'monthlyFeeAmount'),['¥0.00']);assert.deepEqual(orderListCell({vehicle:{plateNumber:'沪A1'}},'vehicle'),['沪A1','品牌车型待核','VIN 待核']);
});

test('verified returned-car gap is explicit and never described as current use',()=>{assert.equal(orderVehicleContext('SWAP_RETURNED'),'已收回／待新车交付');assert.equal(orderVehicleContext(null),'车辆待核');});
