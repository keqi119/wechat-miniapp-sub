import {test} from 'node:test';
import assert from 'node:assert/strict';
import {baasCreateInput,baasPatchInput} from '../src/vehicle-baas/types';
import {BaasService} from '../src/vehicle-baas/service';
import {baasTerms,loadCostSource,validateCostPlan} from '../src/asset-costs/source';
import {previewBaasSchedule} from '../src/vehicle-baas/schedule';
import {canonicalHash} from '../src/customers/types';
import {hash} from '../src/common/data';
import {assetActor,assetCommand,assetError,assetFixture,assetNow,financeActor} from './asset-ledger-fixture';

const required=['provider','batteryPackage','effectiveFrom','billingCycle','rentalAmount','paymentDayOfMonth'];
const metadata={supplierOrderNumber:'000000000000000123456789',batteryBrand:'合成品牌',lesseeName:'合成承租方',lesseeCreditCode:'91310000SYNTHETIC1',lessorCollectionAccountInfo:'合成银行\n合成户名\n000000000000001'};
const complete={provider:'合成出租方',batteryPackage:'75kWh',effectiveFrom:'2028-02-15',effectiveTo:null,billingCycle:'MONTHLY',rentalAmount:98000,paymentDayOfMonth:31};
const draft=()=>({...assetCommand(),vehicleId:'vehicle',vehicleRevision:3,assetRevision:1,...Object.fromEntries(required.map(key=>[key,null])),effectiveTo:null});
function setup(){const f=assetFixture();f.seed('vehicleAssetProfile',{vehicleId:'vehicle',revision:1,batteryOwnership:'BAAS',registeredOwnerName:'合成登记所有人'});return{...f,service:new BaasService(()=>assetNow)};}

test('information-only draft keeps unknown terms null and generates one replay-stable internal number',async()=>{
 const f=setup(),body=draft(),created=await f.serial(tx=>f.service.create(tx,assetActor,body));
 assert.equal(created.status,'DRAFT');assert.match(created.contractNumber,/^BAAS-[0-9a-f-]{36}$/);assert.deepEqual(created.missingFields,required);
 for(const field of required)assert.equal(created[field],null);assert.equal(created.effectiveTo,null);assert.equal(created.supplierOrderNumber,null);
 assert.deepEqual(await f.serial(tx=>f.service.create(tx,assetActor,body)),created);assert.equal(f.rows('vehicleBaasContract').length,1);
 await assert.rejects(f.serial(tx=>f.service.create(tx,assetActor,{...body,supplierOrderNumber:'123'})),assetError('IDEMPOTENCY_CONFLICT'));
 assert.equal(f.rows('assetCostPlan').length,0);assert.equal(f.rows('assetCostEntry').length,0);
 f.revoke(assetActor.id);await assert.rejects(f.serial(tx=>f.service.create(tx,assetActor,body)),assetError('STAFF_SESSION_CHANGED'));
});

test('metadata patches preserve omitted fields, clear blank/null, preserve leading zeroes, and never change the 16-term hash',async()=>{
 const f=setup(),created=await f.serial(tx=>f.service.create(tx,assetActor,{...draft(),...metadata}));
 const changed=await f.serial(tx=>f.service.update(tx,assetActor,created.id,{...assetCommand(created.revision),batteryBrand:' 新品牌 '}));
 assert.equal(changed.batteryBrand,'新品牌');assert.equal(changed.supplierOrderNumber,metadata.supplierOrderNumber);assert.equal(changed.lessorCollectionAccountInfo,metadata.lessorCollectionAccountInfo);assert.equal(changed.termsHash,created.termsHash);assert.equal(changed.revision,1);
 assert.equal(changed.vehicle.registeredOwnerName,'合成登记所有人');assert.equal(f.rows('vehicleBaasContract')[0].registeredOwnerName,undefined);
 const cleared=await f.serial(tx=>f.service.update(tx,assetActor,created.id,{...assetCommand(1),supplierOrderNumber:' ',lessorCollectionAccountInfo:null}));assert.equal(cleared.supplierOrderNumber,null);assert.equal(cleared.lessorCollectionAccountInfo,null);assert.equal(cleared.batteryBrand,'新品牌');
 await assert.rejects(f.serial(tx=>f.service.update(tx,assetActor,created.id,{...assetCommand(1),batteryBrand:'old'})),assetError('REVISION_CONFLICT'));
 const audit=f.rows('auditLog').findLast(row=>row.action==='UPDATE_BAAS');assert.ok(audit);assert.equal(JSON.stringify(audit).includes(metadata.lessorCollectionAccountInfo),false);
});

