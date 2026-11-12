import {versionSnapshot} from '../src/products/snapshot';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as sources from '../src/contract-terms/sources';
import {customerBaasInput,cooperationSourcesInput} from '../src/contract-terms/types';
import {simplePartnerProfileInput} from '../src/partners/simple-agreements';
import {storedProductDraft} from '../src/products/configuration';
import {versionSnapshot} from '../src/products/snapshot';

test('BaaS separate requires customer price, period and recipient; no fee is explicit',()=>{
 assert.deepEqual(customerBaasInput.parse({disposition:'INCLUDED'}),{disposition:'INCLUDED'});
 assert.equal(customerBaasInput.safeParse({disposition:'SEPARATE'}).success,false);
 assert.equal(customerBaasInput.safeParse({disposition:'SEPARATE',amount:100,period:'MONTH',recipient:'电池出租方'}).success,true);
});
test('profile contact email is optional and authority provenance survives strict DTO',()=>{
 const contractProfile={serviceContactName:'联系人',serviceContactChannel:'电话留痕',signerAuthorityRole:'LEGAL_REPRESENTATIVE',authorityEvidenceFileIds:['evidence']};
 assert.deepEqual(simplePartnerProfileInput.parse({name:'企业',contractProfile}).contractProfile,contractProfile);
});
test('product BaaS survives persisted reconstruction and frozen snapshot',()=>{
 const value={id:'p',productId:'product',version:1,name:'产品',months:12,minimumTermMonths:3,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',conditions:'实际条件',vehicleIds:['v'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}],customerBaas:{disposition:'NOT_APPLICABLE'}};
 assert.deepEqual(storedProductDraft(value).customerBaas,value.customerBaas);
 assert.deepEqual(versionSnapshot(value).customerBaas,value.customerBaas);
});
test('cooperation requires explicit dated per-vehicle and product/template authorization; unknown is not none',()=>{
 assert.equal(cooperationSourcesInput.safeParse({vehicleScopes:[{vehicleId:'v',validFrom:'2026-11-01',validUntil:'2027-11-01',rightsRestrictions:{status:'NONE',evidenceFileIds:['proof']},authorityEvidenceFileIds:['proof']}],productVersionIds:['p'],templateRefs:[{id:'t',hash:'a'.repeat(64)}]}).success,true);
 assert.equal(cooperationSourcesInput.safeParse({vehicleScopes:[{vehicleId:'v'}]}).success,false);
});
test('source freezing is deterministic, detached and refuses changed subjects',()=>{
 const input={schema:'NINDA_V31_SOURCES',parties:{OWNER:{id:'owner',revision:1,hash:'a'}}};
 const frozen=sources.freezeV31Sources(input);input.parties.OWNER.id='other';
 assert.equal((frozen.snapshot as any).parties.OWNER.id,'owner');
 assert.throws(()=>sources.assertV31SourcesCurrent(frozen,sources.freezeV31Sources(input)),(e:any)=>e.getResponse().error.code==='V31_SOURCES_CHANGED');
});

test('legal representatives reuse existing verified authority evidence, delegates still supply explicit authority scope',()=>{
 const profile={serviceContactName:'联系人',serviceContactChannel:'电话',signerAuthorityRole:'LEGAL_REPRESENTATIVE'};
 assert.equal(simplePartnerProfileInput.safeParse({name:'企业',contractProfile:profile}).success,true);
 assert.equal(simplePartnerProfileInput.safeParse({name:'企业',contractProfile:{...profile,signerAuthorityRole:'AUTHORIZED_REPRESENTATIVE'}}).success,false);
});

// The database boundary is controlled here to reproduce unordered query results exactly.
function subscriptionSourceFixture(productVersionId:string|undefined,reverse=false){
 const digest='a'.repeat(64),files=[{id:'e1',sha256:digest,adminId:'staff',customerId:null},{id:'e2',sha256:'b'.repeat(64),adminId:'staff',customerId:null}];
 const owner={id:'owner',revision:1,status:'VERIFIED',subjectType:'ENTERPRISE',name:'合作企业',creditCode:'123',address:'住所',contractProfile:{serviceContactName:'联系',serviceContactChannel:'电话',signerAuthorityRole:'LEGAL_REPRESENTATIVE',authorityEvidenceFileIds:['e1','e2']}};
 const product={id:'authorized-product',productId:'product',revision:1,version:1,status:'PUBLISHED',name:'产品',months:12,minimumTermMonths:3,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',conditions:'条件',vehicleIds:['vehicle'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}],customerBaas:{disposition:'INCLUDED'}};
 const documents=[{fileId:'doc1',sha256:digest,category:'REGISTRATION'},{fileId:'doc2',sha256:'b'.repeat(64),category:'AUTHORITY'}];
 const agreement={id:'cooperation',ownerId:'owner',version:1,contentHash:digest,validFrom:'2026-01-01',validUntil:'2027-12-31',partnerRateBps:6000,vehicleIds:['vehicle'],electronicTerms:{v31Sources:{vehicleScopes:[{vehicleId:'vehicle',validFrom:'2026-01-01',validUntil:'2027-12-31',authorityEvidenceFileIds:['e1','e2'],rightsRestrictions:{status:'NONE',evidenceFileIds:['e1','e2']}}],productVersionIds:['authorized-product'],templateRefs:[{id:'template',hash:digest}]}}};
 const order={id:'order',revision:2,vehicleId:'vehicle',customerId:'customer',finalPlanSnapshot:{commercialHash:digest,lessorSnapshot:{ownerId:'owner',agreementVersionId:'cooperation',vehicleId:'vehicle'},...(productVersionId===undefined?{}:{months:product.months,productSnapshot:{...versionSnapshot(product as any),productVersionId}})}};
 const tx:any={order:{findUnique:async()=>order},vehicleOwner:{findUnique:async()=>owner},ownerESignAccount:{findUnique:async()=>null},customer:{findUnique:async()=>({id:'customer',name:'客户'})},eSignAccount:{findUnique:async()=>null},customerQualificationVersion:{findFirst:async()=>null},partnerAgreementVersion:{findUnique:async()=>agreement},partnerAccountVersion:{findFirst:async()=>null},productVersion:{findUnique:async()=>product},legalDocument:{findUnique:async()=>null},vehicle:{findUnique:async()=>({id:'vehicle',revision:1,vin:'VIN',assetProfile:{revision:1,registeredOwnerName:'登记人'},documentFiles:reverse?[...documents].reverse():documents})},insurancePolicyVersion:{findMany:async()=>[]},storedFile:{findMany:async({where}:any)=>{const result=files.filter(f=>where.id.in.includes(f.id));return reverse?[...result].reverse():result;}}};
 return{tx,context:{kind:'SUBSCRIPTION' as const,resourceId:'order',revision:2,businessHash:digest}};
}
test('public subscription source binding rejects missing or empty actual product references',async()=>{
 for(const productVersionId of [undefined,'','   ']){
  const {tx,context}=subscriptionSourceFixture(productVersionId);
  await assert.rejects(sources.resolveV31Sources(tx,context),(e:any)=>e.getResponse?.().error.code==='V31_PRODUCT_SOURCE_REQUIRED');
 }
});
test('public subscription source binding reports unauthorized selected product and accepts actual authorized product',async()=>{
 const unauthorized=subscriptionSourceFixture('other-product');await assert.rejects(sources.resolveV31Sources(unauthorized.tx,unauthorized.context),(e:any)=>e.getResponse?.().error?.code==='V31_PRODUCT_SOURCE_REQUIRED');
 const authorized=subscriptionSourceFixture('authorized-product'),allowed=await sources.resolveV31Sources(authorized.tx,authorized.context);
 assert.equal(allowed.missing.some(m=>m.field==='product.authorization'),false);
 assert.equal((allowed.snapshot as any).products[0].id,'authorized-product');
});
test('resolver freezes identical snapshots and hashes when database evidence and vehicle document sets reverse',async()=>{
 const forward=subscriptionSourceFixture('authorized-product'),backward=subscriptionSourceFixture('authorized-product',true);
 const first=await sources.resolveV31Sources(forward.tx,forward.context),second=await sources.resolveV31Sources(backward.tx,backward.context);
 assert.deepEqual(first.snapshot,second.snapshot);
 assert.equal(sources.freezeV31Sources(first.snapshot).hash,sources.freezeV31Sources(second.snapshot).hash);
});
