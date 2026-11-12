import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requirePartnerIdentity} from '../src/partners/identity';
const error=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
function fixture(){
 const owner:any={id:'owner',subjectType:'INDIVIDUAL',revision:4,status:'DRAFT'};
 const binding:any={id:'binding',ownerId:'owner',customerId:'customer',relationship:'SELF',status:'APPROVED',revision:2,profileRevision:4,reviewedBy:'reviewer',reviewedAt:new Date()};
 const verification:any={id:'verification',ownerId:'owner',status:'APPROVED',revision:3,profileRevision:4,identityBindingId:'binding',identityBindingRevision:2,reviewedBy:'reviewer',reviewedAt:new Date()};
 const session:any={id:'session',expiresAt:new Date(Date.now()+60000),customerId:'customer',identitySnapshot:[{ownerId:'owner',bindingId:'binding',bindingRevision:2,profileRevision:4,verificationRevision:3}]};
 const tx:any={ownerH5Session:{findUnique:async()=>session},vehicleOwner:{findUnique:async()=>owner},partnerIdentityBinding:{findUnique:async(q:any)=>q.where.ownerId_customerId.customerId==='customer'?binding:null},partnerVerification:{findFirst:async()=>verification}};
 return{owner,binding,verification,session,tx};
}
test('same customer account and phone do not grant partner authorization',async()=>{const f=fixture();await assert.rejects(requirePartnerIdentity(f.tx,{customerId:'customer'},'owner'),error('PARTNER_SESSION_REQUIRED'));await assert.rejects(requirePartnerIdentity(f.tx,{...f.session,customerId:'other'},'owner'),error('SESSION_EXPIRED'));});
test('individual self binding works without company legal representative or electronic certificate',async()=>{const f=fixture();assert.equal((await requirePartnerIdentity(f.tx,f.session,'owner')).id,'binding');});
test('revocation, changed profile and replacement relation invalidate old session',async()=>{
 for(const change of ['revoked','profile','revision']){const f=fixture();if(change==='revoked')f.binding.status='REVOKED';if(change==='profile')f.owner.revision++;if(change==='revision')f.binding.revision++;await assert.rejects(requirePartnerIdentity(f.tx,f.session,'owner'));}
});
