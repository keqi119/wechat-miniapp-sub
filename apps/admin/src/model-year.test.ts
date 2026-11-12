import test from 'node:test';
import assert from 'node:assert/strict';
import {resources,modelYearPayload} from './resources.ts';
import {serializeForm} from './form.ts';
test('model form converts only an explicit year and leaves unregistered years null',()=>{
 const fields=resources.find(resource=>resource.key==='model-definitions')!.fields!;
 const base={brand:'合成',name:'车型',bodyType:'SUV',description:'说明',modelYear:''};
 assert.equal(modelYearPayload(serializeForm(fields,base)).modelYear,null);assert.equal(modelYearPayload(serializeForm(fields,{...base,modelYear:'2024'})).modelYear,2024);
 for(const modelYear of ['1899','2101','20.4','202x','2024.5','+2024'])assert.throws(()=>modelYearPayload({modelYear}));
 assert.equal(modelYearPayload({modelYear:'1900'}).modelYear,1900);assert.equal(modelYearPayload({modelYear:'2100'}).modelYear,2100);
 assert.equal(resources.find(resource=>resource.key==='vehicles')!.fields!.find(field=>field.key==='year')!.label,'上牌年份');
});
test('legal template picker distinguishes product-priced swap credits from unrelated templates',()=>{
 const type=resources.find(resource=>resource.key==='legal-documents')!.fields!.find(field=>field.key==='type')!;assert.ok(type.options!.some(([value,label])=>value==='swap-credit-v2'&&label==='换车次数购买说明（产品价）'));
});
