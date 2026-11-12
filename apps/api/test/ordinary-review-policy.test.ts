import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOrdinaryReview,assertOrdinaryStaffReview} from '../src/auth/ordinary-review';
import {assertIndependentStaffReview,requirePartnerCapability} from '../src/partners/capabilities';
import {archiveReviewAvailable} from '../src/orders/order-process-facts';
const admin={id:'maker',role:'ADMIN',authVersion:1};
const tx:any={adminUser:{findUnique:async()=>({...admin,active:true,staffPersonId:'person',partnerCapabilities:[]}),findMany:async()=>[{id:'maker',staffPersonId:'person'}]}};
test('ADMIN ordinary material self review is allowed; OPS still cannot review own upload/edit/submit',async()=>{assert.doesNotThrow(()=>assertOrdinaryReview(admin,['maker']));assert.throws(()=>assertOrdinaryReview({...admin,role:'OPERATIONS'},['maker']));await assertOrdinaryStaffReview(tx,admin,['maker']);});
test('ADMIN ordinary partner permissions require current session but no extra financial capability grant',async()=>{await requirePartnerCapability(tx,admin,'partner.cooperation.review');await assert.rejects(()=>requirePartnerCapability(tx,admin,'partner.rules.review'));await assert.rejects(()=>requirePartnerCapability(tx,{...admin,authVersion:2},'partner.cooperation.review'));});
test('financial self review never inherits ADMIN ordinary exception',async()=>{await assert.rejects(()=>assertIndependentStaffReview(tx,'maker',['maker']));});
test('archive review projection allows ADMIN self review, rejects OPS self review and FIELD',()=>{const a={versions:[{status:'SUBMITTED',submittedBy:'maker',files:[{uploadedBy:'maker'}]}]};assert.equal(archiveReviewAvailable(a,admin),true);assert.equal(archiveReviewAvailable(a,{...admin,role:'OPERATIONS'}),false);assert.equal(archiveReviewAvailable(a,{id:'other',role:'FIELD'}),false);});


test('insurance and partner identity ordinary policies share ADMIN-only exception',async()=>{
 const insurance=await import('../src/insurance/service'),partner=await import('../src/partners/types');
 const version={createdBy:'maker',submittedBy:'maker',editedByIds:['maker']},files=[{adminId:'maker'}];
 assert.doesNotThrow(()=>insurance.assertIndependentReview('maker',version,files,'ADMIN'));
 assert.throws(()=>insurance.assertIndependentReview('maker',version,files,'OPERATIONS'));
 assert.doesNotThrow(()=>partner.assertIndependentReview('maker','maker',files,'ADMIN'));
 assert.throws(()=>partner.assertIndependentReview('maker','maker',files,'OPERATIONS'));
});
