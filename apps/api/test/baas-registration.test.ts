import test from 'node:test';
import assert from 'node:assert/strict';
import {BaasService} from '../src/vehicle-baas/service';
import {baasTerms,validateCostPlan} from '../src/asset-costs/source';
import {canonicalHash} from '../src/customers/types';
import {assetActor,assetCommand,assetError,assetFixture,assetNow,financeActor} from './asset-ledger-fixture';

async function registered(changes:any={}){
 const f=assetFixture(),service=new BaasService(()=>assetNow);f.rows('vehicle')[0].vin='LTESTBAAS00000001';
 f.seed('vehicleOwner',{id:'payer',name:'合成代付人',status:'DRAFT'});f.seed('vehicleAssetProfile',{vehicleId:'vehicle',revision:1,batteryOwnership:'BAAS',registeredOwnerName:'上海（合成）科技有限公司'});
 const contract=await f.serial(tx=>service.create(tx,assetActor,{...assetCommand(),vehicleId:'vehicle',vehicleRevision:3,assetRevision:1,provider:'合成出租方',supplierContractNumber:'8109-SYNTHETIC',batteryPackage:null,effectiveFrom:'2027-01-01',effectiveTo:null,rentalAmount:72800,paymentDayOfMonth:8,lesseeName:'上海(合成) 科技有限公司',payerOwnerId:'payer',...changes}));
 f.attach('BAAS',contract.id);return{...f,service,contract};
}

test('eight business fields plus current PDF permit explicit activation without battery specification or extra cooperation qualification',async()=>{
 const f=await registered(),detail=await f.service.detail(f.tx,assetActor,f.contract.id);
 assert.equal(detail.actualContractNumber,'8109-SYNTHETIC');assert.equal(detail.billingCycle,'MONTHLY');assert.equal(detail.registrationReadiness.ready,true);assert.equal(detail.registrationReadiness.checks.length,9);assert.deepEqual(detail.financialMissingFields,[]);assert.equal(detail.registrationReadiness.signedPdfFiles.length,1);
 const active=await f.serial(tx=>f.service.transition(tx,assetActor,f.contract.id,'activate',{...assetCommand(),reason:'已核对八项登记与签署PDF一致'}));assert.equal(active.status,'ACTIVE');assert.equal(active.validityGroup,'CURRENT');assert.equal(active.batteryPackage,null);
 const audit=f.rows('auditLog').find(row=>row.action==='BAAS_ACTIVATE');assert.equal(audit.data.registrationSnapshot.payerOwnerId,'payer');assert.equal(audit.data.registrationSnapshot.actualContractNumber,'8109-SYNTHETIC');assert.equal(audit.data.registrationSnapshot.files[0].sha256,'a'.repeat(64));assert.equal(audit.data.registrationSnapshot.verifiedBy,assetActor.id);
 const query={fromPeriod:'2027-01',toPeriod:'2027-01'},preview=await f.service.preview(f.tx,assetActor,f.contract.id,query),made=await f.serial(tx=>f.service.generate(tx,assetActor,f.contract.id,{...assetCommand(active.revision),...query,previewHash:preview.previewHash,acknowledgedWarningIds:preview.warningIds}));
 const original=structuredClone(f.rows('assetCostPlan')[0]);await f.serial(tx=>f.service.update(tx,assetActor,f.contract.id,{...assetCommand(made.revision),notes:'原条款历史保留',changeReason:'补充说明'}));assert.equal((await validateCostPlan(f.tx,original)).terms.batteryPackage,null);assert.equal(original.amount,72800);assert.equal(canonicalHash(original.sourceSnapshot.terms),original.sourceSnapshot.termsHash);
});

test('readiness identifies every missing business field precisely and never treats internal auto number or image as signed PDF',async()=>{
 for(const [key,field,value]of [['VIN','vin','INVALID'],['CONTRACT_NUMBER','supplierContractNumber',''],['LESSEE','lesseeName','其他公司'],['PROVIDER','provider',null],['START_DATE','effectiveFrom',null],['MONTHLY_RENT','rentalAmount',null],['PAYMENT_DAY','paymentDayOfMonth',null],['PAYER','payerOwnerId',null],['SIGNED_PDF','mimeType','image/png']] as const){
  const f=await registered(),row=f.rows('vehicleBaasContract')[0];if(key==='VIN')f.rows('vehicle')[0].vin=value;else if(key==='SIGNED_PDF')f.rows('storedFile')[0].mimeType=value;else row[field]=value;
  row.termsHash=canonicalHash(baasTerms(row));const detail=await f.service.detail(f.tx,assetActor,row.id),item=detail.registrationReadiness.checks.find((check:any)=>check.key===key);assert.equal(item.passed,false,key);assert(item.message.length>0,key);assert.equal(detail.registrationReadiness.ready,false,key);
  await assert.rejects(f.serial(tx=>f.service.transition(tx,assetActor,row.id,'activate',{...assetCommand(),reason:'资料尚缺'})),assetError('BAAS_REGISTRATION_INCOMPLETE'));assert.equal(f.rows('vehicleBaasContract')[0].status,'DRAFT');
 }
 const quarterly=await registered({billingCycle:'QUARTERLY',rentalAmount:300000});assert.equal((await quarterly.service.detail(quarterly.tx,assetActor,quarterly.contract.id)).registrationReadiness.checks.find((item:any)=>item.key==='MONTHLY_RENT').passed,false);assert.equal(quarterly.rows('vehicleBaasContract')[0].rentalAmount,300000);
});

