import test from 'node:test';
import assert from 'node:assert/strict';
import {legalDocumentView,legalFilePath,legalPreviewKey} from './legal-documents.ts';
import type {LegalTask} from './legal-client.ts';
const task=(overrides:Partial<LegalTask>={}):LegalTask=>({id:'task',kind:'COOPERATION',orderId:null,status:'SIGNING',revision:7,sourceSha256:'a'.repeat(64),parties:[{role:'OWNER',mode:'MANUAL',status:'SIGNED',signedAt:'2026-11-09T00:00:00Z'},{role:'PLATFORM',mode:'MANUAL',status:'UNKNOWN',signedAt:null}],nextAction:{kind:'QUERY',role:'PLATFORM'},stopStatus:'NONE',evidenceReviewStatus:'NONE',legalCompletedAt:null,archivedAt:null,filingStatus:'NOT_STARTED',finalFileAvailable:false,grant:null,frozenSources:{parties:{OWNER:{id:'owner'},PLATFORM:{id:'platform'}}},...overrides});
test('unknown and failed participants stay unchecked even when another party has signed',()=>{
 for(const status of ['UNKNOWN','DECLINED','EXPIRED','FAILED']){
  const value=task();value.parties[1].status=status;
  const view=legalDocumentView(value);
  assert.equal(view.state,'待签署');assert.deepEqual(view.parties.map(p=>p.signed),[true,false]);
  assert.ok(!view.parties[1].status.includes(status));
 }
});
test('all signatures with pending, failed or unconfirmed archive remain awaiting archive',()=>{
 const value=task();value.parties[1].status='SIGNED';value.parties[1].signedAt='2026-11-09T00:00:00Z';
 for(const filingStatus of ['NOT_STARTED','REQUESTED','UNKNOWN','CONFIRMED']){
  const view=legalDocumentView({...value,status:'ARCHIVING',filingStatus,lastErrorCode:'ELECTRONIC_FINAL_VERIFICATION_FAILED'});
  assert.equal(view.state,'待归档');assert.equal(view.allSigned,true);assert.match(view.hint,/无需重新签署/);assert.match(view.hint,/状态刷新/);assert.ok(!view.hint.includes('ELECTRONIC'));
 }
 assert.equal(legalDocumentView({...value,status:'ARCHIVED',archivedAt:'2026-11-10T00:00:00Z'}).state,'已归档');
 assert.equal(legalDocumentView({...value,status:'ARCHIVED',archivedAt:null}).state,'待归档');
});
test('preview identity changes with company, session, revision, content and source/signed variant',()=>{
 const value=task(),key=legalPreviewKey('session','company',value,'source');
 const others=[legalPreviewKey('other','company',value,'source'),legalPreviewKey('session','other',value,'source'),legalPreviewKey('session','company',{...value,id:'other'},'source'),legalPreviewKey('session','company',{...value,revision:8},'source'),legalPreviewKey('session','company',{...value,sourceSha256:'b'.repeat(64)},'source'),legalPreviewKey('session','company',value,'signed')];
 assert.ok(others.every(v=>v!==key));
 assert.equal(legalFilePath('company','task','signed'),'/owners/company/electronic-documents/task/files/signed');
 assert.throws(()=>legalFilePath('../foreign','task','source'));assert.throws(()=>legalFilePath('company','task?token=bad','source'));
});
