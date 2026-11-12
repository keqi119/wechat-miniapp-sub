import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ApplicationsController} from '../src/applications/applications';
function fixture(){
 const vehicle:any={id:'vehicle',vin:'L1234567890123456',plateNumber:'沪TEST01',brand:'测试品牌',model:'测试车型',title:'真实关联车辆',modelDefinitionId:'model',city:'上海',mileageKm:999999,conditionDisclosure:'旧录入的完好描述'};
 const version:any={id:'product-version-7',productId:'product',version:7,status:'PUBLISHED',name:'产品接口报价',months:24,monthlyFeeAmount:123456,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'产品能源说明：电池租金已含',conditions:'产品专属使用条件',vehicleIds:['vehicle'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'},{kind:'BENEFIT',benefitVersionId:'benefit-v2',benefitVersion:{id:'benefit-v2',definitionId:'benefit',version:2,kind:'COUNT',name:'轮胎检查',description:'预约轮胎检查',provider:'实际提供方',conditions:'提前预约',validity:'ORDER',unit:'次',totalQuantity:2}}]};
 const plan:any={id:'plan',vehicleId:vehicle.id,productVersionId:version.id,active:true,monthlyFeeAmount:1,months:12,productVersion:version,vehicle,listing:{id:'legacy-listing',revision:1,vehicleId:vehicle.id,productVersionId:version.id,subscriptionPlanId:'plan',status:'PUBLISHED',visible:true,source:'LEGACY_MIGRATED'}};
 const application:any={id:'application',vehicleId:vehicle.id,subscriptionPlanId:plan.id,customerId:'customer',revision:4,creditRevision:2,status:'IN_REVIEW',profile:{name:'本单客户',mobile:'13900000000',contactAddress:'上海市测试路1号',handoverLocation:{name:'客户建议点',address:'建议地点，不是联系地址'}},vehicle};
 const reads:any[]=[],writes:any[]=[];
 const tx:any={vehicle:{findUnique:async()=>({...vehicle,virtualAcceptanceScopeId:null})},adminUser:{findUnique:async({where}:any)=>({id:where.id,role:where.id==='finance'?'FINANCE':'OPERATIONS',active:true,authVersion:1})},application:{findUnique:async({where}:any)=>{reads.push({kind:'application',where});return where.id===application.id?application:null;}},subscriptionPlan:{findUnique:async({where}:any)=>{reads.push({kind:'product',where});return where.id===plan.id?plan:null;}},$queryRaw:async()=>[],archiveCommand:{findUnique:async()=>null,create:async(data:any)=>{writes.push(data);return data;}},finalPlan:{create:async(data:any)=>{writes.push(data);return data;}}};
 const db:any={...tx,serial:async(fn:any)=>fn(tx)};
 return{vehicle,version,plan,application,tx,db,reads,writes,controller:new ApplicationsController(db) as any};
}


test('electronic HTTP defaults bind mode and three factual fields with exact fee components',async()=>{
 const old=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';try{
 const f=fixture();Object.assign(f.version,{configurationVersion:2,minimumTermMonths:3,baseFeeAmount:100000,mileageMonthlyFeeAmount:23456,mileagePerMonthKm:2400,excessMileagePriceAmount:230,energyDescription:'充换电费用由客户自付',swapPolicy:{version:2,period:'TERM',includedCount:2,extraFeeAmount:50000}});
 const result=await f.controller.finalPlanDefaults('application',{admin:{id:'ops',role:'OPERATIONS',authVersion:1}});
 assert.equal(result.contractMode,'ELECTRONIC');assert.deepEqual(Object.keys(result.values.commercialTerms).sort(),['customerAddress','handoverArrangement','vehicleIdentification']);assert.deepEqual(result.values.agreedFeeComponents,{baseFeeAmount:100000,mileageMonthlyFeeAmount:23456});assert.equal('firstDueDate' in result.values,false);assert.equal(f.writes.length,0);
 }finally{if(old===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=old;}
});
