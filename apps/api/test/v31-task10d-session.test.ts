import test from 'node:test';import assert from 'node:assert/strict';
import {loginScopeDigest} from '../src/owner-h5/legal-session';
import {electronicOwnerRoute} from '../src/owner-h5/electronic-access';
import {portalPathPolicy} from '../src/owner-h5/access';
test('10d challenge purpose invitation and legal revision are distinct; legal routes remain unavailable to viewing sessions',()=>{
 const scopes=[{ownerId:'company',legalRevision:2,legalMobileHash:'a'.repeat(64)}];
 const initial=loginScopeDigest(scopes,'ELECTRONIC_LEGAL','exact-invitation');
 assert.notEqual(initial,loginScopeDigest(scopes));assert.notEqual(initial,loginScopeDigest(scopes,'ELECTRONIC_LEGAL','other-invitation'));
 assert.notEqual(initial,loginScopeDigest([{...scopes[0],legalRevision:3}],'ELECTRONIC_LEGAL','exact-invitation'));
 for(const suffix of ['authority-options','authorities','authorities/grant/document/signed','internal-evidence/original','electronic-documents/task/dependencies']){const path='/owner-h5/owners/company/'+suffix;assert.equal(electronicOwnerRoute('GET',path),true);assert.equal(portalPathPolicy('GET',path),'UNKNOWN');}
 for(const suffix of ['authorities','authorities/technical/refresh','authorities/technical/resume','authorities/technical/revoke','electronic-documents/authorities/confirm','electronic-documents/task/revoke-grant'])assert.equal(electronicOwnerRoute('POST','/owner-h5/owners/company/'+suffix),true);
 assert.equal(electronicOwnerRoute('POST','/owner-h5/owners/company/revenue'),false);
});
