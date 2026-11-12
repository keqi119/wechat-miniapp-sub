import test from 'node:test';
import assert from 'node:assert/strict';
import {baasDraftPayload,baasActions,baasValidityLabel,type BaasContract} from './asset-model.ts';
import {listLocationState,updateListLocation,recordLocation,processHref,processReturnTarget} from './process-navigation.ts';
const row={id:'b',vehicleId:'v',revision:7,status:'ARCHIVED',provider:null,batteryPackage:null,effectiveFrom:null,effectiveTo:null,billingCycle:null,rentalAmount:null,paymentDayOfMonth:null,files:[],activatedAt:null,validityGroup:'OTHER',validityState:'INCOMPLETE',validityLabel:'待完善'} as unknown as BaasContract;
test('archive correction requires an explicit bounded reason and keeps current revision',()=>{
 assert.throws(()=>baasDraftPayload({provider:'补录'},row),/修改说明/);
 assert.throws(()=>baasDraftPayload({changeReason:'x'.repeat(501)},row),/修改说明/);
 const body=baasDraftPayload({provider:'补录',rentalYuan:'728.00',changeReason:'  依据合同原件补全  '},row);
 assert.equal(body.changeReason,'依据合同原件补全');assert.equal(body.revision,7);assert.equal(body.rentalAmount,72800);assert.equal('status' in body,false);assert.equal('activatedAt' in body,false);
 assert.equal(baasDraftPayload({provider:'草稿'}, {...row,status:'DRAFT'}).changeReason,undefined);
});
test('BaaS display uses server projection and never labels incomplete archives as expired',()=>{
 assert.equal(baasValidityLabel(row),'待完善');assert.equal(baasValidityLabel({...row,validityState:'EXPIRED',validityLabel:'已过期'}),'已过期');
 assert.equal(baasValidityLabel({...row,validityLabel:undefined,validityState:undefined}),'已归档');
});
test('activation ignores voided attachments and only offers archive activation explicitly eligible',()=>{
 const full={...row,provider:'出租方',batteryPackage:'75kWh',effectiveFrom:'2026-01-01',billingCycle:'MONTHLY',rentalAmount:72800,paymentDayOfMonth:8,activatedAt:null,serverDate:'2026-11-05',registrationReadiness:{ready:true,checks:[],missingFields:[],signedPdfFiles:[{id:'proof',name:'signed.pdf',sha256:'a'.repeat(64)}]},files:[{id:'proof',state:'VOIDED',mimeType:'application/pdf'}]} as unknown as BaasContract;
 assert.deepEqual(baasActions(full),[]);
 assert.deepEqual(baasActions({...full,files:[{id:'proof',state:'ACTIVE',mimeType:'application/pdf'} as any]}),['activate']);
 assert.deepEqual(baasActions({...full,activatedAt:'2026-01-01T00:00:00Z',files:[{id:'proof',state:'ACTIVE',mimeType:'application/pdf'} as any]}),[]);
});
test('BaaS grouping and vehicle scope survive exact record and return navigation',()=>{
 const origin='#vehicles?record=v&view=battery-baas';const href=processHref('#baas-contracts?vehicleId=v&group=OTHER',origin);
 assert.equal(listLocationState(href).baasGroup,'OTHER');assert.equal(listLocationState(href).vehicleId,'v');
 const record=recordLocation(href,'b');assert.equal(processReturnTarget(record),origin);assert.equal(listLocationState(record).vehicleId,'v');
 const next=updateListLocation(record,{...listLocationState(record),baasGroup:'EXPIRED',page:2});assert.equal(new URLSearchParams(next.split('?')[1]).get('group'),'EXPIRED');assert.equal(new URLSearchParams(next.split('?')[1]).get('record'),'b');
});

test('group selection stays BaaS-only and date-ineligible contracts do not advertise activation',()=>{
 const full={...row,status:'DRAFT',provider:'出租方',batteryPackage:'75kWh',effectiveFrom:'2026-11-05',effectiveTo:'2026-11-05',billingCycle:'MONTHLY',rentalAmount:72800,paymentDayOfMonth:8,serverDate:'2026-11-05',registrationReadiness:{ready:true,checks:[],missingFields:[],signedPdfFiles:[{id:'proof',name:'signed.pdf',sha256:'a'.repeat(64)}]},files:[{id:'proof',state:'ACTIVE',mimeType:'application/pdf'}]} as unknown as BaasContract;
 assert.deepEqual(baasActions(full),['activate','archive']);assert.deepEqual(baasActions({...full,serverDate:'2026-11-06'}),['archive']);assert.deepEqual(baasActions({...full,serverDate:'2026-11-04'}),['archive']);
 const unrelated=updateListLocation('#orders?group=OTHER',{keyword:'',status:'',page:1});assert.equal(new URLSearchParams(unrelated.split('?')[1]).has('group'),false);
});
