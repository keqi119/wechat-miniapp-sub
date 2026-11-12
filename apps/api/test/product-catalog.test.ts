import test from 'node:test';
import assert from 'node:assert/strict';
import { vehicleView, planView } from '../src/catalog/catalog';
import {versionSnapshot} from '../src/products/snapshot';
import {canonicalHash} from '../src/customers/types';
const productVersion={id:'version',productId:'product',version:1,status:'PUBLISHED',name:'标准方案',months:12,monthlyFeeAmount:198000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'能源自理',conditions:'本人使用',vehicleIds:['vehicle'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'},{kind:'BENEFIT',benefitVersion:{id:'bv',definitionId:'b',version:1,name:'服务',description:'预约',provider:'宁达',conditions:'预约',kind:'DESCRIPTION',validity:'ORDER',unit:null,totalQuantity:null}}]};
const listing={id:'listing',vehicleId:'vehicle',productVersionId:'version',subscriptionPlanId:'plan',revision:1,status:'PUBLISHED',source:'LEGACY_MIGRATED',visible:true,recommended:false,sortOrder:0,productSourceHash:null,snapshot:null};
const plan={id:'plan',vehicleId:'vehicle',productVersionId:'version',listing,active:true,name:'过时名称',monthlyFeeAmount:1,productVersion,partnerRevenueRule:{bps:9000},ownerId:'secret'};
test('模块化商品公开月费组成与合同期换车约定，历史v1不凭空新增',()=>{
 const version={...productVersion,configurationVersion:2,baseFeeAmount:180000,mileageMonthlyFeeAmount:18000,mileagePerMonthKm:2400,excessMileagePriceAmount:230,energyDescription:'充换电费用由客户自付',swapPolicy:{version:2,period:'TERM',includedCount:2,extraFeeAmount:50000}};
 const snapshot=versionSnapshot(version),view:any=planView({...plan,productVersion:version,listing:{...listing,source:'EXPLICIT',snapshot,productSourceHash:canonicalHash(snapshot)}});
 assert.equal(view.configurationVersion,2);assert.equal(view.baseFeeAmount,180000);assert.equal(view.mileageMonthlyFeeAmount,18000);assert.equal(view.monthlyFeeAmount,198000);assert.deepEqual(view.swapPolicy,version.swapPolicy);
 assert.equal(view.mileagePerMonthKm,2400);assert.equal(view.excessMileagePriceAmount,230);
 assert.equal('swapPolicy' in planView(plan),false);
});
test('公开方案字段为白名单且来自发布产品版本',()=>{const view=planView(plan);assert.equal(view.monthlyFeeAmount,198000);assert.equal(view.name,'标准方案');assert.equal(view.productVersionId,'version');assert.equal('partnerRevenueRule' in view,false);assert.equal('ownerId' in view,false);assert.equal('productVersion' in view,false);});
test('公开车辆白名单不泄漏内部材料，缺少合作资格事实不能推定可申请',()=>{const previous=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='OFFLINE';try{const view=vehicleView({id:'vehicle',title:'车辆',year:2024,mileageKm:10000,status:'PUBLISHED',plans:[plan],ownerBinding:{identity:'private'},insurancePolicies:[{fileId:'private'}],createdBy:'admin'});assert.equal(view.minFeeAmount,198000);assert.equal(view.available,false);assert.equal('ownerBinding' in view,false);assert.equal('insurancePolicies' in view,false);assert.equal('plans' in view,false);}finally{if(previous===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=previous;}});
test('停用或未关联产品的兼容套餐不可公开销售',()=>{for(const value of [{...plan,productVersion:{...productVersion,status:'RETIRED'}},{...plan,productVersion:null}]){assert.equal(planView(value).available,false);assert.equal(vehicleView({id:'vehicle',year:2024,mileageKm:0,status:'PUBLISHED',plans:[value]}).available,false);}});
test('没有显式上架商品、隐藏商品及错绑商品不能通过旧套餐入口公开销售',()=>{
 for(const candidate of [undefined,null,{...listing,status:'DRAFT'},{...listing,status:'WITHDRAWN'},{...listing,visible:false},{...listing,vehicleId:'other'},{...listing,subscriptionPlanId:'other'},{...listing,productVersionId:'other'}]){
  assert.equal(planView({...plan,listing:candidate}).available,false);
 }
});
test('公开商品投影携带真实来源版本但不泄漏管理快照及操作者',()=>{
 const snapshot=versionSnapshot(productVersion);
 const view:any=planView({...plan,listing:{...listing,source:'EXPLICIT',createdBy:'private-operator',snapshot,productSourceHash:canonicalHash(snapshot)}});
 assert.equal(view.listingId,'listing');assert.equal(view.listingRevision,1);assert.match(view.sourceHash,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(view).includes('private-operator'),false);assert.equal('listing' in view,false);assert.equal('snapshot' in view,false);
});
