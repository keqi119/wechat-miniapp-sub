import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePayload,taskCommands,taskSelectionHref,currentPreparationMatches} from './electronic-contract-model.ts';
test('prepare uses command revision and excludes independently frozen source evidence',()=>{
 assert.deepEqual(preparePayload({kind:'RENEWAL',resourceId:'change',revision:8,sourceRevision:2,businessHash:'hash'},'key'),{kind:'RENEWAL',resourceId:'change',revision:8,idempotencyKey:'key'});
 assert.throws(()=>preparePayload({kind:'SUBSCRIPTION',resourceId:'o'},'key'));
});
test('dispatch requires exact current source resource/revision and preparation capability',()=>{
 const task={kind:'RENEWAL',frozenSources:{context:{resourceId:'change',revision:2}}};
 const rows=[{kind:'RENEWAL',resourceId:'change',revision:8,sourceRevision:2,canPrepare:true}];
 assert.equal(currentPreparationMatches(task,rows),true);
 assert.equal(currentPreparationMatches({kind:'RENEWAL',frozenSources:{context:{resourceId:'change'}}},[{...rows[0],sourceRevision:undefined}]),false);
 assert.equal(currentPreparationMatches(task,[{...rows[0],sourceRevision:3}]),false);
 assert.equal(currentPreparationMatches(task,[{...rows[0],resourceId:'other'}]),false);
 assert.equal(currentPreparationMatches(task,[{...rows[0],canPrepare:false}]),false);
});
test('read only/stopped and original-certificate cases never offer a new dispatch',()=>{
 assert.deepEqual(taskCommands({nextAction:{kind:'UPLOAD'},revision:2},false),[]);
 assert.deepEqual(taskCommands({nextAction:{kind:'UPLOAD'},revision:2,stopStatus:'NEEDS_REVIEW'},true),['sync']);
 assert.deepEqual(taskCommands({nextAction:{kind:'UPLOAD'},revision:2,evidenceReviewStatus:'ORIGINAL_CERTIFICATE_REQUIRED'},true),['sync']);
 assert.deepEqual(taskCommands({nextAction:{kind:'ARCHIVE'},revision:2},true),['sync','withdraw']);
});
test('task selection preserves actual order/list/back state',()=>{
 const href=taskSelectionHref('#orders?keyword=沪&page=3&record=o&view=contracts&returnTo=x','task-v2');
 const q=new URLSearchParams(href.split('?')[1]);assert.equal(q.get('record'),'o');assert.equal(q.get('page'),'3');assert.equal(q.get('task'),'task-v2');assert.equal(q.get('returnTo'),'x');
});
