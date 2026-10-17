import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownerScope,evaluateOwnerSigning} from '../src/owner-signing/rules';
const now=new Date('2026-10-17T10:00:00Z');
const scope={version:1,vehicleIds:['vehicleA'],templateId:'templateA',templateVersion:2,templateHash:'a'.repeat(64),validFrom:'2026-10-17T00:00:00Z',validUntil:'2027-10-17T00:00:00Z',minMonthlyFeeAmount:1,maxMonthlyFeeAmount:500000,minDepositAmount:0,maxDepositAmount:1000000,minMonths:1,maxMonths:12};
const ready=()=>({ownerId:'OwnerA',sealId:'SealA',certificateSerialNo:'CertA',ownerVerified:true,memberVerified:true,certificateValid:true,sealCurrent:true,identityCheckedAt:now,kind:'SUBSCRIPTION',vehicleId:'vehicleA',templateId:'templateA',templateVersion:2,templateHash:'a'.repeat(64),monthlyFeeAmount:1,depositAmount:0,months:12,customerSigned:true,reviewed:true,authority:{ownerId:'OwnerA',sealId:'SealA',certificateSerialNo:'CertA',enabled:true,status:'AUTHORIZED',providerAuthorized:true,providerCheckedAt:now,scope}});
test('scope is strict, bounded, finite, unique and preserves integer fen',()=>{
 assert.equal(ownerScope.parse(scope).minMonthlyFeeAmount,1);
 for(const patch of [{maxMonthlyFeeAmount:0},{minDepositAmount:-1},{maxDepositAmount:2147483648},{minMonths:13},{vehicleIds:[]},{vehicleIds:['vehicleA','vehicleA']},{validUntil:scope.validFrom},{minMonthlyFeeAmount:0.01},{templateHash:'fake'},{extra:true}])assert.equal(ownerScope.safeParse({...scope,...patch}).success,false);
});
test('auto signing requires exact owner seal certificate template vehicle scope and current grant evidence',()=>{
 assert.equal(evaluateOwnerSigning(ready(),now).decision,'AUTO_ALLOWED');
 for(const patch of [{ownerId:'Other'},{sealId:'Other'},{certificateSerialNo:'Renewed'},{vehicleId:'Other'},{templateHash:'b'.repeat(64)},{templateVersion:3},{monthlyFeeAmount:500001},{depositAmount:1000001},{months:13},{customerSigned:false},{reviewed:false},{kind:'AMENDMENT'}])assert.notEqual(evaluateOwnerSigning({...ready(),...patch},now).decision,'AUTO_ALLOWED');
 for(const patch of [{enabled:false},{providerAuthorized:false},{status:'REVOKED'},{providerCheckedAt:new Date(now.getTime()-61000)}])assert.notEqual(evaluateOwnerSigning({...ready(),authority:{...ready().authority,...patch}},now).decision,'AUTO_ALLOWED');
 assert.notEqual(evaluateOwnerSigning(ready(),new Date(scope.validUntil)).decision,'AUTO_ALLOWED');
});
test('manual is the default but an unverified owner or certificate never gets a signing grant',()=>{
 assert.equal(evaluateOwnerSigning({...ready(),authority:null},now).decision,'MANUAL_REQUIRED');
 for(const patch of [{ownerVerified:false},{memberVerified:false},{certificateValid:false},{sealCurrent:false},{identityCheckedAt:new Date(0)}])assert.equal(evaluateOwnerSigning({...ready(),...patch},now).decision,'BLOCKED');
});
