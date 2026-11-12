import test from 'node:test';
import assert from 'node:assert/strict';
import {BaasService} from '../src/vehicle-baas/service';
import {canonicalHash} from '../src/customers/types';
import {baasTerms} from '../src/asset-costs/source';
import {assetActor,assetCommand,assetError,assetFixture,assetNow,prepareBaasRegistration} from './asset-ledger-fixture';

function fixture(){const f=assetFixture(),service=new BaasService(()=>assetNow);f.seed('vehicleAssetProfile',{vehicleId:'vehicle',revision:1,batteryOwnership:'BAAS'});return{...f,service};}
async function draft(f:ReturnType<typeof fixture>,extra:any={}){const row=await f.serial(tx=>f.service.create(tx,assetActor,{...assetCommand(),vehicleId:'vehicle',vehicleRevision:3,assetRevision:1,provider:'合成出租方',batteryPackage:'75kWh',effectiveFrom:'2027-02-15',effectiveTo:'2027-02-15',billingCycle:'MONTHLY',rentalAmount:72800,paymentDayOfMonth:8,...extra}));prepareBaasRegistration(f,row.id);return row;}

test('explicit archived activation includes the Shanghai end day and does not activate missing or future dates',async()=>{
 const f=fixture(),created=await draft(f),row=f.rows('vehicleBaasContract')[0];row.status='ARCHIVED';f.attach('BAAS',row.id);
 const active=await f.serial(tx=>f.service.transition(tx,assetActor,row.id,'activate',{...assetCommand(),reason:'今日仍在有效期'}));assert.equal(active.status,'ACTIVE');assert.equal(new Date(active.activatedAt).getTime(),assetNow.getTime());
 const future=fixture(),later=await draft(future,{effectiveFrom:'2027-02-16',effectiveTo:null});future.attach('BAAS',later.id);await assert.rejects(future.serial(tx=>future.service.transition(tx,assetActor,later.id,'activate',{...assetCommand(),reason:'尚未到期'})),assetError('BAAS_OUTSIDE_EFFECTIVE_DATES'));
 const expired=fixture(),old=await draft(expired,{effectiveFrom:'2026-01-01',effectiveTo:'2027-02-14'});expired.attach('BAAS',old.id);await assert.rejects(expired.serial(tx=>expired.service.transition(tx,assetActor,old.id,'activate',{...assetCommand(),reason:'已经过期'})),assetError('BAAS_OUTSIDE_EFFECTIVE_DATES'));
 const incomplete=fixture(),missing=await draft(incomplete,{effectiveFrom:null,effectiveTo:null});incomplete.rows('vehicleBaasContract')[0].status='ARCHIVED';incomplete.attach('BAAS',missing.id);await assert.rejects(incomplete.serial(tx=>incomplete.service.transition(tx,assetActor,missing.id,'activate',{...assetCommand(),reason:'缺日期'})),assetError('BAAS_REGISTRATION_INCOMPLETE'));
});

test('validity filtering occurs before pagination and keeps incomplete archived records truthful',async()=>{
 const f=fixture(),base=await draft(f),row=f.rows('vehicleBaasContract')[0];row.status='ACTIVE';row.activatedAt=assetNow;f.attach('BAAS',row.id);
 for(const [id,status,from,to]of [['expired','ACTIVE','2026-01-01','2027-02-14'],['future','DRAFT','2027-02-16',null],['incomplete','ARCHIVED',null,null],['suspended','SUSPENDED','2026-01-01',null]]){const copy={...structuredClone(row),id,status,effectiveFrom:from?new Date(from+'T00:00:00Z'):null,effectiveTo:to?new Date(to+'T00:00:00Z'):null,activatedAt:status==='DRAFT'||status==='ARCHIVED'?null:assetNow,createdAt:new Date('2027-02-16T00:00:00Z')};copy.termsHash=canonicalHash(baasTerms(copy));f.seed('vehicleBaasContract',copy);f.attach('BAAS',id,id+'-pdf');}
 const current=await f.service.list(f.tx,assetActor,{vehicleId:'vehicle',group:'CURRENT',page:'1',pageSize:'1'});assert.equal(current.total,1);assert.equal(current.items[0].id,base.id);assert.equal(current.items[0].validityLabel,'有效中');assert.deepEqual(current.groupCounts,{CURRENT:1,EXPIRED:1,OTHER:3});assert.equal(current.serverDate,'2027-02-15');
 const expired=await f.service.list(f.tx,assetActor,{group:'EXPIRED',page:'1',pageSize:'1'});assert.equal(expired.total,1);assert.equal(expired.items[0].id,'expired');
 const other=await f.service.list(f.tx,assetActor,{group:'OTHER',page:'2',pageSize:'1'});assert.equal(other.total,3);assert.equal(other.items[0].id,'incomplete');assert.equal(other.items[0].validityState,'INCOMPLETE');assert.equal(other.items[0].validityLabel,'待完善');
});
