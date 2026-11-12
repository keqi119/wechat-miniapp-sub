import test from 'node:test';import assert from 'node:assert/strict';
import {portalReturnDecision} from './lifecycle.ts';
test('readonly PDF return preserves unchanged current scope and reloads actual revoked/rebound scope',()=>{
 const session={mode:'PARTNER_READONLY' as const,viewer:{maskedMobile:'138****0000'},scopes:[{ownerId:'company',accessVersion:2}],csrfToken:'synthetic',expiresAt:new Date(Date.now()+60000).toISOString()};
 assert.equal(portalReturnDecision(session,session),'PRESERVE');assert.equal(portalReturnDecision({...session,scopes:[{ownerId:'company',accessVersion:3}]},session),'RELOAD');assert.equal(portalReturnDecision({...session,csrfToken:'new-session'},session),'RELOAD');assert.equal(portalReturnDecision({...session,expiresAt:'invalid'},session),'EXPIRE');
});
