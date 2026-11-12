import test from 'node:test';
import assert from 'node:assert/strict';
import {qualificationValidityFields,qualificationValidityPayload,qualificationValidityLabel} from './qualification-validity.ts';
import {readFields,visibleFields} from './domain-commands.ts';
test('qualification periods allow independent long-term choices and submit real dates without time entry',()=>{
 const values={identityValidity:'long-term',identityExpiresAt:'2030-01-01',drivingLicenseValidity:'fixed',drivingLicenseExpiresAt:'2031-02-03'};
 const keys=visibleFields(qualificationValidityFields,values).map(f=>f.key);assert(!keys.includes('identityExpiresAt'));assert(keys.includes('drivingLicenseExpiresAt'));
 assert.deepEqual(qualificationValidityPayload(readFields(qualificationValidityFields,values)),{identityLongTerm:true,identityExpiresAt:null,drivingLicenseLongTerm:false,drivingLicenseExpiresAt:'2031-02-03'});
 assert.deepEqual(qualificationValidityPayload({identityValidity:'long-term',drivingLicenseValidity:'long-term'}),{identityLongTerm:true,identityExpiresAt:null,drivingLicenseLongTerm:true,drivingLicenseExpiresAt:null});
 assert.throws(()=>qualificationValidityPayload({identityValidity:'fixed',drivingLicenseValidity:'long-term'}));
 assert.equal(qualificationValidityLabel(null,true),'长期');assert.notEqual(qualificationValidityLabel(null,false),'长期');
});