test('metadata audit hashes bind normalized private account history, null fields and omitted patches without replay writes',async()=>{
 const f=setup(),accountA='合成审计银行甲 000001',accountB='合成审计银行乙 000002';
 const allNull={supplierOrderNumber:null,batteryBrand:null,lesseeName:null,lesseeCreditCode:null,lessorCollectionAccountInfo:null};
 const body={...draft(),supplierOrderNumber:' 00012 ',batteryBrand:' ',lessorCollectionAccountInfo:' '+accountA+' '};
 const expectedA={...allNull,supplierOrderNumber:'00012',lessorCollectionAccountInfo:accountA};
 const created=await f.serial(tx=>f.service.create(tx,assetActor,body));
 let audits=f.rows('auditLog');assert.equal(audits.length,1);assert.equal(audits[0].data.metadataHash,canonicalHash(expectedA));
 assert.deepEqual(audits[0].data.metadataFields,['supplierOrderNumber','batteryBrand','lessorCollectionAccountInfo']);assert.equal('previousMetadataHash'in audits[0].data,false);
 assert.deepEqual(await f.serial(tx=>f.service.create(tx,assetActor,body)),created);assert.equal(f.rows('auditLog').length,1);

 const updateBody={...assetCommand(created.revision),lessorCollectionAccountInfo:' '+accountB+' '};
 const updated=await f.serial(tx=>f.service.update(tx,assetActor,created.id,updateBody)),expectedB={...expectedA,lessorCollectionAccountInfo:accountB};
 audits=f.rows('auditLog');assert.equal(audits.length,2);assert.equal(audits[1].data.previousMetadataHash,canonicalHash(expectedA));assert.equal(audits[1].data.metadataHash,canonicalHash(expectedB));assert.notEqual(audits[1].data.previousMetadataHash,audits[1].data.metadataHash);assert.deepEqual(audits[1].data.metadataFields,['lessorCollectionAccountInfo']);assert.equal(updated.termsHash,created.termsHash);
 assert.deepEqual(await f.serial(tx=>f.service.update(tx,assetActor,created.id,updateBody)),updated);assert.equal(f.rows('auditLog').length,2);

 const unchanged=await f.serial(tx=>f.service.update(tx,assetActor,created.id,{...assetCommand(updated.revision),notes:'仅修订普通备注，元数据省略'}));
 audits=f.rows('auditLog');assert.equal(audits[2].data.previousMetadataHash,canonicalHash(expectedB));assert.equal(audits[2].data.metadataHash,canonicalHash(expectedB));assert.deepEqual(audits[2].data.metadataFields,[]);assert.equal(unchanged.lessorCollectionAccountInfo,accountB);
 const clearBody={...assetCommand(unchanged.revision),lessorCollectionAccountInfo:null,supplierOrderNumber:' '};
 const cleared=await f.serial(tx=>f.service.update(tx,assetActor,created.id,clearBody));
 audits=f.rows('auditLog');assert.equal(audits[3].data.previousMetadataHash,canonicalHash(expectedB));assert.equal(audits[3].data.metadataHash,canonicalHash(allNull));assert.equal(cleared.lessorCollectionAccountInfo,null);assert.equal(cleared.termsHash,unchanged.termsHash);
 assert.deepEqual(await f.serial(tx=>f.service.update(tx,assetActor,created.id,clearBody)),cleared);assert.equal(f.rows('auditLog').length,4);
 const auditJson=JSON.stringify(f.rows('auditLog'));assert.equal(auditJson.includes(accountA),false);assert.equal(auditJson.includes(accountB),false);
 const empty=await f.serial(tx=>f.service.create(tx,assetActor,draft()));assert.equal(f.rows('auditLog').at(-1).data.metadataHash,canonicalHash(allNull));assert.equal(empty.lessorCollectionAccountInfo,undefined);
});

