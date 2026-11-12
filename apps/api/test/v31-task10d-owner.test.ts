import test from 'node:test';
import assert from 'node:assert/strict';
import {legalSessionView,legalLoginScopes} from '../src/owner-h5/legal-session';

test('10d legal purpose binds actual customer and current representative revision, never portal access',async()=>{
 process.env.SESSION_SECRET='synthetic-task10d-session-secret-000000000';process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
 const {ownerMobileHash}=await import('../src/owner-h5/legal-representative');
 const customer={id:'actual-person',mobile:'13800138000'};
 const profile={revision:7,mobileHash:ownerMobileHash(customer.mobile)};
 const tx:any={customer:{findUnique:async()=>customer},ownerMember:{findMany:async()=>[{ownerId:'company',owner:{revision:2,legalRepresentative:profile}}],findUnique:async()=>({status:'VERIFIED',customer,owner:{status:'VERIFIED',legalRepresentative:profile}})}};
 const scopes=await legalLoginScopes(tx,customer.mobile);
 assert.deepEqual(scopes,[{ownerId:'company',legalRevision:7,legalMobileHash:profile.mobileHash}]);
 const session={customerId:customer.id,csrfToken:'csrf',expiresAt:new Date(Date.now()+60000),identitySnapshot:{mode:'ELECTRONIC_LEGAL',owners:scopes}};
 assert.equal((await legalSessionView(tx,session)).mode,'ELECTRONIC_LEGAL');
 profile.revision++;
 await assert.rejects(legalSessionView(tx,session));
 await assert.rejects(legalSessionView(tx,{...session,identitySnapshot:{mode:'PARTNER_READONLY',owners:scopes}}));
});
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import {randomInt} from 'node:crypto';
test('10d public OTP invitation login binds legal scope and denies cross-purpose, stale identity and readonly signing',async()=>{
 const h=new JourneyHarness();await h.start();try{
 process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
 const owner=await h.db.vehicleOwner.create({data:{name:'合成10d企业',subjectType:'ENTERPRISE',address:'合成地址',contactPhone:'',createdBy:h.maker.id}});
 const mobile='138'+randomInt(10000000,99999999),proof=await h.proof(h.maker);
 await h.post(`/admin/vehicle-owners/${owner.id}/legal-representative`,{name:'合成本人',mobile,evidenceFileId:proof.id,revision:0,accepted:true});
 const invite=await h.post(`/admin/vehicle-owners/${owner.id}/invitations`,{mobile});
 const anon={id:'anonymous',headers:{Origin:h.origin}},body={mobile,purpose:'ELECTRONIC_LEGAL',invitationToken:invite.token};
 const challenge=await h.post('/owner-h5/auth/sms/request',body,anon),code=h.smsCodes.get(mobile);assert.ok(code);
 const input={...body,challengeId:challenge.challengeId,code,consents:['terms','privacy'].map(t=>({documentId:h.docs[t].id,version:h.docs[t].version}))};
 const response=await fetch(`${h.base}/api/owner-h5/auth/login`,{method:'POST',headers:{Origin:h.origin,'Content-Type':'application/json'},body:JSON.stringify(input)});const session:any=await response.json();assert.equal(response.status,201,JSON.stringify(session));assert.equal(session.mode,'ELECTRONIC_LEGAL');
 const login={id:'actual-legal',headers:{Origin:h.origin,Cookie:response.headers.get('set-cookie')!.split(';')[0],'X-CSRF-Token':session.csrfToken}};
 assert.equal((await h.get('/owner-h5/auth/me',login)).mode,'ELECTRONIC_LEGAL');assert.ok((await h.get('/owner-h5/owners',login)).some((v:any)=>v.ownerId===owner.id));assert.equal((await h.get(`/owner-h5/owners/${owner.id}`,login)).id,owner.id);
 await h.reject('/owner-h5/auth/login',input,anon,'LOGIN_UNAVAILABLE');
 assert.equal((await h.reject(`/owner-h5/owners/foreign/electronic-documents/task/sign`,{...command(),accepted:true,sourceSha256:'a'.repeat(64)},login)).status,404);
 await h.db.ownerLegalRepresentative.update({where:{ownerId:owner.id},data:{revision:{increment:1}}});
 assert.equal((await h.reject(`/owner-h5/owners/${owner.id}/refresh`,{},login)).status,401);
 const viewMobile='139'+randomInt(10000000,99999999);const viewInvite=await h.post(`/admin/partners/${owner.id}/company-admin/invitation`,{...command(),mobile:viewMobile});
 const preview=await h.post('/owner-h5/auth/invitation/preview',{mobile:viewMobile,invitationCode:viewInvite.invitationCode},anon);
 const viewResponse=await fetch(`${h.base}/api/owner-h5/auth/invitation/confirm`,{method:'POST',headers:{Origin:h.origin,'Content-Type':'application/json'},body:JSON.stringify({previewToken:preview.previewToken,consents:input.consents})});const viewSession:any=await viewResponse.json();assert.equal(viewResponse.status,201,JSON.stringify(viewSession));
 const readonly={id:'synthetic-viewer',headers:{Origin:h.origin,Cookie:viewResponse.headers.get('set-cookie')!.split(';')[0],'X-CSRF-Token':viewSession.csrfToken}};
 await h.reject(`/owner-h5/owners/${owner.id}/electronic-documents/task/sign`,{},readonly,'PARTNER_READ_ONLY');
 assert.equal((await h.get(`/owner-h5/owners/${owner.id}`,readonly)).executionMode,'ELECTRONIC');
 assert.equal(h.externalCalls,0);assert.equal(h.realSmsSends,0);
 }finally{await h.close();}
});