test('new lessee default is current registered owner while explicit prior values and omitted payer remain unchanged',async()=>{
 const f=await registered({lesseeName:undefined,payerOwnerId:undefined}),detail=await f.service.detail(f.tx,assetActor,f.contract.id);assert.equal(detail.lesseeName,'上海（合成）科技有限公司');assert.equal(detail.payerOwnerId,null);assert.equal(detail.registrationReadiness.checks.find((row:any)=>row.key==='PAYER').passed,false);
 const changed=await f.serial(tx=>f.service.update(tx,assetActor,f.contract.id,{...assetCommand(),lesseeName:'原合同登记名称'}));assert.equal(changed.lesseeName,'原合同登记名称');
});

test('registration context and payer directory keep explicit payer identity, exact scope, pagination and current staff protection',async()=>{
 const f=await registered();f.seed('vehicleOwner',{id:'suspended',name:'停用公司',status:'SUSPENDED'});f.seed('vehicleOwner',{id:'candidate',name:'候选公司',status:'DRAFT'});
 const context=await f.service.registrationContext(f.tx,assetActor,{vehicleId:'vehicle',contractId:f.contract.id});assert.equal(context.actualContractNumber,'8109-SYNTHETIC');assert.equal(context.registeredOwnerName,'上海（合成）科技有限公司');assert.deepEqual(context.currentPayer,{id:'payer',name:'合成代付人'});assert.equal(context.readiness.financialCycle,'MONTHLY');
 const first=await f.service.payerOptions(f.tx,assetActor,{page:'1',pageSize:'1'}),second=await f.service.payerOptions(f.tx,assetActor,{page:'2',pageSize:'1'});assert.equal(first.total,2);assert.equal(second.total,2);assert.deepEqual(new Set([...first.items,...second.items].map((row:any)=>row.id)),new Set(['payer','candidate']));assert(first.items.every((row:any)=>Object.keys(row).sort().join(',')==='id,name'));
 await assert.rejects(f.service.registrationContext(f.tx,financeActor,{vehicleId:'vehicle'}),assetError('FORBIDDEN'));await assert.rejects(f.service.registrationContext(f.tx,assetActor,{vehicleId:'other-vehicle',contractId:f.contract.id}),assetError('NOT_FOUND'));
 await assert.rejects(f.serial(tx=>f.service.update(tx,assetActor,f.contract.id,{...assetCommand(),payerOwnerId:'suspended'})),assetError('BAAS_PAYER_INVALID'));assert.equal(f.rows('vehicleBaasContract')[0].payerOwnerId,'payer');
});

test('payer recommendations include current draft vehicle registrations and deduplicate bindings without assigning a payer',async()=>{
 const f=await registered({payerOwnerId:undefined});f.seed('vehicleOwner',{id:'second-payer',name:'另一登记公司',status:'DRAFT'});
 for(const [id,ownerId]of [['draft-a','payer'],['draft-b','second-payer']] as const){f.seed('partnerAgreement',{id,ownerId,status:'DRAFT'});f.seed('partnerAgreementVersion',{id:id+'-v1',agreementId:id,ownerId,status:'DRAFT',version:1,vehicleIds:['vehicle']});}
 f.seed('ownerVehicle',{id:'hint',vehicleId:'vehicle',ownerId:'payer',status:'DRAFT'});
 const context=await f.service.registrationContext(f.tx,assetActor,{vehicleId:'vehicle',contractId:f.contract.id});assert.deepEqual(new Set(context.payerRecommendations.map((row:any)=>row.id)),new Set(['payer','second-payer']));assert.equal(context.payerRecommendations.length,2);assert.equal(context.currentPayer,null);assert.equal(f.rows('vehicleBaasContract')[0].payerOwnerId,null);assert.equal(f.rows('partnerAgreementVehicle').length,0);
});
