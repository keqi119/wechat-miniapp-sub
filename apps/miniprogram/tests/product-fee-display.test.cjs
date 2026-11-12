const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApi}=require('../src/services/api');
const config=require('../src/config');
const {renderPage}=require('./helpers/wxml-view.cjs');

async function displayed(extra={}) {
  const source={id:'qa-product',available:true,configurationVersion:2,monthlyFeeAmount:429900,baseFeeAmount:399900,mileageMonthlyFeeAmount:30000,excessMileagePriceAmount:150,swapPolicy:{version:2,period:'TERM',includedCount:1,extraFeeAmount:80000},...extra};
  const api=createApi(config,req=>req.success({statusCode:200,data:{vehicle:{id:'qa-car',available:true},plans:[source]}}),{getStorageSync:()=>null});
  return (await api.getVehicle('qa-car')).plans[0];
}
test('product fees display exact integer-cent components without changing the selected sale total',async()=>{
  const plan=await displayed();
  assert.deepEqual(plan.monthlyFeeParts,[{label:'基础使用费',amountText:'¥3,999.00'},{label:'里程包月费',amountText:'¥300.00'}]);
  assert.equal(plan.monthlyFeeText,'¥4,299.00');
  assert.equal(plan.excessMileagePriceText,'¥1.50');
  assert.equal(plan.swapIncludedText,'合同期内赠送 1 次');
  assert.equal(plan.swapExtraFeeText,'¥800.00 / 次');
  const text=renderPage('vehicle',{loading:false,error:'',vehicle:{id:'qa-car',available:true},plans:[plan],selectedPlan:plan});
  for(const s of ['基础使用费','里程包月费','超里程单价','合同期内赠送 1 次','¥800.00 / 次'])assert.ok(text.includes(s),s);
});
test('zero mileage fees and included swap count remain zero and are not described as missing',async()=>{
  const plan=await displayed({monthlyFeeAmount:100,baseFeeAmount:100,mileageMonthlyFeeAmount:0,excessMileagePriceAmount:0,swapPolicy:{version:2,period:'TERM',includedCount:0,extraFeeAmount:100}});
  assert.equal(plan.monthlyFeeParts[1].amountText,'¥0.00');
  assert.equal(plan.excessMileagePriceText,'¥0.00');
  assert.equal(plan.swapExtraFeeText,'¥1.00 / 次');
  assert.equal(plan.swapIncludedText,'合同期内赠送 0 次');
});
test('legacy or inconsistent component data never invents a fee split or a swap entitlement',async()=>{
  for(const patch of [{configurationVersion:1},{mileageMonthlyFeeAmount:29999},{baseFeeAmount:-1},{baseFeeAmount:399900.5}]){
    const plan=await displayed(patch);assert.deepEqual(plan.monthlyFeeParts,[]);assert.equal(plan.monthlyFeeText,'¥4,299.00');
  }
  const plan=await displayed({swapPolicy:{includedCount:1.5,extraFeeAmount:-1},excessMileagePriceAmount:null});
  assert.equal(plan.swapIncludedText,'');assert.equal(plan.swapExtraFeeText,'');assert.equal(plan.excessMileagePriceText,'');
});
