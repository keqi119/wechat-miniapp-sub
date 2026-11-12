import {test} from 'node:test';
import assert from 'node:assert/strict';
import {offlineSwapPhysicalFixture} from './offline-swap-physical-fixture';
import {reviseHandoverRecord} from '../src/operations/handover-records';
import {assertOfflineSwapHandoverSource} from '../src/vehicle-changes/offline-physical-source';
const code=(value:string)=>(error:any)=>error.getResponse?.().error?.code===value;

test('a customer objection can correct physical facts under the same real paper quote, preserving revision history and exact FIELD source',async()=>{
 const f=await offlineSwapPhysicalFixture(),old=f.addFact('RETURN','return-task');Object.assign(old,{status:'OBJECTION_SUBMITTED',revision:1});
 const input={actualAt:new Date('2026-10-30T01:20:00Z').toISOString(),readingKm:320,fileIds:['new-proof'],checklist:[{label:'真实车况',value:'客户指出后重新核验'},{label:'车辆身份',value:'不得篡改身份'}],resolutionNote:'按现场原件核实里程'};
 const revised=await reviseHandoverRecord(f.tx,old.id,input,'field','return-task');
 assert.equal(old.status,'SUPERSEDED');assert.equal(revised.previousHandoverId,old.id);assert.equal(revised.revision,2);assert.equal(revised.resolutionNote,input.resolutionNote);assert.equal(revised.fieldTaskId,'return-task');assert.equal(revised.readingKm,320);assert.equal(revised.actualAt.toISOString(),input.actualAt);assert.equal(f.change.returnHandoverId,revised.id);assertOfflineSwapHandoverSource(revised,f.change,f.q);
 assert.equal(revised.checklist.some((r:any)=>r.value==='不得篡改身份'),false);
});

test('old quote or borrowed FIELD task cannot be used to revise an OFFLINE physical handover',async()=>{
 for(const invalid of ['quote','task']){const f=await offlineSwapPhysicalFixture(),old=f.addFact('RETURN','return-task'),count=f.handovers.length;Object.assign(old,{status:'OBJECTION_SUBMITTED',revision:1});if(invalid==='quote')old.manifestHash='a'.repeat(64);
  const input={actualAt:old.actualAt.toISOString(),readingKm:320,fileIds:['new-proof'],checklist:old.checklist,resolutionNote:'修订'};
  await assert.rejects(reviseHandoverRecord(f.tx,old.id,input,'field',invalid==='task'?'other-task':'return-task'),code(invalid==='task'?'FIELD_SWAP_SOURCE_CHANGED':'SWAP_HANDOVER_SOURCE_CHANGED'));assert.equal(old.status,'OBJECTION_SUBMITTED');assert.equal(f.handovers.length,count);
 }
});
