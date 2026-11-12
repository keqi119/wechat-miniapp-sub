import test from 'node:test';
import assert from 'node:assert/strict';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
test('product update validates persisted minimum when omitted; explicit replacement persists',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();try{await h.start();
 const input={name:'V31-'+h.prefix,months:12,minimumTermMonths:12,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',conditions:'本地测试',vehicleIds:[],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]};
 const draft=await h.post('/admin/products',{...input,...command()});
 const {minimumTermMonths,...omitted}=input;
 await h.reject(`/admin/products/${draft.productId}/versions/${draft.id}`,{...omitted,months:3,...command(draft.revision)},h.maker,'PRODUCT_TERM_INVALID','PATCH');
 const saved=await h.post(`/admin/products/${draft.productId}/versions/${draft.id}`,{...input,months:3,minimumTermMonths:3,customerBaas:{disposition:'INCLUDED'},...command(draft.revision)},h.maker,'PATCH');
 assert.equal(saved.minimumTermMonths,3);assert.deepEqual(saved.customerBaas,{disposition:'INCLUDED'});
 }finally{await h.close();}
});

test('V31 source readiness reuses real records, isolates accounts and subjects, and links missing fields',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();try{await h.start();
 const owner=await h.post('/admin/partners',{profile:{name:'合作企业-'+h.prefix,subjectType:'ENTERPRISE',address:'合作住所',contractProfile:{serviceContactName:'服务人员',serviceContactChannel:'电话',signerAuthorityRole:'LEGAL_REPRESENTATIVE',authorityEvidenceFileIds:['evidence']}},idempotencyKey:command().idempotencyKey});
 const agreement=await h.db.partnerAgreement.create({data:{ownerId:owner.id,createdBy:h.maker.id}});
 const version=await h.db.partnerAgreementVersion.create({data:{agreementId:agreement.id,ownerId:owner.id,version:1,status:'DRAFT',title:'本地',fileIds:[],vehicleIds:[],contentHash:'a'.repeat(64),createdBy:h.maker.id}});
 const {resolveV31Sources:resolveV31BoundSources,resolveV31SourceIds:resolveV31Sources,freezeV31Sources,assertV31SourcesCurrent}=await import('../src/contract-terms/sources');
 await assert.rejects(h.db.serial(tx=>resolveV31BoundSources(tx,{kind:'COOPERATION',resourceId:version.id,revision:99,businessHash:version.contentHash} as any)),(e:any)=>e.getResponse?.().error.code==='REVISION_CONFLICT');
 const first=await h.db.serial(tx=>resolveV31Sources(tx,{ownerId:owner.id,cooperationVersionId:version.id}));
 const snapshot:any=first.snapshot;assert.equal(snapshot.parties.OWNER.id,owner.id);assert.equal(snapshot.parties.OWNER.content.address,'合作住所');assert.equal(snapshot.collectionAccount,null);
 for(const field of ['cooperation.scope','cooperation.periodAndRate','cooperation.vehicles','OWNER.collectionAccount'])assert.ok(first.missing.some(m=>m.field===field&&m.maintenancePath.startsWith('#partners/')));
 const response=await h.get(`/admin/partners/${owner.id}/agreements/${version.id}/contract-readiness`);assert.equal(response.ready,false);
 await h.db.vehicleOwner.update({where:{id:owner.id},data:{address:'新住所',revision:{increment:1}}});
 const second=await h.db.serial(tx=>resolveV31Sources(tx,{ownerId:owner.id,cooperationVersionId:version.id}));assert.throws(()=>assertV31SourcesCurrent(freezeV31Sources(first.snapshot),freezeV31Sources(second.snapshot)));
 assert.equal(JSON.stringify(first).includes('accountNumber'),false);assert.equal(JSON.stringify(first).includes('identityCiphertext'),false);
 assert.ok(first.missing.some(m=>m.field==='OWNER.authorityEvidence'));
 const forbidden=await h.raw(`/admin/partners/${owner.id}/agreements/${version.id}/contract-readiness`,undefined,h.support);assert.equal(forbidden.status,403);
 assert.equal(h.externalCalls+h.identityCalls+h.esignCalls,0);
 }finally{await h.close();}
});

