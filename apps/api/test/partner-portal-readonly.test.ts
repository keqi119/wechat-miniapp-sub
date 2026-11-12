import {test} from 'node:test';
import assert from 'node:assert/strict';
import {portalPathPolicy} from '../src/owner-h5/access';
test('exact read whitelist permits only published projections and exact authentication methods',()=>{
 for(const path of ['/owners','/owners/a','/owners/a/workbench','/owners/a/orders/o/workspace','/owners/a/vehicles','/owners/a/policies','/owners/a/offline-archives','/owners/a/offline-archives/r','/owners/a/offline-archives/r/versions/v/files/f','/owners/a/revenue-rules','/owners/a/settlements','/owners/a/settlements/s']){
  assert.equal(portalPathPolicy('GET','/owner-h5'+path),'READ',path);assert.equal(portalPathPolicy('HEAD','/OWNER-H5'+path.toUpperCase()+'/'),'READ',path);
 }
 for(const path of ['/owners/a/authorities','/owners/a/contracts','/owners/a/seals/s/image','/owners/a/handovers/h/files/signed'])assert.equal(portalPathPolicy('GET','/owner-h5'+path),'UNKNOWN');
 for(const path of ['/owners/claim','/owners/a/verification','/owners/a/refresh','/owners/a/seal','/owners/a/authorities','/owners/a/authorities/x/revoke','/owners/a/contracts/x/sign','/owners/a/handovers/x/sync','/owners/a/offline-archives/x/feedback','/owners/a/settlements/x/feedback']){
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(portalPathPolicy(method,'/owner-h5'+path),'DENY_WRITE',method+path);
 }
 assert.equal(portalPathPolicy('POST','/OWNER-H5/owners/a/%72efresh/'),'DENY_WRITE');
 assert.equal(portalPathPolicy('POST','/owner-h5/auth/login'),'AUTH');assert.equal(portalPathPolicy('PUT','/owner-h5/auth/login'),'UNKNOWN');
 assert.equal(portalPathPolicy('GET','/owner-h5/owners/a/not-real'),'UNKNOWN');
});
