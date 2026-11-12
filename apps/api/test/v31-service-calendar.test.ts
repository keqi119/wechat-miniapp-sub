import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync} from 'node:fs';
import {productDraftInput} from '../src/products/types';
import {versionSnapshot,validatePublishedVersion} from '../src/products/snapshot';
import {productDraftData,storedProductDraft} from '../src/products/configuration';
const draft={name:'三个月方案',months:3,minimumTermMonths:3,conditions:'条件',vehicleIds:['v'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}],monthlyFeeAmount:2800,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付'};
const stored=(fields:any={})=>({id:'pv',productId:'p',version:1,...draft,...fields});
async function rules(){assert.ok(existsSync('src/service-calendar/rules.ts'),'shared V31 calendar must exist');return import('../src/service-calendar/rules');}
test('three month product publishes; two months and actual below independent minimum reject',()=>{
 assert.equal(productDraftInput.safeParse(draft).success,true);
 assert.equal(productDraftInput.safeParse({...draft,months:2}).success,false);
 assert.equal(productDraftInput.safeParse({...draft,months:3,minimumTermMonths:12}).success,false);
 assert.doesNotThrow(()=>validatePublishedVersion(stored(),true));
 assert.throws(()=>validatePublishedVersion(stored({minimumTermMonths:undefined}),true));
});
test('minimum 3 and actual 12 persist independently and legacy snapshots gain no invented minimum',()=>{
 const parsed=productDraftInput.parse({...draft,months:12});const data=productDraftData(parsed);
 assert.equal(data.months,12);assert.equal(data.minimumTermMonths,3);
 assert.equal(storedProductDraft({...stored(),...data}).minimumTermMonths,3);
 assert.equal(versionSnapshot({...stored(),...data}).minimumTermMonths,3);
 const legacy=versionSnapshot(stored({months:12,minimumTermMonths:null}));assert.equal(Object.hasOwn(legacy,'minimumTermMonths'),false);
});
test('month end recovers original day across renewal and leap February',async()=>{
 const {servicePeriods}=await rules();const a={firstStartDay:'2027-01-31',anchorDay:31,ruleVersion:'V31' as const};
 assert.deepEqual(servicePeriods(a,1,3).map(p=>p.endDayExclusive),['2027-02-28','2027-03-31','2027-04-30']);
 assert.equal(servicePeriods(a,4,1)[0].endDayExclusive,'2027-05-31');
 assert.equal(servicePeriods({...a,firstStartDay:'2028-01-31'},1,1)[0].endDayExclusive,'2028-02-29');
});
test('unused fractional last service month refunds 1250 of 2800; full months retain full fee',async()=>{
 const {servicePeriods,remainingRentCents}=await rules();const periods=servicePeriods({firstStartDay:'2027-02-01',anchorDay:1,ruleVersion:'V31'},1,2);
 assert.equal(remainingRentCents(periods,[2800,3100],new Date('2027-02-16T12:00:00+08:00')),4350);
 assert.equal(remainingRentCents(periods,[2800,3100],new Date('2027-02-01T00:00:00+08:00')),5900);
 assert.equal(remainingRentCents(periods,[2800,3100],new Date('2027-04-01T00:00:00+08:00')),0);
});
test('billing and usage V31 callers share original anchor; legacy schedule stays stable',async()=>{
 await rules();const {billSchedule}=await import('../src/billing/rules');const {periods}=await import('../src/usage/rules');const {stagePeriods}=await import('../src/order-service-stages/source');
 const anchor={firstStartDay:'2027-01-31',anchorDay:31,ruleVersion:'V31' as const};
 assert.equal(billSchedule('2027-04-30',1,2800,{anchor,startPeriod:4})[0].amount,2800);
 assert.equal(stagePeriods('2027-04-30',1,4,2800,anchor)[0].endDate,'2027-05-31');
 assert.equal(periods('2027-04-30',1,{anchor,startPeriod:4})[0].endDate.toISOString().slice(0,10),'2027-05-31');
 assert.equal(billSchedule('2027-01-31',1,2800)[0].dueDate,'2027-01-31');
});

