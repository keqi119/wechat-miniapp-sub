import test from 'node:test';
import assert from 'node:assert/strict';
import {baasDraftPayload,baasActions,baasGeneratePayload,type AssetProfile,type BaasContract,type CostPreview} from './asset-model.ts';

const profile:AssetProfile={vehicleId:'synthetic-v',vehicle:{id:'synthetic-v',title:'合成车辆'},vehicleRevision:8,registered:true,revision:3,batteryOwnership:'BAAS',firstRegistrationDate:null};
const values={provider:'合成出租方',contractNumber:'',supplierContractNumber:'',batteryPackage:'75 kWh',batterySerialNumber:'',effectiveFrom:'2026-10-01',effectiveTo:'',billingCycle:'MONTHLY',rentalYuan:'123.45',paymentDayOfMonth:'15',graceDays:'0',invoiceRequired:false,taxIncluded:'unknown',notes:'',previousContractId:''};
const contract={id:'synthetic-b',vehicleId:'synthetic-v',vehicle:profile.vehicle,revision:2,status:'DRAFT',provider:'合成出租方',contractNumber:'BAAS-synthetic',supplierContractNumber:'',batteryPackage:'75 kWh',batterySerialNumber:'',effectiveFrom:'2026-10-01',effectiveTo:null,billingCycle:'MONTHLY',rentalAmount:12345,paymentDayOfMonth:15,graceDays:0,invoiceRequired:false,taxIncluded:null,currency:'CNY',notes:'',previousContractId:null,firstCostPeriod:null,termsHash:'a'.repeat(64),files:[{id:'synthetic-file',name:'synthetic.pdf',mimeType:'application/pdf',size:1,sha256:'b'.repeat(64)}]} as BaasContract;
const range={fromPeriod:'2026-10',toPeriod:'2026-12'},preview={contractId:contract.id,sourceId:contract.id,revision:2,assetRevision:3,algorithmVersion:'BAAS_V1',request:{sourceKind:'BAAS',...range},rows:[],totalAmount:0,totalCreatedAmount:0,createCount:0,existingCount:0,warningIds:[],previewHash:'a'.repeat(64)} as CostPreview;

test('open-ended draft leaves external order optional, preserves leading zeros and requests generated internal number',()=>{
 const body=baasDraftPayload({...values,supplierOrderNumber:' 000012345678901234567890 ',batteryBrand:' 合成品牌 ',lesseeName:' 合成承租人 ',lesseeCreditCode:'A12345678901234567',lessorCollectionAccountInfo:' 合成账户说明\n00001234 '},undefined,profile);
 assert.equal(body.effectiveTo,null);assert.equal(Object.hasOwn(body,'contractNumber'),false);assert.equal(body.rentalAmount,12345);assert.equal(body.vehicleRevision,8);assert.equal(body.assetRevision,3);
 assert.equal(body.supplierOrderNumber,'000012345678901234567890');assert.equal(body.batteryBrand,'合成品牌');assert.equal(body.lesseeName,'合成承租人');assert.equal(body.lesseeCreditCode,'A12345678901234567');assert.equal(body.lessorCollectionAccountInfo,'合成账户说明\n00001234');
 const empty=baasDraftPayload({...values,supplierOrderNumber:'   '},undefined,profile);assert.equal(empty.supplierOrderNumber,null);assert.equal(Object.hasOwn(empty,'status'),false);
});

test('partial drafts preserve unknown base terms as null and omitted metadata never clears existing values',()=>{
 const body=baasDraftPayload({...values,provider:'',batteryPackage:' ',effectiveFrom:'',billingCycle:'',rentalYuan:'',paymentDayOfMonth:''},undefined,profile);
 for(const key of ['provider','batteryPackage','effectiveFrom','billingCycle','rentalAmount','paymentDayOfMonth'])assert.equal(body[key],null,key);
 const edited=baasDraftPayload({notes:'仅修改备注'},contract);assert.equal(edited.notes,'仅修改备注');assert.equal(edited.revision,2);
 for(const key of ['provider','contractNumber','batteryPackage','effectiveFrom','effectiveTo','billingCycle','rentalAmount','paymentDayOfMonth','supplierOrderNumber','batteryBrand','lesseeName','lesseeCreditCode','lessorCollectionAccountInfo'])assert.equal(Object.hasOwn(edited,key),false,key);
 for(const key of ['supplierOrderNumber','batteryBrand','lesseeName','lesseeCreditCode','lessorCollectionAccountInfo'])assert.equal(baasDraftPayload({[key]:' '},contract)[key],null,key);
 assert.equal(baasDraftPayload({...values,contractNumber:contract.contractNumber},contract).contractNumber,contract.contractNumber);
});

test('nonempty draft terms and metadata retain strict validation',()=>{
 for(const invalid of [{rentalYuan:'0'},{rentalYuan:'1.001'},{paymentDayOfMonth:'32'},{paymentDayOfMonth:'1.5'},{effectiveFrom:'2026-02-30'},{effectiveTo:'2026-09-30'},{billingCycle:'WEEKLY'},{provider:'bad\0text'},{supplierOrderNumber:123},{supplierOrderNumber:'x'.repeat(501)},{batteryBrand:'x'.repeat(201)},{lesseeName:'x'.repeat(201)},{lesseeCreditCode:'a12345678901234567'},{lesseeCreditCode:'A123'},{lessorCollectionAccountInfo:'x'.repeat(2001)},{lessorCollectionAccountInfo:'a\0b'}])assert.throws(()=>baasDraftPayload({...values,...invalid},undefined,profile),JSON.stringify(invalid));
 assert.throws(()=>baasDraftPayload({effectiveTo:'2026-09-30'},contract));
});

test('activation derives missing base terms for old projections and still requires contract evidence',()=>{
 assert.deepEqual(baasActions(contract),['activate','archive']);assert.deepEqual(baasActions({...contract,files:[]}),['archive']);
 for(const key of ['provider','batteryPackage','effectiveFrom','billingCycle','rentalAmount','paymentDayOfMonth'])assert.deepEqual(baasActions({...contract,[key]:null}),['archive'],key);
 assert.deepEqual(baasActions({...contract,missingFields:['paymentDayOfMonth']} as BaasContract),['archive']);
 assert.deepEqual(baasActions({...contract,supplierOrderNumber:null,effectiveTo:null,missingFields:[]} as BaasContract),['activate','archive']);
});

test('cost generation rejects missing terms and accepts bounded long-term and existing finite contracts',()=>{
 const active={...contract,status:'ACTIVE'} as BaasContract;
 assert.deepEqual(baasGeneratePayload(active,preview,range,[]),{revision:2,...range,previewHash:'a'.repeat(64),acknowledgedWarningIds:[]});
 assert.doesNotThrow(()=>baasGeneratePayload({...active,effectiveTo:'2026-12-31'},preview,range,[]));
 assert.throws(()=>baasGeneratePayload({...active,rentalAmount:null} as BaasContract,preview,range,[]));
 assert.throws(()=>baasGeneratePayload({...active,missingFields:['provider']} as BaasContract,preview,range,[]));
});

test('date-only terms reject the unsupported year zero and non-scalar form values',()=>{
 for(const invalid of [{effectiveFrom:'0000-01-01'},{effectiveTo:'0000-12-31'},{effectiveFrom:['2026-10-01']},{paymentDayOfMonth:[15]},{billingCycle:['MONTHLY']}])assert.throws(()=>baasDraftPayload({...values,...invalid},undefined,profile),JSON.stringify(invalid));
});
