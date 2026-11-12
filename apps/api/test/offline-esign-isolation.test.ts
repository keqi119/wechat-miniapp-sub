import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FadadaESignGateway} from '../src/esign/fadada/fadada-esign.provider';
import {CustomerESignOnboardingService} from '../src/esign/customer-esign-onboarding.service';
import {SignaturePolicyService} from '../src/esign/enterprise-seal/signature-policy.service';
import {OwnerContractGateway} from '../src/owner-signing/gateway';
import {OwnerIdentityService} from '../src/owner-signing/identity';
import {OwnerAuthorizationService} from '../src/owner-signing/authorization';
import {OwnerContractPreparation} from '../src/owner-signing/contract';
import {requireNativeSigning} from '../src/esign/native-signing';
import {recordFadadaQuery} from '../src/esign/fadada-query-binding';
import {buildFadadaMsgDigest} from '../src/esign/fadada/fadada-digest';
import {NativeAwareFadadaClient,NativeAwareFadadaHttp} from '../src/esign/native-fadada-adapter';
import {FadadaOwnerClient,runOwnerH5} from '../src/owner-signing/fadada-owner.client';
import {OwnerAuthorizationLetterService} from '../src/owner-signing/unilateral-letter.service';
import {OwnerSigningTasks} from '../src/owner-signing/tasks';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import {platformLegalEntity} from '../src/common/platform-legal-entity';
const settings:any={enabled:true,signingEnabled:true,accountRegisterEnabled:true,realNameVerifyEnabled:true,appId:'synthetic',appSecret:'synthetic-test-secret',baseUrl:'https://textapi17.fadada.com/api2/',apiVersion:'2.0',requestTimeoutMs:1000};
const code=(name:string)=>(e:any)=>e.getResponse?.()?.error?.code===name;
test('all_offline_paths_have_zero_fadada_calls',async()=>{
 const previous=process.env.ESIGN_NEW_REQUESTS_ENABLED;delete process.env.ESIGN_NEW_REQUESTS_ENABLED;
 let calls=0;const forbidden:any=new Proxy({},{get:()=>()=>{calls++;throw new Error('unexpected dependency or supplier call');}});
 try{
  const gateway=new FadadaESignGateway(forbidden,settings,forbidden,forbidden,forbidden,forbidden),onboarding=new CustomerESignOnboardingService(forbidden,settings,forbidden),policies=new SignaturePolicyService(forbidden,forbidden,forbidden,settings),owner=new OwnerContractGateway(forbidden,settings,forbidden,forbidden,forbidden,forbidden,forbidden,forbidden),identity=new OwnerIdentityService(forbidden,forbidden,settings,forbidden),authority=new OwnerAuthorizationService(forbidden,forbidden,forbidden),prepare=new OwnerContractPreparation(forbidden,settings,forbidden);
  for(const action of [()=>gateway.create({} as any),()=>gateway.platformManualSign('c','o','t',{}),()=>onboarding.register('c'),()=>onboarding.verify('c',{} as any),()=>policies.prepare('SUBSCRIPTION','r','p','a'),()=>policies.renew('r','p','a'),()=>owner.customerSign('c','t'),()=>owner.ownerSign('c','o','t'),()=>owner.chooseManual('c','o','t'),()=>identity.start('c','o',{}),()=>identity.startLegal('c','o',{}),()=>identity.selectSeal('c','o','s'),()=>authority.request('c','o',{}),()=>prepare.prepare('a','c')])await assert.rejects(async()=>action(),code('ESIGN_INITIATION_DISABLED'));
  assert.throws(()=>requireNativeSigning(),code('ESIGN_INITIATION_DISABLED'));assert.equal(calls,0);
 }finally{if(previous===undefined)delete process.env.ESIGN_NEW_REQUESTS_ENABLED;else process.env.ESIGN_NEW_REQUESTS_ENABLED=previous;}
});
function historical(executionMode='ESIGN'){
 const task:any={id:'task',kind:'SUBSCRIPTION',resourceId:'contract',customerId:'customer',documentHash:'hash',sourceFileId:'file',sourcePdfHash:'source',providerEnvelopeId:'envelope',customerProviderId:'customer-provider',platformProviderId:'platform-provider',customerTransactionId:'customer-tx',platformTransactionId:'platform-tx',uploadedAt:new Date(),status:'PENDING',sealRequestedAt:null};
 let seals=0,updates=0;
 const db:any={fadadaTask:{findFirst:async()=>task,findUnique:async()=>task,findUniqueOrThrow:async()=>task,updateMany:async({data}:any)=>{updates++;Object.assign(task,data);return{count:1};}},providerEvent:{findUnique:async()=>null,upsert:async()=>({}),update:async()=>({})}};
 const api:any={querySignResult:async(expected:any)=>{const customer=expected.customerId===task.customerProviderId,raw=customer?{code:1,data:{result:'3000'}}:{code:1201,data:null,msg:'签署记录为空'};recordFadadaQuery(raw,expected);return{status:customer?'SIGNED':'UNKNOWN',...(customer?{resultCode:'3000'}:{}),raw};},autoSealContract:async()=>{seals++;return{resultCode:'1'};}};
 const writer:any={resource:async()=>({id:'contract',customerId:'customer',documentHash:'hash',executionMode,order:{contractMode:executionMode}})};
 return{task,db,api,writer,seals:()=>seals,updates:()=>updates,gateway:new FadadaESignGateway(db,settings,api,writer,{} as any,{} as any)};
}
test('legacy_query_cannot_dispatch_seal even when old and global switches are enabled',async()=>{
 const old=process.env.ESIGN_NEW_REQUESTS_ENABLED;process.env.ESIGN_NEW_REQUESTS_ENABLED='true';try{const f=historical();assert.equal((await f.gateway.reconcileOnly('task')).status,'PENDING');assert.equal((await f.gateway.query('task')).status,'PENDING');assert.equal(f.seals(),0);assert.equal(f.task.status,'PENDING');assert.equal(f.task.sealRequestedAt,null);}finally{if(old===undefined)delete process.env.ESIGN_NEW_REQUESTS_ENABLED;else process.env.ESIGN_NEW_REQUESTS_ENABLED=old;}
});
test('old_callback_cannot_approve_offline_archive and inflight_esign_is_not_silently_converted',async()=>{
 const offline=historical('OFFLINE');await assert.rejects(offline.gateway.reconcileOnly('task'),code('ESIGN_MODE_MISMATCH'));assert.equal(offline.updates(),0);assert.equal(offline.seals(),0);
 const old=historical();const before=JSON.stringify(old.task);await old.gateway.reconcileOnly('task');assert.equal(old.task.status,'PENDING');assert.ok(!('executionMode'in old.task));assert.equal(old.seals(),0);assert.ok(before.includes('PENDING'));
});
function callbackPayload(){const body={transaction_id:'customer-tx',contract_id:'envelope',timestamp:'20261027120000',result_code:'3000'};return{...body,msg_digest:buildFadadaMsgDigest({...settings,timestamp:body.timestamp,businessParams:body,explicitSortString:body.transaction_id})};}
test('legacy_callback_verifies_original_task_without_dispatch_and_rejects_forged_or_offline_evidence',async()=>{
 const f=historical();let settled=0;await f.gateway.callback(callbackPayload(),async(_task,event)=>{settled++;assert.equal(event.status,'PENDING');});assert.equal(f.seals(),0);assert.equal(settled,1);
 await assert.rejects(f.gateway.callback({...callbackPayload(),msg_digest:'invalid'},async()=>{settled++;}),code('CALLBACK_SIGNATURE'));assert.equal(settled,1);
 const offline=historical('OFFLINE');await assert.rejects(offline.gateway.callback(callbackPayload(),async()=>{settled++;}),code('ESIGN_MODE_MISMATCH'));assert.equal(settled,1);assert.equal(offline.seals(),0);
});
test('provider_adapter_blocks_direct_mutating_calls_before_transport',async()=>{
 const previous=process.env.ESIGN_NEW_REQUESTS_ENABLED;delete process.env.ESIGN_NEW_REQUESTS_ENABLED;let calls=0;
 const http=new NativeAwareFadadaHttp(settings,async()=>{calls++;throw new Error('unexpected transport');}),api=new NativeAwareFadadaClient(settings,http);
 try{await assert.rejects(api.registerAccount({accountType:'PERSONAL',openId:'synthetic'}),code('ESIGN_INITIATION_DISABLED'));await assert.rejects(api.createExternalSignUrl({} as any),code('ESIGN_INITIATION_DISABLED'));assert.equal(calls,0);}finally{if(previous===undefined)delete process.env.ESIGN_NEW_REQUESTS_ENABLED;else process.env.ESIGN_NEW_REQUESTS_ENABLED=previous;}
});
test('legacy_identity_refresh_never_applies_a_new_certificate',async()=>{
 let applied=0;const account:any={id:'account',customerId:'customer',providerCustomerId:'provider',verifiedSerialNo:'serial',verificationTransactionNo:'serial',identityCiphertext:'opaque',identityVersion:1,realNameStatus:'PENDING',checkedAt:null};
 const db:any={eSignAccount:{findUnique:async()=>account,updateMany:async({data}:any)=>{Object.assign(account,data);return{count:1};}},auditLog:{create:async()=>({})},serial:async(action:any)=>action(db)};
 const api:any={findPersonCertInfo:async()=>({realNameStatus:'verified'}),queryCert:async()=>({certBound:false}),applyCert:async()=>{applied++;throw new Error('new certificate forbidden');}};
 await new CustomerESignOnboardingService(db,{...settings,realNameVerifyEnabled:false,accountRegisterEnabled:false},api).refresh('customer');assert.equal(applied,0);assert.equal(account.certStatus,'UNKNOWN');
});
test('owner_query_true_and_callback_cannot_dispatch_an_unrequested_seal',async()=>{
 const keys=['OWNER_AUTO_SIGNING_ENABLED','OWNER_CONTRACTS_ENABLED','ESIGN_NEW_REQUESTS_ENABLED'],previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));for(const key of keys)process.env[key]='true';
 const task:any={id:'task',kind:'SUBSCRIPTION',resourceId:'contract',customerId:'customer',ownerId:'owner',documentHash:'hash',sourceFileId:'file',providerContractId:'envelope',status:'READY',uploadedAt:new Date(),snapshot:{lessor:{providerCustomerId:'owner-provider',providerSignatureId:'seal'}},owner:{esignAccount:{managerCustomerId:'legal'}},parties:[{id:'customer-party',role:'CUSTOMER',providerCustomerId:'customer-provider',transactionId:'customer-tx',status:'SIGNED',attemptedAt:new Date(),verifiedAt:new Date(),queryEvidenceHash:'proof'},{id:'owner-party',role:'OWNER',providerCustomerId:'owner-provider',providerSignatureId:'seal',transactionId:'owner-tx',status:'PENDING',attemptedAt:null}]};
 const contract:any={id:'contract',kind:'SUBSCRIPTION',customerId:'customer',providerTaskId:'task',documentHash:'hash',sourceFileId:'file',status:'PENDING',executionMode:'ESIGN',order:{contractMode:'ESIGN',finalPlanSnapshot:{lessorSnapshot:{ownerId:'owner'}}}};
 let seals=0;const db:any={ownerSigningTask:{findUnique:async()=>task,updateMany:async()=>({count:1})},contract:{findUnique:async()=>contract},ownerSigningParty:{findUnique:async()=>({...task.parties[1],taskId:'task',task}),findUniqueOrThrow:async()=>task.parties[1]}};
 const api:any={querySignResult:async(expected:any)=>{const raw={code:1201,data:null,msg:'签署记录为空'};recordFadadaQuery(raw,expected);return{status:'UNKNOWN',raw};},autoSealContract:async()=>{seals++;throw new Error('new seal forbidden');}};
 const gateway=new OwnerContractGateway(db,settings,api,{} as any,{} as any,{} as any,{} as any,{} as any);
 try{assert.equal((await gateway.query('task',true)).status,'PENDING');const body={transaction_id:'owner-tx',contract_id:'envelope',timestamp:'20261027120000',result_code:'3000'};await gateway.callback({...body,msg_digest:buildFadadaMsgDigest({...settings,timestamp:body.timestamp,businessParams:body,explicitSortString:body.transaction_id})});assert.equal(seals,0);assert.equal(task.status,'READY');assert.equal(task.parties[1].attemptedAt,null);contract.executionMode='OFFLINE';await assert.rejects(gateway.reconcileOnly('task'),code('ESIGN_MODE_MISMATCH'));}finally{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
});
test('already_archived_legacy_evidence_stays_readable_with_new_signing_disabled',async()=>{
 const f=historical();f.task.status='SIGNED';f.task.signedFileId='signed-file';f.task.signedPdfHash='signed-hash';let reads=0;f.writer.readVerified=async(id:string,hash:string)=>{assert.equal(id,'signed-file');assert.equal(hash,'signed-hash');reads++;};
 assert.deepEqual(await f.gateway.reconcileOnly('task'),{status:'SIGNED',documentHash:'hash',signedFileId:'signed-file'});assert.equal(reads,1);assert.equal(f.seals(),0);
});
function withFlags(values:Record<string,string>,action:()=>Promise<void>){return(async()=>{const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));Object.assign(process.env,values);try{await action();}finally{for(const key of Object.keys(values)){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}})();}
function offlineApprovalFixture(){
 let writes=0;const resource:any={id:'handover',customerId:'customer',executionMode:'OFFLINE',manifestHash:'hash',status:'CUSTOMER_CONFIRMED',order:{id:'order',contractMode:'OFFLINE'}};
 const draft:any={id:'approval',kind:'HANDOVER',resourceId:resource.id,customerId:'customer',requesterId:'requester',policyId:'policy',plan:{platformLegalEntityName:platformLegalEntity()},status:'PENDING'};
 const db:any={handover:{findUnique:async()=>resource},eSignApproval:{findUnique:async()=>draft,findUniqueOrThrow:async()=>draft,findFirst:async()=>null,create:async()=>{writes++;return draft;}},signaturePolicy:{findUnique:async()=>null},adminUser:{findUnique:async()=>null}};
 const writer:any={resource:async()=>resource,prepare:async()=>{writes++;return{};}};
 return{db,resource,writes:()=>writes,service:new SignaturePolicyService(db,writer,{} as any,settings)};
}
test('global_true_cannot_prepare_renew_or_approve_an_OFFLINE_handover',async()=>withFlags({ESIGN_NEW_REQUESTS_ENABLED:'true'},async()=>{
 for(const method of ['prepare','renew','approve']){const f=offlineApprovalFixture();const action=method==='prepare'?()=>f.service.prepare('HANDOVER','handover','policy','requester'):method==='renew'?()=>f.service.renew('approval','policy','requester'):()=>f.service.approve('approval','reviewer','hash');await assert.rejects(action,code('ESIGN_INITIATION_DISABLED'));assert.equal(f.writes(),0);}
}));
test('global_true_OFFLINE_chooseManual_is_rejected_before_claiming_or_writing',async()=>withFlags({ESIGN_NEW_REQUESTS_ENABLED:'true'},async()=>{
 let claims=0;const task:any={id:'task',kind:'SUBSCRIPTION',resourceId:'contract',ownerId:'owner'},resource:any={id:'contract',executionMode:'OFFLINE',order:{contractMode:'OFFLINE'}};
 const db:any={ownerSigningTask:{findUnique:async()=>task},contract:{findUnique:async()=>resource}};
 const gateway=new OwnerContractGateway(db,settings,{} as any,{} as any,{} as any,{claimManual:async()=>{claims++;}} as any,{} as any,{} as any);
 await assert.rejects(gateway.chooseManual('customer','owner','task'),code('ESIGN_INITIATION_DISABLED'));assert.equal(claims,0);
}));
test('claimManual_rechecks_persisted_mode_inside_its_transaction',async()=>withFlags({ESIGN_NEW_REQUESTS_ENABLED:'true'},async()=>{
 let writes=0;const tx:any={ownerSigningTask:{findUnique:async()=>({id:'task',resourceId:'contract',kind:'SUBSCRIPTION',ownerId:'owner',owner:{members:[]},parties:[]})},contract:{findUnique:async()=>({executionMode:'ESIGN',order:{contractMode:'OFFLINE'}})},vehicleOwner:{update:async()=>{writes++;}},ownerMember:{}};
 const tasks=new OwnerSigningTasks({serial:async(action:any)=>action(tx)} as any,{requireSigningMember:async()=>{}} as any);
 await assert.rejects(tasks.claimManual('customer','owner','task'),code('ESIGN_INITIATION_DISABLED'));assert.equal(writes,0);
}));
test('claimManual_transaction_rejects_a_resource_rebound_to_another_task',async()=>withFlags({ESIGN_NEW_REQUESTS_ENABLED:'true'},async()=>{
 let writes=0;const tx:any={ownerSigningTask:{findUnique:async()=>({id:'task',resourceId:'contract',kind:'SUBSCRIPTION',ownerId:'owner',owner:{members:[]},parties:[]})},contract:{findUnique:async()=>({id:'contract',providerTaskId:'different-task',executionMode:'ESIGN',order:{contractMode:'ESIGN'}})},vehicleOwner:{update:async()=>{writes++;}}};
 const tasks=new OwnerSigningTasks({serial:async(action:any)=>action(tx)} as any,{requireSigningMember:async()=>{}} as any);await assert.rejects(tasks.claimManual('customer','owner','task'),code('DOCUMENT_MISMATCH'));assert.equal(writes,0);
}));
test('global_true_OFFLINE_platform_hand_sign_rejects_before_evidence_writes_or_provider_calls',async()=>withFlags({ESIGN_NEW_REQUESTS_ENABLED:'true',HANDOVER_PLATFORM_SIGNING_MODE:'MANUAL',SESSION_SECRET:'synthetic-session-secret-for-offline-isolation-tests'},async()=>{
 for(const initialMode of ['OFFLINE','ESIGN']){
 let writes=0,calls=0;const owner:any={id:'owner',name:platformLegalEntity(),status:'VERIFIED',legalRepresentative:{mobileHash:ownerMobileHash('13800000000')},esignAccount:{providerCustomerId:'platform',realNameStatus:'VERIFIED',verifiedAt:new Date()}};
 Object.assign(owner.legalRepresentative,{name:'Synthetic legal',revision:1});Object.assign(owner.esignAccount,{managerCustomerId:'legal',verificationTransactionNo:'serial',consentSnapshot:{channel:'OWNER_LEGAL_H5',customerId:'legal',legalRevision:1,legalName:owner.legalRepresentative.name,legalMobileHash:owner.legalRepresentative.mobileHash}});
 const member:any={status:'VERIFIED',verifiedAt:new Date(),verifiedSerialNo:'serial',owner,customer:{mobile:'13800000000'}};
 const task:any={id:'task',kind:'HANDOVER',resourceId:'handover',customerId:'customer',documentHash:'a'.repeat(64),sourcePdfHash:'b'.repeat(64),sourceFileId:'file',platformProviderId:'platform',approvalId:'approval',providerEnvelopeId:'Envelope1',customerProviderId:'Customer1',customerTransactionId:'CustomerTx'};
 const approval:any={kind:'HANDOVER',resourceId:'handover',customerId:'customer',documentHash:task.documentHash,sourcePdfHash:task.sourcePdfHash,sourceFileId:'file',sealId:'seal'};
 const resource:any={id:'handover',providerTaskId:'task',customerId:'customer',manifestHash:task.documentHash,confirmedAt:new Date(),executionMode:initialMode,order:{customerId:'customer',contractMode:initialMode}};
 const db:any={ownerMember:{findUnique:async()=>member},ownerESignAccount:{findUnique:async()=>({})},fadadaTask:{findFirst:async()=>task,updateMany:async()=>{writes++;return{count:1};}},eSignApproval:{findUnique:async()=>approval},enterpriseSeal:{findUnique:async()=>({providerCustomerId:'platform',organizationName:owner.name})},handover:{findUnique:async()=>resource},legalDocument:{findFirst:async()=>({id:'document',version:1})},customerConsent:{count:async()=>1},serial:async(action:any)=>action({...db,handover:{findUnique:async()=>({...resource,executionMode:'OFFLINE',order:{...resource.order,contractMode:'OFFLINE'}})}})};
 const api:any={querySignResult:async(expected:any)=>{calls++;const raw={code:1,data:{result:'3000'}};recordFadadaQuery(raw,expected);return{status:'SIGNED',resultCode:'3000',raw};}},platform:any={createPlatformHandoverSignUrl:()=>{calls++;return{url:'forbidden'};}};
 const gateway=new FadadaESignGateway(db,{...settings,platformCustomerId:'platform'},api,{} as any,{} as any,platform);
 await assert.rejects(gateway.platformManualSign('legal','owner','task',{accepted:true,documentHash:task.documentHash,sourceSha256:task.sourcePdfHash}),code('ESIGN_INITIATION_DISABLED'));assert.equal(writes,0);assert.equal(calls,initialMode==='OFFLINE'?0:1);
 }
}));
test('unconfigured_historical_authorization_refresh_preserves_original_record',async()=>{
 let writes=0;const record:any={id:'authority',ownerId:'owner',method:'PROVIDER_AUTO_GRANT',status:'AUTHORIZED',enabled:true,revision:7,checkedAt:new Date(),requestedBy:'legal',providerCustomerId:'Platform1',providerContractId:'Contract1',providerTransactionId:'Transaction1'};const before=JSON.stringify(record);
 const db:any={ownerAutoAuthority:{findFirst:async()=>record,updateMany:async()=>{writes++;record.status='UNKNOWN';}},vehicleOwner:{update:async()=>{writes++;}},serial:async(action:any)=>action(db)};
 const owners:any={member:async()=>({}),requireLegalSigningMember:async()=>{},requireSigningMember:async()=>{},usesLegalPolicy:async()=>false};
 const service=new OwnerAuthorizationService(db,owners,new FadadaOwnerClient({...settings,enabled:false}));
 await assert.rejects(service.refresh('legal','owner','authority'),code('FADADA_DISABLED'));assert.equal(writes,0);assert.equal(JSON.stringify(record),before);
});
test('direct_owner_new_request_and_letter_entry_are_gated_while_readonly_query_remains_available',async()=>withFlags({ESIGN_NEW_REQUESTS_ENABLED:'false'},async()=>{
 let calls=0;const client=new FadadaOwnerClient(settings,{send:async()=>{calls++;return{status:200,parsedBody:{code:1,data:{}}};}} as any);
 const input:any={customerId:'Company1',contractId:'Contract1',transactionId:'Transaction1',signatureId:'Seal1',title:'Synthetic',positions:[{pagenum:0,x:1,y:1}]};
 for(const action of [()=>client.registerEnterprise('Owner1'),()=>client.createVerification({} as any),()=>client.createAuthorizationUrl(input),()=>client.createManualSignUrl(input),()=>runOwnerH5(()=>client.createPlatformHandoverSignUrl(input)),()=>runOwnerH5(()=>client.createAuthorityDocumentSignUrl(input))])await assert.rejects(async()=>action(),code('ESIGN_INITIATION_DISABLED'));
 const letters=new OwnerAuthorizationLetterService({} as any,{} as any,settings,{} as any,client,{} as any);await assert.rejects(letters.requestEntry('legal','owner','authority'),code('ESIGN_INITIATION_DISABLED'));assert.equal(calls,0);
 await client.queryCertificate('Company1');assert.equal(calls,1);
}));
function approvalTransactionFixture(){
 const resource:any={id:'handover',orderId:'order',customerId:'customer',manifestHash:'hash',executionMode:'ESIGN',status:'CUSTOMER_CONFIRMED',order:{id:'order',contractMode:'ESIGN'}},policy:any={id:'policy',kind:'HANDOVER',status:'ACTIVE',sealId:'seal',policyCode:'synthetic',policyName:'Synthetic',executionMode:'SEQUENTIAL'},seal:any={id:'seal',status:'ACTIVE',organizationName:platformLegalEntity(),confirmedBy:'admin',confirmedAt:new Date(),providerCustomerId:'Platform1',providerSignatureId:'Seal1',sealName:'Synthetic'};
 let draft:any,task:any,writes=0,txMode='ESIGN';
 const tx:any={handover:{findUnique:async()=>({...resource,executionMode:txMode,order:{...resource.order,contractMode:txMode}})},eSignApproval:{findFirst:async()=>null,create:async({data}:any)=>{writes++;draft={id:'approval',...data};return draft;},update:async({data}:any)=>{writes++;Object.assign(draft,data);return draft;},updateMany:async({data}:any)=>{writes++;Object.assign(draft,data);return{count:1};},findUniqueOrThrow:async()=>draft},fadadaTask:{findUniqueOrThrow:async()=>task},auditLog:{create:async()=>{writes++;return{};}}};
 const db:any={signaturePolicy:{findUnique:async()=>policy},adminUser:{findUnique:async({where}:any)=>({id:where.id,active:true,role:'ADMIN'})},enterpriseSeal:{findUnique:async()=>seal},sealAuthority:{findMany:async()=>['REQUEST_USE','APPROVE_USE'].map(authorityType=>({sealId:'seal',status:'ACTIVE',authorityType,subjectType:'ROLE',subjectId:'ADMIN',requiresTwoPersonApproval:true}))},eSignApproval:{findFirst:async()=>null,findUnique:async()=>draft,findUniqueOrThrow:async()=>draft},fadadaTask:{findUnique:async()=>task,findUniqueOrThrow:async()=>task},serial:async(action:any)=>action(tx)};
 const writer:any={resource:async()=>resource,prepare:async()=>({file:{id:'source',sha256:'source-hash'},slotCoordinates:[]}),readVerified:async()=>Buffer.from('synthetic')};
 const service=new SignaturePolicyService(db,writer,{readiness:async()=>({signingEligible:true,realNameStatus:'VERIFIED'})} as any,{...settings,platformCustomerId:seal.providerCustomerId,platformSignatureId:seal.providerSignatureId});
 return{service,writes:()=>writes,draft:()=>draft,setMode:(value:string)=>{txMode=value;},setRenewable:()=>{draft.expiresAt=new Date(Date.now()-1000);task={id:'task',kind:'HANDOVER',resourceId:'handover',customerId:'customer',documentHash:'hash',sourceFileId:'source',sourcePdfHash:'source-hash',status:'PENDING',approvalId:'approval',platformProviderId:'Platform1'};}};
}
test('platform_prepare_rechecks_mode_in_transaction_before_persisting_approval',async()=>withFlags({ESIGN_NEW_REQUESTS_ENABLED:'true'},async()=>{
 const f=approvalTransactionFixture();f.setMode('OFFLINE');await assert.rejects(f.service.prepare('HANDOVER','handover','policy','requester'),code('ESIGN_INITIATION_DISABLED'));assert.equal(f.writes(),0);
}));
test('platform_approve_rechecks_mode_in_transaction_before_changing_approval',async()=>withFlags({ESIGN_NEW_REQUESTS_ENABLED:'true'},async()=>{
 const f=approvalTransactionFixture();await f.service.prepare('HANDOVER','handover','policy','requester');const prior=f.writes();f.setMode('OFFLINE');await assert.rejects(f.service.approve('approval','reviewer',f.draft().planHash),code('ESIGN_INITIATION_DISABLED'));assert.equal(f.writes(),prior);assert.equal(f.draft().status,'PENDING');
}));
test('platform_renew_rechecks_mode_in_transaction_without_switching_legacy_task',async()=>withFlags({ESIGN_NEW_REQUESTS_ENABLED:'true'},async()=>{
 const f=approvalTransactionFixture();await f.service.prepare('HANDOVER','handover','policy','requester');await f.service.approve('approval','reviewer',f.draft().planHash);f.setRenewable();const prior=f.writes();f.setMode('OFFLINE');await assert.rejects(f.service.renew('approval','policy','requester'),code('ESIGN_INITIATION_DISABLED'));assert.equal(f.writes(),prior);assert.equal(f.draft().status,'APPROVED');
}));
test('personal_partner_cannot_enter_legacy_enterprise_identity_or_refresh',async()=>withFlags({ESIGN_NEW_REQUESTS_ENABLED:'true',OWNER_ONBOARDING_ENABLED:'true',OWNER_LEGAL_H5_ONLY:'false'},async()=>{
 let writes=0;const db:any={ownerESignAccount:{findUnique:async()=>null},serial:async()=>{writes++;throw new Error('no identity writes for personal partner');}};
 const service=new OwnerIdentityService(db,{member:async()=>({owner:{subjectType:'PERSONAL',creditCode:null}})} as any,settings,{} as any);
 await assert.rejects(service.start('customer','owner',{accepted:true,consents:[]}),code('OWNER_ENTERPRISE_REQUIRED'));await assert.rejects(service.refresh('customer','owner'),code('OWNER_ENTERPRISE_REQUIRED'));assert.equal(writes,0);
}));
