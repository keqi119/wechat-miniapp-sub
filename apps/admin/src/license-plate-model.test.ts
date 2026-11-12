import test from 'node:test';
import assert from 'node:assert/strict';
import {plateAccess,plateDraftPayload,plateOwnershipPayload,plateBindPayload,plateUnbindPayload,plateClearLegacyPayload,plateArchivePayload,type LicensePlate,type PlateVehicle,type PlateOwner} from './license-plate-model.ts';
const file={id:'proof',name:'证据.pdf',mimeType:'application/pdf',size:20,sha256:'a'.repeat(64)};
const plate={id:'plate',revision:3,plateNumber:'沪Ａ 12345',normalizedNumber:'沪A12345',plateType:'自备客车号牌',region:'上海',notes:'',status:'ACTIVE',files:[file],currentOwnership:null,currentBinding:null,ownershipHistory:[],bindingHistory:[]} as LicensePlate;
const target={id:'target',title:'目标车辆',vin:'LSVNU61E2SN513145',revision:9,plateNumber:null} as PlateVehicle;
const old={id:'old',title:'当前车辆',vin:'LSVNU61E2SN513146',revision:6,plateNumber:'沪Ａ 12345'} as PlateVehicle;
const owner={id:'owner',name:'备案主体',subjectType:'ENTERPRISE',status:'DRAFT',revision:5} as PlateOwner;
const bound={...plate,currentBinding:{id:'binding',plateId:'plate',vehicleId:'old',bindingRevision:4,vehicle:old,validUntil:null}} as LicensePlate;
test('plate role and explicit permission gate rejects finance/support/field wildcard',()=>{
 for(const role of ['ADMIN','OPERATIONS']){assert.deepEqual(plateAccess(role,['license-plates.read']),{read:true,write:false});assert.equal(plateAccess(role,['*']).write,true);assert.equal(plateAccess(role,[]).read,false);}
 for(const role of ['FINANCE','SUPPORT','FIELD'])assert.deepEqual(plateAccess(role,['*']),{read:false,write:false});
});
test('plate identity requires explicit type and creates once; metadata patch never changes number',()=>{
 assert.deepEqual(plateDraftPayload({plateNumber:' 沪Ａ 12345 ',plateType:'自备客车号牌',region:' 上海 ',notes:''}),{plateNumber:'沪Ａ 12345',plateType:'自备客车号牌',region:'上海',notes:'',revision:0});
 assert.deepEqual(plateDraftPayload({plateNumber:'攻击修改',plateType:'客车',region:'',notes:'核定'},plate),{plateType:'客车',region:'',notes:'核定',revision:3});
 for(const value of ['', 'a'.repeat(33), '沪A\u0000123'])assert.throws(()=>plateDraftPayload({plateNumber:value,plateType:'客车'}));assert.throws(()=>plateDraftPayload({plateNumber:'沪A12345',plateType:''}));assert.throws(()=>plateDraftPayload({plateType:'客车'},{...plate,status:'ARCHIVED'}));
});
test('ownership uses exact current period and fresh subject version, only own evidence, never grants access',()=>{
 const body=plateOwnershipPayload(plate,owner,'实际核对',['proof']);assert.deepEqual(body,{revision:3,ownerId:'owner',ownerRevision:5,currentOwnershipPeriodId:null,currentOwnershipRevision:null,reason:'实际核对',fileIds:['proof']});
 const current={...plate,currentOwnership:{id:'period',ownerId:'prior',ownershipRevision:7}} as LicensePlate;
 assert.equal(plateOwnershipPayload(current,owner,'变更',['proof']).currentOwnershipRevision,7);assert.throws(()=>plateOwnershipPayload(plate,{...owner,status:'SUSPENDED'},'核对',['proof']));assert.throws(()=>plateOwnershipPayload(plate,owner,'核对',['foreign']));assert.throws(()=>plateOwnershipPayload(plate,owner,'核对',['proof','proof']));for(const key of ['customerId','roles','permissions','vehicleIds','partnerRateBps'])assert.equal(key in body,false);
});
test('binding and movement require both vehicle versions and current binding; no owner is required',()=>{
 assert.deepEqual(plateBindPayload(plate,target,undefined,'首绑',['proof'],true),{revision:3,vehicleId:'target',vehicleRevision:9,currentBindingId:null,currentBindingRevision:null,oldVehicleId:null,oldVehicleRevision:null,reason:'首绑',fileIds:['proof']});
 const body=plateBindPayload(bound,target,old,'移动',['proof'],true);assert.equal(body.currentBindingRevision,4);assert.equal(body.oldVehicleId,'old');assert.equal(body.oldVehicleRevision,6);assert.throws(()=>plateBindPayload(bound,target,undefined,'移动',['proof'],true));assert.throws(()=>plateBindPayload(bound,target,old,'移动',['proof'],false));assert.throws(()=>plateBindPayload(bound,old,old,'重复',['proof'],true));assert.throws(()=>plateBindPayload(bound,target,{...old,plateNumber:'沪B00000'},'移动',['proof'],true));
});
test('unbind preserves exact current relation and refuses archive while bound',()=>{
 assert.deepEqual(plateUnbindPayload(bound,old,'明确解绑',true),{revision:3,bindingId:'binding',bindingRevision:4,vehicleRevision:6,reason:'明确解绑'});assert.throws(()=>plateUnbindPayload(bound,target,'错误',true));assert.throws(()=>plateArchivePayload(bound,'归档'));assert.deepEqual(plateArchivePayload(plate,'归档'),{revision:3,reason:'归档'});
});
test('legacy correction sends untouched original display text with exact vehicle revision and evidence',()=>{
 const legacy={...old,plateNumber:'  沪Ａ 12345  '};assert.deepEqual(plateClearLegacyPayload(plate,legacy,'确认为错误旧文本',['proof'],true),{revision:3,vehicleId:'old',vehicleRevision:6,plateNumber:'  沪Ａ 12345  ',reason:'确认为错误旧文本',fileIds:['proof']});assert.throws(()=>plateClearLegacyPayload(plate,legacy,'核对',['proof'],false));assert.throws(()=>plateClearLegacyPayload(bound,old,'不能代替正式解绑',['proof'],true));assert.throws(()=>plateClearLegacyPayload(plate,{...legacy,plateNumber:'沪B'},'错误',['proof'],true));
});
