import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildOfflinePrintModel} from '../src/offline-documents/print';
const input:any={archive:{id:'archive',kind:'RENTAL'},version:{version:2,businessSnapshotHash:'a'.repeat(64)},template:{id:'template',version:1,title:'车辆订阅三方合同',content:'甲方 {{ownerName}}，乙方 {{customerName}}，平台 {{platformName}}。'},context:{requiredSigners:['CUSTOMER','OWNER','PLATFORM'],partiesSnapshot:[{role:'CUSTOMER',partyId:'c',name:'合成客户'},{role:'OWNER',partyId:'o',name:'合成个人车主'},{role:'PLATFORM',partyId:'p',name:'上海宁达信息科技有限公司'}],scopeSnapshot:{vehicleId:'v'},businessSnapshot:{months:12,monthlyFeeAmount:350000,depositAmount:700000,startDate:'2026-11-01',conditions:'明确约定',productSnapshot:{benefits:[{kind:'COUNT',name:'保养',totalQuantity:2,unit:'次',provider:'合作服务商',description:'按期检查',conditions:'提前预约'}]},commercialTerms:{vehicleIdentification:'合成车辆 VIN TEST0001'},riskSnapshot:{secret:'risk-private'},revenueRuleSnapshot:{secret:'revenue-private'}}}};
test('paper print uses labeled parties and terms without exposing internal review or revenue data',()=>{
 const model=buildOfflinePrintModel(input),text=JSON.stringify(model);assert.equal(model.signers.length,3);assert.ok(text.includes('3500.00'));assert.ok(text.includes('7000.00'));assert.ok(text.includes('上海宁达信息科技有限公司'));assert.ok(text.includes('2 次'));assert.ok(!text.includes('risk-private'));assert.ok(!text.includes('revenue-private'));assert.ok(!text.includes('{{'));
});
test('missing signatory or unresolved template placeholder cannot produce a signing print',()=>{
 assert.throws(()=>buildOfflinePrintModel({...input,context:{...input.context,partiesSnapshot:input.context.partiesSnapshot.slice(0,2)}}));
 assert.throws(()=>buildOfflinePrintModel({...input,template:{...input.template,content:'{{unapprovedField}}'}}));
});
