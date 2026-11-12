import test from 'node:test';
import assert from 'node:assert/strict';
import {routeAllowed,navigationFor} from './modules/navigation.ts';

test('operators can maintain simple partners without the legacy capability list while support cannot',()=>{
 assert.equal(routeAllowed('partners','OPERATIONS',[],[]),true);
 assert.equal(routeAllowed('partners','ADMIN',[],[]),true);
 assert.equal(routeAllowed('partners','SUPPORT',['*'],[]),false);
 assert.equal(navigationFor('OPERATIONS').find(row=>row.key==='vehicles')?.views.some(row=>row.key==='partners'),true);
});
test('partner percentage has no default, accepts explicit zero, rejects excess precision and out of range',async()=>{
 const {partnerPercentageToBps}=await import('./partner-simple-model.ts');
 assert.equal(partnerPercentageToBps(''),null);assert.equal(partnerPercentageToBps('0'),0);assert.equal(partnerPercentageToBps('62.35'),6235);assert.equal(partnerPercentageToBps('100.00'),10000);
 for(const value of ['-1','100.01','2.001','1e2','NaN'])assert.throws(()=>partnerPercentageToBps(value));
});
test('agreement save only confirms selected exact competing bindings and a draft never replaces vehicles',async()=>{
 const {simpleAgreementBody}=await import('./partner-simple-model.ts');
 const values={fileIds:['file'],vehicleIds:['v1'],percentage:'0'},assignments=[{vehicleId:'v1',agreementId:'old',revision:3,active:true},{vehicleId:'v2',agreementId:'unselected',revision:8,active:true}];
 assert.throws(()=>simpleAgreementBody(values,'ACTIVE',null,assignments,[]),/替换/);
 const active=simpleAgreementBody(values,'ACTIVE',null,assignments,['v1','v2']);
 assert.equal(active.partnerRateBps,0);assert.deepEqual(active.replacements,[{vehicleId:'v1',agreementId:'old',revision:3}]);assert.equal(active.revision,0);
 assert.deepEqual(simpleAgreementBody({...values,percentage:''},'DRAFT',null,assignments,['v1']).replacements,[]);
 assert.throws(()=>simpleAgreementBody({...values,percentage:''},'ACTIVE',null,[],[]),/比例/);
 assert.throws(()=>simpleAgreementBody({...values,fileIds:[]},'ACTIVE',null,[],[]),/文件/);
});
test('revenue filters keep historical company vehicles and frozen model labels after reassignment',async()=>{
 const {revenueFilterOptions}=await import('./partner-simple-model.ts');
 const options=revenueFilterOptions([{id:'a',currentVersion:{title:'当前协议'},versions:[{vehicleIds:['v']}]}],[{id:'v',plateNumber:'当前车牌',modelDefinitionId:'m',model:'新车型名'},{id:'foreign',model:'其他公司车辆'}],{agreements:[{id:'historic',title:'历史协议'}],models:[{id:'m',name:'冻结车型名'}],vehicles:[{id:'old',plateNumber:'历史车牌',modelId:'m',agreementId:'historic'}]});
 assert.deepEqual(options.vehicles.map((row:any)=>row.id),['v','old']);assert.equal(options.models.find((row:any)=>row.id==='m').name,'冻结车型名');assert.equal(options.agreements.find((row:any)=>row.id==='historic').title,'历史协议');
});
