import test from 'node:test';
import assert from 'node:assert/strict';
import {renewalActionAllowed,renewalDetailSafe,renewalListSafe} from './renewal.ts';

const record={id:'renewal',kind:'SUBSCRIPTION_EXTENSION',status:'AWAITING_FINANCE',revision:4,canQuote:true,canReview:true,canPublish:true,canCancel:true,canPrepareFinance:true,canSchedule:true,canActivate:true,quote:{createdBy:'maker'}};
const completedAt='2026-10-31T10:00:00.000Z';
test('list and detail preserve only the safe cancellation summary and suppress stale renewal capabilities',()=>{
 for(const cancellation of [{id:'case',status:'OPEN',completedAt:null},{id:'case',status:'COMPLETED',completedAt}]){
  const raw={...record,cancellation:{...cancellation,signatureEvidenceFileIds:['private-file'],mutualAgreementNote:'private-note',sourceSnapshot:{secret:'private-source'}}};
  for(const project of [renewalListSafe,renewalDetailSafe]){const value:any=project(raw);assert.deepEqual(value.cancellation,cancellation);assert.equal(JSON.stringify(value).includes('private-'),false);}
  const detail:any=renewalDetailSafe(raw);
  for(const action of ['quotes','review','publish','cancel','finance/prepare','schedule','activate'])assert.equal(renewalActionAllowed(action,detail,'ADMIN','reviewer',['*']),false,action);
  for(const key of ['canQuote','canReview','canPublish','canCancel','canPrepareFinance','canSchedule','canActivate'])assert.equal(detail[key],false,key);
 }
});
test('legacy missing or null cancellation preserves the existing API capability and role checks',()=>{
 for(const value of [record,{...record,cancellation:null}]){
  const detail:any=renewalDetailSafe(value);assert.equal(detail.cancellation,null);assert.equal((renewalListSafe(value) as any).cancellation,null);assert.equal(detail.canSchedule,true);assert.equal(renewalActionAllowed('schedule',detail,'FINANCE','reviewer',['order-changes.write']),true);assert.equal(renewalActionAllowed('schedule',detail,'OPERATIONS','reviewer',['*']),false);
 }
});
test('unknown or incomplete cancellation fails closed before displaying detail or allowing stale actions',()=>{
 const invalid=[{},[],{id:'case',status:'PENDING',completedAt:null},{id:'case',status:'OPEN'},{id:'case',status:'OPEN',completedAt},{id:'case',status:'COMPLETED',completedAt:null},{id:'case',status:'COMPLETED',completedAt:'2026-02-30T10:00:00.000Z'},{id:'case',status:'COMPLETED',completedAt:'not-a-date'},{id:'\0case',status:'OPEN',completedAt:null},{id:'',status:'OPEN',completedAt:null}];
 for(const cancellation of invalid){const value={...record,cancellation};assert.throws(()=>renewalDetailSafe(value));assert.throws(()=>renewalListSafe(value));assert.equal(renewalActionAllowed('schedule',value,'FINANCE','reviewer',['*']),false);}
});