test('per-period rounding uses exact integer fractions and rejects malformed sources',async()=>{
 const {servicePeriods,remainingRentCents}=await rules();
 const a={firstStartDay:'2027-01-31',anchorDay:31,ruleVersion:'V31' as const};
 assert.throws(()=>servicePeriods({...a,anchorDay:30},1,1));assert.throws(()=>servicePeriods({...a,firstStartDay:'2027-02-30'},1,1));assert.throws(()=>servicePeriods(a,0,1));
 const p=servicePeriods({firstStartDay:'2027-02-01',anchorDay:1,ruleVersion:'V31'},1,1);
 assert.equal(remainingRentCents(p,[1],new Date('2027-02-15T00:00:00+08:00')),1);
 assert.throws(()=>remainingRentCents(p,[1.5],new Date()));assert.throws(()=>remainingRentCents(p,[],new Date()));
 assert.throws(()=>remainingRentCents([...p,{...p[0],index:2}],[1,1],new Date()));
});
test('non-midnight first delivery still bills the agreed complete service month',async()=>{
 const {shanghaiDay}=await import('../src/usage/rules');const {billSchedule}=await import('../src/billing/rules');
 const start=shanghaiDay(new Date('2027-02-01T15:45:00+08:00'));const anchor={firstStartDay:start,anchorDay:1,ruleVersion:'V31' as const};
 assert.deepEqual(billSchedule(start,1,2800,{anchor,startPeriod:1}),[{sequence:1,dueDate:'2027-02-01',amount:2800}]);
});
test('V31 stage snapshot binds the immutable order anchor and rejects substitutions',async()=>{
 const {parseStageSnapshot}=await import('../src/order-service-stages/source');const {canonicalHash}=await import('../src/customers/types');const {usageRules}=await import('../src/usage/policy');const {hash}=await import('../src/common/data');
 const anchor={firstStartDay:'2027-01-31',anchorDay:31,ruleVersion:'V31' as const};
 const policy={...usageRules,documentId:'usage',documentVersion:1,content:'frozen',hash:hash('frozen')};
 const t={startDate:'2027-01-31',months:3,monthlyFeeAmount:2800,depositAmount:0,mileagePerMonthKm:1500,excessMileagePriceAmount:150,usagePolicyVersion:'USAGE_V1',usagePolicy:policy,commercialHash:hash('commercial')};
 const order={id:'order',customerId:'customer',serviceAnchor:anchor,finalPlanSnapshot:t};
 const rows=[['2027-01-31','2027-02-28'],['2027-02-28','2027-03-31'],['2027-03-31','2027-04-30']].map(([startDate,endDate],i)=>({sequence:i+1,stageSequence:i+1,startDate,endDate,dueDate:startDate,amount:2800}));
 const s={version:1,kind:'INITIAL',serviceAnchor:anchor,identity:{serviceStageId:'initial:order',orderId:'order',customerId:'customer',sequence:1,previousStageId:null,vehicleId:'v',assignmentId:'a',ownerId:null},period:{startDate:'2027-01-31',endDate:'2027-04-30',months:3,firstPeriodSequence:1,lastPeriodSequence:3},termsSnapshot:t,usagePricing:{policyVersion:'USAGE_V1',baseAllowanceKm:1500,excessPriceAmount:150,sourceHash:canonicalHash(policy)},swapPolicy:null,billingSchedule:rows,source:{originalTermsHash:canonicalHash(t),product:null,agreement:{originalContractId:null,originalArchiveVersionId:null,originalArchiveHash:null,priorTermsVersionId:null,priorTermsHash:hash(t),changeId:null,quoteId:null,quoteRevision:null,commercialHash:t.commercialHash,approvedArchiveVersionId:null,approvedArchiveHash:null,document:null}}};
 assert.doesNotThrow(()=>parseStageSnapshot(s,order));
 const {serviceAnchor:omitted,...withoutAnchor}=s;assert.throws(()=>parseStageSnapshot(withoutAnchor,order));
 assert.throws(()=>parseStageSnapshot(s,{...order,serviceAnchor:{...anchor,anchorDay:30}}));
});
test('swap stage scope inherits the original anchor instead of reanchoring April 30',async()=>{
 const {parseSwapStageScope}=await import('../src/vehicle-changes/stage-source');
 const scope={version:1,serviceStageId:'stage',stageSourceHash:'a'.repeat(64),startDate:'2027-04-30',endDate:'2027-07-31',months:3,firstPeriodSequence:4,lastPeriodSequence:6,serviceAnchor:{firstStartDay:'2027-01-31',anchorDay:31,ruleVersion:'V31'}};
 assert.doesNotThrow(()=>parseSwapStageScope(scope));
});
test('voided billing sequence history does not advance the V31 calendar',async()=>{
 const {stagePeriods}=await import('../src/order-service-stages/source');const anchor={firstStartDay:'2027-01-31',anchorDay:31,ruleVersion:'V31' as const};
 assert.deepEqual(stagePeriods('2027-04-30',1,7,2800,anchor),[{sequence:7,stageSequence:1,startDate:'2027-04-30',endDate:'2027-05-31',dueDate:'2027-04-30',amount:2800}]);
});
