import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Db} from '../src/common/db';
import {OwnerService} from '../src/owner-signing/owner.service';
import {OwnerAuthorizationService} from '../src/owner-signing/authorization';
import {ownerAuthorityFixture} from './owner-authority-fixtures';
let db:Db,service:OwnerAuthorizationService,f:any,grant:any,authorized=false,queryFails=false,certSerial:string;
const error=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
const provider:any={createAuthorizationUrl:(i:any)=>({url:'https://textapi17.fadada.com/api2/before_authsign.api?transaction_id='+i.transactionId}),queryAuthorization:async()=>{if(queryFails)throw Error('Synthetic failure');return{authorized};},queryCertificate:async()=>({bound:true,serialNo:certSerial}),createRevocationUrl:()=>({url:'https://textapi17.fadada.com/api2/cancel_extsign_auto_page.api'})};
before(async()=>{assert.ok(new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith('_test'));db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});process.env.OWNER_AUTO_SIGNING_ENABLED='true';f=await ownerAuthorityFixture(db);certSerial=(await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:f.owner.id}})).certSerialNo!;service=new OwnerAuthorizationService(db,new OwnerService(db),provider);});
after(async()=>{delete process.env.OWNER_AUTO_SIGNING_ENABLED;await db?.$disconnect();});
test('creating a scoped grant does not authorize or enable it; replay retains original provider identifiers',async()=>{
 await assert.rejects(service.request(f.customer.id,f.owner.id,{...f.request,accepted:false}));
 grant=await service.request(f.customer.id,f.owner.id,f.request);assert.equal(grant.enabled,false);assert.equal(grant.status,'PENDING');
 const replay=await service.request(f.customer.id,f.owner.id,f.request);assert.equal(replay.id,grant.id);assert.equal(replay.url,grant.url);assert.ok(!JSON.stringify(grant).includes('providerCustomerId'));
 await assert.rejects(service.request(f.customer.id,f.owner.id,{...f.request,scope:{...f.scope,maxMonths:24}}),error('IDEMPOTENCY_CONFLICT'));
});
test('local switch cannot authorize a provider grant or accept a forged scope summary',async()=>{
 await assert.rejects(service.setEnabled(f.customer.id,f.owner.id,grant.id,{enabled:true,revision:grant.revision,scopeHash:grant.scopeHash}),error('OWNER_AUTH_NOT_READY'));
 authorized=true;grant=await service.refresh(f.customer.id,f.owner.id,grant.id);
 await assert.rejects(service.setEnabled(f.customer.id,f.owner.id,grant.id,{enabled:true,revision:grant.revision,scopeHash:'f'.repeat(64)}),error('OWNER_SCOPE_CHANGED'));
 grant=await service.setEnabled(f.customer.id,f.owner.id,grant.id,{enabled:true,revision:grant.revision,scopeHash:grant.scopeHash});assert.equal(grant.enabled,true);
});
test('provider revocation or failed query immediately closes the local switch',async()=>{
 authorized=false;grant=await service.refresh(f.customer.id,f.owner.id,grant.id);assert.equal(grant.enabled,false);assert.equal(grant.status,'REVOKED');
 authorized=true;grant=await service.refresh(f.customer.id,f.owner.id,grant.id);grant=await service.setEnabled(f.customer.id,f.owner.id,grant.id,{enabled:true,revision:grant.revision,scopeHash:grant.scopeHash});queryFails=true;
 await assert.rejects(service.refresh(f.customer.id,f.owner.id,grant.id));assert.equal((await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:grant.id}})).enabled,false);queryFails=false;
});
test('a renewed certificate needs a new authorization and an operator cannot enable for an owner',async()=>{
 certSerial='OtherCertificate';await assert.rejects(service.refresh(f.customer.id,f.owner.id,grant.id),error('OWNER_CERT_CHANGED'));assert.equal((await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:grant.id}})).enabled,false);
 await assert.rejects(service.setEnabled('operator',f.owner.id,grant.id,{enabled:true,revision:grant.revision,scopeHash:grant.scopeHash}),error('NOT_FOUND'));
});
test('closing locally remains available when provider capability is disabled and cancellation requires owner page action',async()=>{
 process.env.OWNER_AUTO_SIGNING_ENABLED='false';grant=await service.setEnabled(f.customer.id,f.owner.id,grant.id,{enabled:false,revision:0,scopeHash:''});assert.equal(grant.enabled,false);
 const result=await service.revoke(f.customer.id,f.owner.id,grant.id);assert.match(result.url,/cancel_extsign_auto_page/);assert.equal((await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:grant.id}})).status,'REVOKING');
});
test('authorization callback requires the exact persisted provider grant and only refreshes evidence, never enables',async()=>{
 const stored=await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:grant.id}});certSerial=stored.certificateSerialNo;authorized=true;
 provider.verifyCallback=()=>({transactionId:stored.providerTransactionId,providerContractId:'wrong',record:{customer_id:stored.providerCustomerId}});
 await assert.rejects(service.callback({synthetic:true}),error('OWNER_CALLBACK_BINDING'));
 provider.verifyCallback=()=>({transactionId:stored.providerTransactionId,providerContractId:stored.providerContractId,record:{customer_id:stored.providerCustomerId}});
 assert.equal((await service.callback({synthetic:true})).accepted,true);const current=await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:grant.id}});assert.equal(current.enabled,false);assert.equal(current.status,'REVOKING');
});
