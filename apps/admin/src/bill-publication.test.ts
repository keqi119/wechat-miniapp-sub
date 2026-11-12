import test from 'node:test';
import assert from 'node:assert/strict';
import {actionAllowed} from './resources.ts';
import {billPublicationView} from './bill-publication.ts';
import {roleDetail} from './modules/navigation.ts';

test('scheduled rent and deposit bills never expose manual publication, including older API responses',()=>{
 for(const type of ['SUBSCRIPTION','DEPOSIT'])for(const publication of [undefined,{mode:'AUTOMATIC',state:'SCHEDULED'},{mode:'MANUAL',state:'MANUAL'}]){
  const bill={id:'bill',type,status:'DRAFT',publication};
  assert.equal(actionAllowed('bills',{label:'发布账单',path:'publish'},bill,'finance'),false,`${type} publication`);
  assert.equal(actionAllowed('bills',{label:'审核费用账单',path:'review'},bill,'finance'),false,`${type} review`);
 }
});

test('extra fees retain independent review and publication after review',()=>{
 for(const type of ['EXTRA_FEE','RETURN_SETTLEMENT','MILEAGE_EXCESS']){
  const bill={id:'bill',type,status:'DRAFT',createdBy:'creator'};
  assert.equal(actionAllowed('bills',{label:'审核',path:'review'},bill,'creator'),false);
  assert.equal(actionAllowed('bills',{label:'审核',path:'review'},bill,'finance'),true);
  assert.equal(actionAllowed('bills',{label:'发布',path:'publish'},bill,'finance'),false);
  assert.equal(actionAllowed('bills',{label:'发布',path:'publish'},{...bill,status:'REVIEWED'},'finance'),true);
 }
});

test('server publication terminal states do not show a future automatic release promise',()=>{
 for(const [state,title] of [['CLOSED','账单已关闭'],['PUBLISHED','账单已发布']]){
  const view=billPublicationView({type:'SUBSCRIPTION',status:'DRAFT',publication:{mode:'AUTOMATIC',scheduledDate:'2026-11-27',state,message:'服务端已确认的发布结果',blockers:[]}});
  assert.equal(view.title,title);assert.doesNotMatch(view.message,/将.*发布|等待.*任务/);
 }
});

test('finance retains the contract route and safe publication facts without exposing unrelated bill fields',()=>{
 const publication={mode:'AUTOMATIC',scheduledDate:'2026-11-27',state:'BLOCKED',message:'合同待归档',blockers:['OFFLINE_ARCHIVE_REQUIRED'],internalNote:'private'};
 const projected=roleDetail('orders',{id:'order',contractMode:'OFFLINE',bills:[{id:'bill',publication,internalNote:'private'}]},'FINANCE');
 assert.equal(projected.contractMode,'OFFLINE');
 assert.deepEqual(projected.bills,[{id:'bill',publication:{mode:'AUTOMATIC',scheduledDate:'2026-11-27',state:'BLOCKED',message:'合同待归档',blockers:['OFFLINE_ARCHIVE_REQUIRED']}}]);
 assert.equal(roleDetail('orders',{id:'order',bills:[{id:'bill',publication}]},'SUPPORT').bills,undefined);
});

test('missing or malformed plans never invent a scheduled date or show raw blocker codes',()=>{
 for(const publication of [undefined,null,[],{mode:'AUTOMATIC',state:'UNKNOWN',scheduledDate:'2026-02-30',blockers:['PRIVATE_CODE']}]){
  const view=billPublicationView({type:'DEPOSIT',status:'DRAFT',publication});
  assert.equal(view.scheduledDate,null);assert.match(view.title,/待核对/);assert.doesNotMatch(view.message,/PRIVATE_CODE|2026-02-30/);
 }
 const blocked=billPublicationView({type:'SUBSCRIPTION',status:'DRAFT',publication:{mode:'AUTOMATIC',state:'BLOCKED',scheduledDate:'2026-02-30',blockers:['PRIVATE_CODE']}});
 assert.equal(blocked.scheduledDate,null);assert.doesNotMatch(blocked.message,/PRIVATE_CODE/);
});
