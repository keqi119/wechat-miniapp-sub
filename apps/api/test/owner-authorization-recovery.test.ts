import './legacy-esign-mode';
import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {OwnerService} from '../src/owner-signing/owner.service';
import {OwnerAuthorizationService} from '../src/owner-signing/authorization';

let db:Db;
before(()=>{const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname.endsWith('_test'));db=new Db({datasourceUrl:url.href});});
after(async()=>{await db?.$disconnect();});
async function fixture(status:'REVOKING'|'AUTHORIZED'|'UNKNOWN'='REVOKING'){
 const seed=randomUUID(),customer=await db.customer.create({data:{mobile:'fixture'+seed}});
 const owner=await db.vehicleOwner.create({data:{name:'Synthetic recovery owner',creditCode:seed.replaceAll('-','').slice(0,18),address:'Synthetic',contactPhone:'13900000000',createdBy:'fixture',status:'VERIFIED'}});
 await db.ownerMember.create({data:{ownerId:owner.id,customerId:customer.id,status:'VERIFIED',verifiedAt:new Date(),verifiedSerialNo:seed}});
 const account=await db.ownerESignAccount.create({data:{ownerId:owner.id,providerCustomerId:seed,managerCustomerId:customer.id,verificationTransactionNo:seed,realNameStatus:'VERIFIED',certStatus:'BOUND',certSerialNo:'current-cert',checkedAt:new Date()}});
 const seal=await db.ownerSeal.create({data:{ownerId:owner.id,providerCustomerId:seed,providerSignatureId:seed,status:'ACTIVE',imageHash:'a'.repeat(64),imageCiphertext:'synthetic',checkedAt:new Date(),selectedBy:customer.id,selectedAt:new Date()}});
 const grant=await db.ownerAutoAuthority.create({data:{ownerId:owner.id,sealId:seal.id,providerCustomerId:seed,providerSignatureId:seed,certificateSerialNo:'current-cert',providerContractId:seed,providerTransactionId:seed,requestedBy:customer.id,idempotencyKey:seed,requestHash:'fixture',scope:{synthetic:true},scopeHash:'fixture',consentSnapshot:{synthetic:true},status,enabled:status==='AUTHORIZED'}});
 return{customer,owner,account,grant};
}
const service=(provider:any)=>new OwnerAuthorizationService(db,new OwnerService(db),{assertAvailable:()=>{},...provider});
test('a failed revocation query preserves revocation intent and never re-enables the grant',async()=>{
 const f=await fixture(),failure=new Error('synthetic provider unavailable');
 await assert.rejects(service({queryAuthorization:async()=>{throw failure;}}).refresh(f.customer.id,f.owner.id,f.grant.id),e=>e===failure);
 const result=await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:f.grant.id}});
 assert.equal(result.status,'REVOKING');assert.equal(result.enabled,false);assert.equal(result.checkedAt,null);assert.equal(result.revision,f.grant.revision+1);assert.equal(result.revokedAt,null);
});
test('a changed certificate during a legacy revocation query preserves the pending revocation',async()=>{
 const f=await fixture();
 await assert.rejects(service({queryAuthorization:async()=>({authorized:true}),queryCertificate:async()=>({bound:true,serialNo:'renewed-cert'})}).refresh(f.customer.id,f.owner.id,f.grant.id),(e:any)=>e.getResponse?.()?.error?.code==='OWNER_CERT_CHANGED');
 const result=await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:f.grant.id}});assert.equal(result.status,'REVOKING');assert.equal(result.enabled,false);assert.equal(result.certificateSerialNo,'current-cert');
});
test('a failed ordinary authorization query remains unknown and disables execution',async()=>{
 const f=await fixture('AUTHORIZED');await assert.rejects(service({queryAuthorization:async()=>{throw Error('synthetic failure');}}).refresh(f.customer.id,f.owner.id,f.grant.id));
 const result=await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:f.grant.id}});assert.equal(result.status,'UNKNOWN');assert.equal(result.enabled,false);
});
test('authorization list distinguishes current and obsolete certificates without rewriting either record',async()=>{
 const f=await fixture(),svc=service({});
 assert.equal((await svc.list(f.customer.id,f.owner.id))[0].certificateMatchesCurrent,true);
 await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{certSerialNo:'renewed-cert'}});
 assert.equal((await svc.list(f.customer.id,f.owner.id))[0].certificateMatchesCurrent,false);
 assert.deepEqual(await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:f.grant.id}}),f.grant);
});
test('authorization list does not claim certificate mismatch from stale or invalid account evidence',async()=>{
 const f=await fixture(),svc=service({});
 await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{checkedAt:new Date(Date.now()-86400001)}});
 assert.equal((await svc.list(f.customer.id,f.owner.id))[0].certificateMatchesCurrent,null);
 await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{checkedAt:new Date(),certStatus:'UNKNOWN'}});
 assert.equal((await svc.list(f.customer.id,f.owner.id))[0].certificateMatchesCurrent,null);
 await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{checkedAt:new Date(Date.now()+86400000),certStatus:'BOUND'}});
 assert.equal((await svc.list(f.customer.id,f.owner.id))[0].certificateMatchesCurrent,null);
});
