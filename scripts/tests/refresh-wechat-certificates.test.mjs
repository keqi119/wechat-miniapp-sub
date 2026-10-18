import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCertificateConfig } from '../refresh-wechat-certificates.mjs';

test('certificate refresh tolerates blank lines, comments and CRLF in production config', () => {
 const input='\uFEFF# production\r\nWECHAT_PAY_MCH_ID="synthetic-merchant"\r\n\r\n  # location configuration appended later\r\nWECHAT_PAY_API_V3_KEY="synthetic-key"\r\n\r\nHANDOVER_LOCATION_POLICY_JSON={"enabled":true}\r\nOTHER_FLAG=false\r\n';
 assert.deepEqual(parseCertificateConfig(input), { WECHAT_PAY_MCH_ID:'synthetic-merchant', WECHAT_PAY_API_V3_KEY:'synthetic-key', HANDOVER_LOCATION_POLICY_JSON:{enabled:true}, OTHER_FLAG:false });
});
test('malformed or duplicate configuration fails with no credential value in error', () => {
 for(const input of ['SECRET=never-print-this-secret', 'SECRET="never-print-this-secret"\nSECRET="second"', 'invalid-line-with-sensitive-content']){
  assert.throws(()=>parseCertificateConfig(input),error=>error.message==='CERTIFICATE_CONFIG_INVALID'&&!error.message.includes('never-print'));
 }
});
test('quoted values preserve equals signs and JSON escapes',()=>{
 assert.deepEqual(parseCertificateConfig('VALUE="part=one\\npart=two"'),{VALUE:'part=one\npart=two'});
});
