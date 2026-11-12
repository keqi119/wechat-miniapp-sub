import {test}from'node:test';import assert from'node:assert/strict';
import{buildPlatformAutoCandidateEnv,parseProtectedEnv,validatePlatformAutoTransition}from'./platform-auto-candidate.mjs';
const before={POSTGRES_DB:'ninda_prod',POSTGRES_USER:'ninda_prod',NEW_ORDER_CONTRACT_MODE:'ELECTRONIC',ESIGN_NEW_REQUESTS_ENABLED:'true',ELECTRONIC_SIGNING_ENABLED:'true',OWNER_LEGAL_H5_ENABLED:'true',OWNER_LEGAL_H5_ONLY:'true',OWNER_AUTO_SIGNING_ENABLED:'false',FADADA_APP_ID:'synthetic',FADADA_APP_SECRET:'synthetic $dollar # hash',FADADA_PLATFORM_CUSTOMER_ID:'platform',FADADA_PLATFORM_SIGNATURE_ID:'seal',FADADA_BASE_URL:'https://textapi17.fadada.com/api2/',ESIGN_IDENTITY_ENCRYPTION_KEY:Buffer.alloc(32).toString('base64'),OWNER_AUTHORIZATION_SCOPE_VERSION:'2',BUILD_VERSION:'old',API_IMAGE:'ninda-api:old'};
const raw='# preserved\r\n'+Object.entries(before).map(([k,v])=>k+'='+JSON.stringify(v)).join('\r\n')+'\r\n';
test('preparation preserves identities, unrelated raw values and keeps automatic execution closed',()=>{
 const result=buildPlatformAutoCandidateEnv(raw,'synthetic-new'),after=parseProtectedEnv(result);
 assert.equal(after.OWNER_AUTHORIZATION_SCOPE_VERSION,'3');assert.equal(after.OWNER_AUTHORIZATION_METHOD,'PROVIDER_AUTO_GRANT');assert.equal(after.OWNER_AUTO_SIGNING_ENABLED,'false');
 assert.ok(result.includes('FADADA_APP_SECRET="synthetic $dollar # hash"\r\n'));assert.ok(result.startsWith('# preserved\r\n'));
 assert.equal(validatePlatformAutoTransition(before,after,'synthetic-new'),true);
});
test('rejects execution enablement, altered provider credentials and ambiguous environments',()=>{
 const after=parseProtectedEnv(buildPlatformAutoCandidateEnv(raw,'synthetic-new'));
 for(const change of [{OWNER_AUTO_SIGNING_ENABLED:'true'},{FADADA_APP_SECRET:'changed'},{FADADA_PLATFORM_CUSTOMER_ID:'other'},{ESIGN_NEW_REQUESTS_ENABLED:'false'}])assert.throws(()=>validatePlatformAutoTransition(before,{...after,...change},'synthetic-new'));
 assert.throws(()=>buildPlatformAutoCandidateEnv(raw+'POSTGRES_DB=ninda_prod\r\n','synthetic-new'));
});