test('electronic cooperation persists V31 authorization, keeps three parties and partner account distinct from battery payee',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness(),oldPlatform=process.env.FADADA_PLATFORM_CUSTOMER_ID;try{await h.start();
 const proof=await h.proof(h.maker),customer=await h.customer('v31');
 const owner=await h.post('/admin/partners',{profile:{name:'V31合作-'+h.prefix,address:'真实住所'},idempotencyKey:command().idempotencyKey});
 const platform=await h.db.vehicleOwner.create({data:{name:'上海宁达信息科技有限公司',subjectType:'ENTERPRISE',address:'宁达住所',createdBy:h.maker.id}});
 const provider='synthetic-v31-'+h.prefix;process.env.FADADA_PLATFORM_CUSTOMER_ID=provider;
 await h.db.vehicleOwner.update({where:{id:platform.id},data:{contractProfile:{serviceContactName:'宁达联系人',serviceContactChannel:'电话留痕',signerAuthorityRole:'LEGAL_REPRESENTATIVE'}}});
 await h.db.ownerLegalRepresentative.create({data:{ownerId:platform.id,name:'本地代表',mobileHash:'a'.repeat(64),maskedMobile:'138****0000',evidenceHash:'b'.repeat(64),revision:1,createdBy:h.maker.id,updatedBy:h.maker.id}});
 await h.db.ownerESignAccount.create({data:{ownerId:platform.id,providerCustomerId:provider,realNameStatus:'VERIFIED',managerCustomerId:customer.id,evidenceHash:'c'.repeat(64),checkedAt:new Date(),consentSnapshot:{legalRevision:1,legalName:'本地代表'}}});
 const car=await h.post('/admin/vehicles',{brand:'合成',model:'V31',title:'V31-'+h.prefix,vin:'L'+h.prefix.replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:100,description:'本地',conditionDisclosure:'本地',mediaFileIds:[],...command()});
 await h.db.vehicleAssetProfile.create({data:{vehicleId:car.id,registeredOwnerName:'登记所有人',createdBy:h.maker.id,updatedBy:h.maker.id}});
 await h.db.vehicleBaasContract.create({data:{vehicleId:car.id,contractNumber:'合成电池合同',lessorCollectionAccountInfo:'BATTERY_PRIVATE_PAYEE',rentalAmount:99999,termsHash:'b'.repeat(64),createdBy:h.maker.id,updatedBy:h.maker.id}});
 const product=await h.post('/admin/products',{name:'V31-'+h.prefix,months:12,minimumTermMonths:3,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',conditions:'本地',vehicleIds:[car.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}],customerBaas:{disposition:'INCLUDED'},...command()});
 const {hash}=await import('../src/common/data');
 const template=await h.db.legalDocument.create({data:{type:'V31_SYNTHETIC_'+h.prefix,version:1,title:'本地模板',content:'明确固定正文',status:'PUBLISHED'}});
 const v31Sources={vehicleScopes:[{vehicleId:car.id,validFrom:'2026-11-01',validUntil:'2027-11-01',authorityEvidenceFileIds:[proof.id],rightsRestrictions:{status:'UNKNOWN' as const}}],productVersionIds:[product.id],templateRefs:[{id:template.id,hash:hash(template.content)}]};
 process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
 const saved=await h.post(`/admin/partners/${owner.id}/agreements`,{status:'DRAFT',vehicleIds:[car.id],partnerRateBps:6000,validFrom:'2026-11-01',validUntil:'2027-11-01',v31Sources,...command()});
 const version=saved.latestVersion;assert.deepEqual(version.electronicTerms.v31Sources,v31Sources);assert.equal(version.electronicTerms.calendarPolicy.paymentNextMonthWorkday,15);
 const {resolveV31SourceIds:resolveV31Sources}=await import('../src/contract-terms/sources');
 const first=await h.db.serial(tx=>resolveV31Sources(tx,{ownerId:owner.id,customerId:customer.id,cooperationVersionId:version.id,vehicleId:car.id,productVersionId:product.id}));const snap:any=first.snapshot;
 assert.equal(snap.parties.PLATFORM.id,platform.id);assert.equal(first.missing.some(m=>m.field==='PLATFORM.authorityEvidence'),false);assert.equal(snap.parties.PLATFORM.content.authorityEvidence.source,'VERIFIED_LEGAL_REPRESENTATIVE');assert.equal(snap.parties.OWNER.id,owner.id);assert.equal(snap.parties.CUSTOMER.id,customer.id);
 assert.equal(snap.collectionAccount,null);assert.ok(first.missing.some(m=>m.field===`vehicle.${car.id}.rightsRestrictions`));assert.ok(first.missing.some(m=>m.field===`vehicle.${car.id}.insurance`));
 assert.deepEqual(snap.products[0].content.customerBaas,{disposition:'INCLUDED'});assert.equal(JSON.stringify(first).includes('BATTERY_PRIVATE_PAYEE'),false);assert.equal(JSON.stringify(first).includes('99999'),false);
 const {accountHash}=await import('../src/partners/revenue-types');const accountData={accountName:owner.name,bankName:'本地银行',accountNumber:'6222000012345678'};
 const account=await h.db.partnerAccountVersion.create({data:{ownerId:owner.id,version:1,status:'APPROVED',...accountData,contentHash:accountHash(accountData),evidenceFileIds:[proof.id],createdBy:h.maker.id,reviewedBy:h.reviewer.id,reviewedAt:new Date()}});
 const second=await h.db.serial(tx=>resolveV31Sources(tx,{ownerId:owner.id,cooperationVersionId:version.id}));assert.equal((second.snapshot as any).collectionAccount.id,account.id);assert.equal(JSON.stringify(second).includes(accountData.accountNumber),false);
 assert.equal(h.externalCalls+h.identityCalls+h.esignCalls,0);
 }finally{if(oldPlatform===undefined)delete process.env.FADADA_PLATFORM_CUSTOMER_ID;else process.env.FADADA_PLATFORM_CUSTOMER_ID=oldPlatform;await h.close();}
});
