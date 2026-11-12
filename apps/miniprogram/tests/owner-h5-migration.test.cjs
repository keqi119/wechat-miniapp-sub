const {test}=require('node:test'),assert=require('node:assert/strict');
const {createNativeSigningApi}=require('../src/services/native-signing');
const policy=require('../src/services/native-signing-policy');
const base={mode: 'MINIAPP_WEBVIEW', newOrderContractMode: 'ESIGN', newEsignRequestsEnabled: true,enabled:true,signProviderConfigured:true,providerHosts:['textapi17.fadada.com','realnameverify16.fadada.com'],returnUrl:'https://api.evsub.ndacar.com/api/public/esign-return'};
test('migrated enterprise kinds cannot be started even when server config omits migration metadata',async()=>{
 const calls=[];const api=createNativeSigningApi({call:async(method,path)=>{calls.push({method,path});return base;},native:async()=>assert.fail('must not open enterprise verification'),identifier:encodeURIComponent,error:(message,code)=>Object.assign(new Error(message),{code}),getContext:()=>({authenticated:true,customer:{id:'synthetic'}}),platform:{},pendingKey:'pending'});
 assert.equal(api.startOwnerSigning,undefined);
 for(const kind of ['owner-identity','owner-authority','owner-revoke','owner-contract'])await assert.rejects(api.startSigning(kind,'enterprise:record',{}),e=>e.code==='SIGN_CONTEXT');
 assert.deepEqual(calls,[]);
});
test('owner portal config is ignored by customer signing instead of creating a miniapp H5 entry',()=>{
 for(const ownerPortal of [undefined,{mode:'OWNER_LEGAL_H5',migrated:true,entryUrl:'https://sign.evsub.ndacar.com/owner/'},{mode:'invalid',entryUrl:'https://invalid.test/'}]){
  const config=policy.signingConfig({...base,ownerPortal});assert.equal(config.enabled,true);assert.equal('ownerPortal'in config,false);
 }
 assert.equal(policy.ownerPortalConfig,undefined);
});
