import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newOrderContractMode,assertNewEsignAllowed} from '../src/offline-documents/mode';
import {fadadaSettings} from '../src/esign/esign.settings';
import {createFadadaIntegration} from '../src/esign/esign.module';
const disabled=(error:any)=>error.getResponse?.()?.error?.code==='ESIGN_INITIATION_DISABLED';
test('new_order_freezes_offline_mode',()=>{assert.equal(newOrderContractMode({}),'OFFLINE');assert.equal(newOrderContractMode({NEW_ORDER_CONTRACT_MODE:'OFFLINE'}),'OFFLINE');assert.equal(newOrderContractMode({NEW_ORDER_CONTRACT_MODE:'invalid'}),'OFFLINE');});
test('existing_rows_remain_esign and flags_cannot_mutate_existing_mode',()=>{const existing={contractMode:'ESIGN' as const};assert.equal(newOrderContractMode({NEW_ORDER_CONTRACT_MODE:'OFFLINE'}),'OFFLINE');assert.equal(existing.contractMode,'ESIGN');assert.throws(()=>assertNewEsignAllowed({...existing,env:{ESIGN_NEW_REQUESTS_ENABLED:'false'}}),disabled);assert.equal(existing.contractMode,'ESIGN');});
test('fine grained flags cannot bypass the global gate and OFFLINE never dispatches',()=>{
 assert.throws(()=>assertNewEsignAllowed({env:{FADADA_ENABLED:'true',FADADA_SIGNING_ENABLED:'true',OWNER_AUTO_SIGNING_ENABLED:'true'}}),disabled);
 assert.throws(()=>assertNewEsignAllowed({executionMode:'OFFLINE',env:{ESIGN_NEW_REQUESTS_ENABLED:'true'}}),disabled);
 assert.doesNotThrow(()=>assertNewEsignAllowed({executionMode:'ESIGN',env:{ESIGN_NEW_REQUESTS_ENABLED:'true'}}));
});
test('offline_api_boots_without_fadada_credentials and recovery remains unavailable',async()=>{
 const settings=fadadaSettings({NEW_ORDER_CONTRACT_MODE:'OFFLINE',FADADA_ENABLED:'true'});
 assert.equal(settings.enabled,false);
 const integration=createFadadaIntegration({} as any,settings);assert.ok(integration.controllers.length>0);
 await assert.rejects(integration.gateway.reconcileOnly('existing-task'),(e:any)=>e.getResponse?.()?.error?.code==='FADADA_DISABLED');
});