test('authorized detail alone includes collection account; list excludes it and finance never receives registered owner',async()=>{
 const f=setup(),created=await f.serial(tx=>f.service.create(tx,assetActor,{...draft(),...metadata}));
 const detail=await f.service.detail(f.tx,assetActor,created.id);assert.equal(detail.lessorCollectionAccountInfo,metadata.lessorCollectionAccountInfo);assert.equal(detail.vehicle.registeredOwnerName,'合成登记所有人');
 const list=await f.service.list(f.tx,assetActor,{});assert.equal('lessorCollectionAccountInfo'in list.items[0],false);assert.equal('registeredOwnerName'in list.items[0],false);
 const finance=await f.service.detail(f.tx,financeActor,created.id);assert.equal('registeredOwnerName'in finance.vehicle,false);
 for(const role of ['SUPPORT','FIELD'])await assert.rejects(f.service.detail(f.tx,{id:role.toLowerCase(),role,authVersion:1},created.id),assetError('FORBIDDEN'));
 await assert.rejects(f.serial(tx=>f.service.update(tx,financeActor,created.id,{...assetCommand(),batteryBrand:'越权'})),assetError('FORBIDDEN'));
});

test('incomplete contracts reject activation, resume, preview, generation and confirmed source validation',async()=>{
 const f=setup(),created=await f.serial(tx=>f.service.create(tx,assetActor,draft()));f.attach('BAAS',created.id);
 for(const action of ['activate','resume'] as const){f.rows('vehicleBaasContract')[0].status=action==='activate'?'DRAFT':'SUSPENDED';await assert.rejects(f.serial(tx=>f.service.transition(tx,assetActor,created.id,action,{...assetCommand(),reason:'合成校验'})),assetError('BAAS_DRAFT_INCOMPLETE'));}
 await assert.rejects(f.service.preview(f.tx,assetActor,created.id,{fromPeriod:'2028-02',toPeriod:'2028-02'}),assetError('BAAS_DRAFT_INCOMPLETE'));
 await assert.rejects(f.serial(tx=>f.service.generate(tx,assetActor,created.id,{...assetCommand(),fromPeriod:'2028-02',toPeriod:'2028-02',previewHash:'a'.repeat(64),acknowledgedWarningIds:[]})),assetError('BAAS_DRAFT_INCOMPLETE'));
 await assert.rejects(validateCostPlan(f.tx,{sourceKind:'BAAS',baasContractId:created.id}),assetError('BAAS_DRAFT_INCOMPLETE'));
 assert.equal(f.rows('assetCostPlan').length,0);
});

test('partial completion reports only remaining required terms; neither end date nor supplier order is required',async()=>{
 const f=setup(),created=await f.serial(tx=>f.service.create(tx,assetActor,draft()));
 const partial=await f.serial(tx=>f.service.update(tx,assetActor,created.id,{...assetCommand(),provider:complete.provider,effectiveFrom:complete.effectiveFrom}));assert.deepEqual(partial.missingFields,['batteryPackage','billingCycle','rentalAmount','paymentDayOfMonth']);
 const ready=await f.serial(tx=>f.service.update(tx,assetActor,created.id,{...assetCommand(partial.revision),...complete}));assert.deepEqual(ready.missingFields,[]);f.attach('BAAS',created.id);
 const active=await f.serial(tx=>f.service.transition(tx,assetActor,created.id,'activate',{...assetCommand(ready.revision),reason:'合成附件已核对'}));assert.equal(active.status,'ACTIVE');assert.equal(active.effectiveTo,null);
 const request={fromPeriod:'2028-02',toPeriod:'2028-03'},preview=await f.service.preview(f.tx,assetActor,created.id,request);assert.deepEqual(preview.warningIds,['2028-02:OUTSIDE_CONTRACT_START']);assert.equal(preview.rows[0].dueDate,'2028-02-29');
 const generated=await f.serial(tx=>f.service.generate(tx,assetActor,created.id,{...assetCommand(active.revision),...request,previewHash:preview.previewHash,acknowledgedWarningIds:preview.warningIds}));assert.equal(generated.created.length,2);
 const plan=f.rows('assetCostPlan')[0];assert.equal(plan.sourceSnapshot.terms.effectiveTo,null);await validateCostPlan(f.tx,plan);
 plan.sourceSnapshot.terms.effectiveTo='2028-12-31';await assert.rejects(validateCostPlan(f.tx,plan),assetError('COST_SOURCE_MISMATCH'));
});

