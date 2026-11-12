import test from 'node:test';
import assert from 'node:assert/strict';
import {JourneyHarness,command,approval} from './seven-module-journey-fixtures';
import {resolveV31SourceIds} from '../src/contract-terms/sources';
import {canonicalHash} from '../src/customers/types';

test('candidate actual HTTP persists cooperation and authority originals with independent-person account review at default serial timeout',async()=>{
 const h=new JourneyHarness();await h.start();try{
 process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
 const proof=await h.proof(h.maker);
 const profile={name:'合成候选来源-'+h.prefix,address:'合成住所',contractProfile:{serviceContactName:'合成经办',serviceContactChannel:'电话',signerAuthorityRole:'AUTHORIZED_REPRESENTATIVE',authorityEvidenceFileIds:[proof.id]}};
 // Use the existing supported source role, no invented provider identity.
 profile.contractProfile.signerAuthorityRole='LEGAL_REPRESENTATIVE';
 const owner=await h.post('/admin/partners',{profile,idempotencyKey:command().idempotencyKey});
 const accountFile=await h.post(`/admin/partner-settlements/owners/${owner.id}/files`,h.form({kind:'ACCOUNT',idempotencyKey:command().idempotencyKey}));
 const account=await h.post(`/admin/partner-settlements/accounts/${owner.id}`,{...command(),accountName:owner.name,bankName:'合成银行',accountNumber:'6222000012345678',evidenceFileIds:[accountFile.id]});
 await h.reject(`/admin/partner-settlements/accounts/${account.id}/review`,approval(account.revision),h.samePersonAlias);
 assert.equal((await h.db.partnerAccountVersion.findUniqueOrThrow({where:{id:account.id}})).status,'SUBMITTED');
 await h.post(`/admin/partner-settlements/accounts/${account.id}/review`,approval(account.revision),h.reviewer);
 const car=await h.db.vehicle.create({data:{brand:'合成',model:'来源',title:'明确合成测试资产',year:2026,city:'上海',mileageKm:0}});
 const template=h.docs.terms;
 const sources={vehicleScopes:[{vehicleId:car.id,validFrom:'2027-01-01',validUntil:'2028-01-01',authorityEvidenceFileIds:[proof.id],rightsRestrictions:{status:'UNKNOWN'}}],productVersionIds:['synthetic-unpublished-product'],productDepositRules:[{productVersionId:'synthetic-unpublished-product',rule:{kind:'FIXED',amount:100}}],templateRefs:[{id:template.id,hash:canonicalHash('intentionally-unapproved')} ]};
 const saved=await h.post(`/admin/partners/${owner.id}/agreements`,{...command(),status:'DRAFT',vehicleIds:[car.id],partnerRateBps:6000,validFrom:'2027-01-01',validUntil:'2028-01-01',v31Sources:sources});
 const persisted=await h.db.partnerAgreementVersion.findUniqueOrThrow({where:{id:saved.latestVersion.id}});assert.deepEqual((persisted.electronicTerms as any).v31Sources,sources);
 const resolved=await h.db.serial(tx=>resolveV31SourceIds(tx,{ownerId:owner.id,cooperationVersionId:persisted.id}));
 const snap:any=resolved.snapshot;assert.equal(snap.collectionAccount.id,account.id);assert.equal(snap.collectionAccount.evidence[0].fileId,accountFile.id);assert.equal(snap.parties.OWNER.content.authorityEvidence[0].fileId,proof.id);
 const readiness=await h.get(`/admin/partners/${owner.id}/agreements/${persisted.id}/contract-readiness`);assert.equal(readiness.ready,false);assert.ok(readiness.missing.some((m:any)=>m.field===`vehicle.${car.id}.insurance`));
 assert.equal(h.externalCalls+h.realSmsSends+h.identityCalls+h.esignCalls+h.payment.providerCalls,0);
 }finally{await h.close();}
});
