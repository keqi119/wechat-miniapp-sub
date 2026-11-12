import test from 'node:test';
import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {JourneyHarness} from './seven-module-journey-fixtures';

test('candidate public OTP refuses purpose invitation and representative changes before completion',async()=>{
 const h=new JourneyHarness();await h.start();try{
 process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
 for(const change of ['purpose','invitation','representative']){
  const owner=await h.db.vehicleOwner.create({data:{name:'合成候选OTP-'+change+h.prefix,subjectType:'ENTERPRISE',address:'合成地址',createdBy:h.maker.id}});
  const mobile='138'+randomInt(10000000,99999999),proof=await h.proof(h.maker);
  await h.post(`/admin/vehicle-owners/${owner.id}/legal-representative`,{name:'合成代表',mobile,evidenceFileId:proof.id,revision:0,accepted:true});
  const invite=await h.post(`/admin/vehicle-owners/${owner.id}/invitations`,{mobile});
  const anon={id:'anonymous',headers:{Origin:h.origin}},body={mobile,purpose:'ELECTRONIC_LEGAL',invitationToken:invite.token};
  const challenge=await h.post('/owner-h5/auth/sms/request',body,anon),code=h.smsCodes.get(mobile);assert.ok(code);
  const input:any={...body,challengeId:challenge.challengeId,code,consents:['terms','privacy'].map(t=>({documentId:h.docs[t].id,version:h.docs[t].version}))};
  if(change==='purpose')delete input.purpose;
  if(change==='invitation'){const other=await h.post(`/admin/vehicle-owners/${owner.id}/invitations`,{mobile});input.invitationToken=other.token;}
  if(change==='representative')await h.db.ownerLegalRepresentative.update({where:{ownerId:owner.id},data:{revision:{increment:1}}});
  const before=await h.db.ownerH5Session.count();
  const response=await h.reject('/owner-h5/auth/login',input,anon,'LOGIN_UNAVAILABLE');assert.equal(response.status,401);
  assert.equal(await h.db.ownerH5Session.count(),before);
  assert.equal((await h.db.partnerPortalChallenge.findUniqueOrThrow({where:{id:challenge.challengeId}})).status,'REJECTED');
 }
 assert.equal(h.externalCalls+h.realSmsSends+h.identityCalls+h.esignCalls,0);
 }finally{await h.close();}
});