test('nullable draft values retain strict domains, dates, text bounds, NUL checks and no writable projection fields',()=>{
 assert.equal(baasCreateInput.safeParse({...draft(),supplierOrderNumber:''}).success,true);
 assert.equal(baasCreateInput.safeParse({...assetCommand(),vehicleId:'vehicle',vehicleRevision:3,assetRevision:1}).success,true);
 for(const [field,bad]of Object.entries({rentalAmount:[0,-1,1.5,2147483648,'98000'],paymentDayOfMonth:[0,32,1.5],effectiveFrom:['2027-02-29','0000-01-01','10000-01-01','infinity'],effectiveTo:['2028-02-30'],billingCycle:['WEEKLY'],provider:['x\0y','x'.repeat(501)],batteryPackage:['x\0y'],supplierOrderNumber:['x'.repeat(501),'x\0y'],batteryBrand:['x'.repeat(201)],lesseeName:['x'.repeat(201)],lesseeCreditCode:['123','91310000synthetic1','!'.repeat(18)],lessorCollectionAccountInfo:['x'.repeat(2001),'x\0y']}))for(const value of bad)assert.equal(baasCreateInput.safeParse({...draft(),[field]:value}).success,false,`${field} invalid value accepted`);
 assert.equal(baasCreateInput.safeParse({...draft(),effectiveFrom:'2028-03-01',effectiveTo:'2028-02-29'}).success,false);
 assert.equal(baasPatchInput.safeParse({...assetCommand(),registeredOwnerName:'forged'}).success,false);
 assert.equal(baasPatchInput.safeParse({...assetCommand(),missingFields:[]}).success,false);
});

test('long-term schedule remains finite with 120 cycle limit, valid calendar boundaries and legacy finite output',()=>{
 const base={...complete,fromPeriod:'2028-02',toPeriod:'2038-01'};delete (base as any).provider;delete (base as any).batteryPackage;
 const result=previewBaasSchedule(base as any);assert.equal(result.rows.length,120);assert.equal(result.totalAmount,11760000);assert.equal(result.rows.at(-1)?.costPeriod,'2038-01');assert.deepEqual(result.warningIds,['2028-02:OUTSIDE_CONTRACT_START']);
 assert.throws(()=>previewBaasSchedule({...base,toPeriod:'2038-02'} as any),assetError('SCHEDULE_LIMIT'));
 assert.throws(()=>previewBaasSchedule({...base,toPeriod:undefined} as any));assert.throws(()=>previewBaasSchedule({...base,fromPeriod:'9999-12',toPeriod:'9999-12',billingCycle:'QUARTERLY'} as any));
 const finite=previewBaasSchedule({...base,toPeriod:'2028-02',effectiveTo:'2028-02-20'} as any);assert.deepEqual(finite,{algorithmVersion:'BAAS_FULL_PERIOD_V1',rows:[{costPeriod:'2028-02',periodStart:'2028-02-01',periodEnd:'2028-02-29',dueDate:'2028-02-29',amount:98000,warningIds:['2028-02:OUTSIDE_CONTRACT_START','2028-02:OUTSIDE_CONTRACT_END']}],totalAmount:98000,warningIds:['2028-02:OUTSIDE_CONTRACT_START','2028-02:OUTSIDE_CONTRACT_END']});
});

test('legacy finite 16 terms and omitted metadata retain old request and terms hashes',async()=>{
 const raw={...complete,effectiveTo:'2028-12-31',contractNumber:'legacy',...assetCommand(),vehicleId:'vehicle',vehicleRevision:3,assetRevision:1};
 const legacyTerms={provider:'合成出租方',contractNumber:'legacy',supplierContractNumber:'',batteryPackage:'75kWh',batterySerialNumber:'',effectiveFrom:'2028-02-15',effectiveTo:'2028-12-31',billingCycle:'MONTHLY',rentalAmount:98000,paymentDayOfMonth:31,graceDays:0,invoiceRequired:false,taxIncluded:null,currency:'CNY',notes:'',previousContractId:null};
 const expectedInput={...legacyTerms,revision:0,idempotencyKey:raw.idempotencyKey,vehicleId:'vehicle',vehicleRevision:3,assetRevision:1},parsed=baasCreateInput.parse(raw);
 assert.equal(hash(parsed),hash(expectedInput));assert.deepEqual(baasTerms(parsed),legacyTerms);
 const f=setup(),created=await f.serial(tx=>f.service.create(tx,assetActor,raw));assert.equal(created.termsHash,canonicalHash(legacyTerms));assert.equal((await loadCostSource(f.tx,{sourceKind:'BAAS',baasContractId:created.id})).termsHash,created.termsHash);
 assert.equal(hash(baasPatchInput.parse({...assetCommand(),notes:'legacy'})).length,64);
});
