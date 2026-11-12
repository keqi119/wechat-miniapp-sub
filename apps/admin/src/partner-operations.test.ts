import {readFields} from './domain-commands.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPartnerCapability, partnerCapabilityGroups, ruleDraftBody, cooperationReviewBody } from './partner-operations.ts';
import type {Submission} from './partner-operations.ts';
import { routeAllowed } from './modules/navigation.ts';
test('partner permissions are exact grants, without ADMIN or FINANCE defaults',()=>{
 assert.equal(hasPartnerCapability({role:'FINANCE',permissions:['*']},'partner.rules.read'),false);
 assert.equal(hasPartnerCapability({role:'ADMIN',permissions:['*']},'partner.rules.read'),false);
 assert.equal(hasPartnerCapability({role:'FIELD',partnerCapabilities:['partner.rules.read']},'partner.rules.read'),false);
 assert.equal(hasPartnerCapability({role:'OPERATIONS',partnerCapabilities:['partner.rules.read']},'partner.rules.read'),true);
 assert.equal(partnerCapabilityGroups.flatMap(g=>g.capabilities).length,19);
 assert.equal(routeAllowed('partner-settlements','FINANCE',['*']),false);
 assert.equal(routeAllowed('partner-settlements','OPERATIONS',[],['partner.settlements.read']),true);
 assert.equal(routeAllowed('refunds','SUPPORT',['*'],['partner.settlements.review']),false);
});
test('rule draft leaves unagreed basis, archive and dates null while retaining 20 percent as integer bps',()=>{
 const body=ruleDraftBody('owner',{method:'RATE',rateBps:2000,basis:'',validFrom:'',validUntil:'',cooperationVersionId:'',vehicleIds:[],evidenceFileIds:[]});
 assert.deepEqual(body,{ownerId:'owner',evidenceFileIds:[],terms:{method:'RATE',rateBps:2000,basis:null,validFrom:null,validUntil:null,cooperationVersionId:null,vehicleIds:[],fixedMonthlyAmount:null,customAgreement:null}});
});
test('aggregate review binds exact frozen resources and never fabricates checked flags',()=>{
 const submission:Submission={id:'batch',revision:7,hash:'frozen',domainVersions:[{domain:'SUBJECT',resourceId:'owner',revision:2},{domain:'VEHICLE',resourceId:'car',revision:4},{domain:'ARCHIVE',resourceId:'archive-version',revision:5},{domain:'RULE',resourceId:'rule-version',revision:3}]};
 assert.throws(()=>cooperationReviewBody(submission,{decision:'APPROVE',reason:'核对'},[]),/核对/);
 const reviews=[{identityChecked:true,ownershipChecked:true,representativeAuthorityChecked:true},{ownershipChecked:true},{checklist:{partiesComplete:true},partyChecks:[]},{termsChecked:true}];
 const body=cooperationReviewBody(submission,{decision:'APPROVE',reason:'核对'},reviews);
 assert.equal(body.submissionId,'batch'); assert.equal(body.submissionHash,'frozen');
 assert.deepEqual(body.domainReviews.map((r:any)=>[r.domain,r.resourceId,r.revision]),[['SUBJECT','owner',2],['VEHICLE','car',4],['ARCHIVE','archive-version',5],['RULE','rule-version',3]]);
 assert.equal(body.domainReviews[0].review, reviews[0]);
});

test('honest rejection retains unchecked facts while approval requires affirmative checks',()=>{
 const fields:any[]=[{key:'identityChecked',label:'主体身份',kind:'check',requiredWhen:{key:'decision',value:'APPROVE'}}];
 assert.throws(()=>readFields(fields,{decision:'APPROVE'}),/主体身份/);
 assert.deepEqual(readFields(fields,{decision:'REJECT'}),{identityChecked:false});
 assert.deepEqual(readFields(fields,{decision:'APPROVE',identityChecked:true}),{identityChecked:true});
});


test('ADMIN defaults apply only to ordinary cooperation and portal, while financial capabilities remain exact grants',()=>{
 const admin={role:'ADMIN',permissions:['*']};
 for(const key of ['partner.cooperation.read','partner.cooperation.write','partner.cooperation.review','partner.portal.review'])assert.equal(hasPartnerCapability(admin,key),true,key);
 for(const key of ['partner.rules.review','partner.accounts.review','partner.settlements.review','partner.payments.review'])assert.equal(hasPartnerCapability(admin,key),false,key);
});
