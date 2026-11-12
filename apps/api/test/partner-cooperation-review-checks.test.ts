import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as cooperation from '../src/partners/cooperation';

test('rejected cooperation records failed subject, vehicle and rule checks honestly',()=>{
 const parse=(cooperation as any).parseCooperationDomainReview;
 assert.equal(typeof parse,'function');
 for(const [domain,checks] of [
  ['SUBJECT',{identityChecked:false,ownershipChecked:false,businessLicenseChecked:false,representativeAuthorityChecked:false}],
  ['VEHICLE',{ownershipChecked:false}],['RULE',{termsChecked:false}],
 ] as const) assert.deepEqual(parse(domain,checks,'REJECT','ENTERPRISE'),checks);
});

test('approval still requires every applicable check and rejects unknown fields',()=>{
 const parse=(cooperation as any).parseCooperationDomainReview;
 assert.equal(typeof parse,'function');
 assert.throws(()=>parse('SUBJECT',{identityChecked:true,ownershipChecked:true,businessLicenseChecked:false,representativeAuthorityChecked:true},'APPROVE','ENTERPRISE'));
 assert.throws(()=>parse('VEHICLE',{ownershipChecked:false},'APPROVE','INDIVIDUAL'));
 assert.throws(()=>parse('RULE',{termsChecked:false},'APPROVE','INDIVIDUAL'));
 assert.throws(()=>parse('RULE',{termsChecked:false,skipReview:true},'REJECT','INDIVIDUAL'));
 assert.deepEqual(parse('SUBJECT',{identityChecked:true,ownershipChecked:true,representativeAuthorityChecked:true},'APPROVE','INDIVIDUAL'),{identityChecked:true,ownershipChecked:true,representativeAuthorityChecked:true});
});
