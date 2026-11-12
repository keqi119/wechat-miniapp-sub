import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePolicyReviewChecks} from '../src/insurance/service';
import {reviewInput} from '../src/insurance/types';
test('cancellation is reviewed as cancellation evidence, never a fabricated coverage approval',()=>{
 const input=reviewInput.parse({decision:'APPROVED',revision:0,idempotencyKey:'cancel-review',checks:[],reason:'已核对退保文件与生效时间'});
 assert.deepEqual(validatePolicyReviewChecks({changeKind:'CANCELLATION'} as any,[],input.checks),[]);
 assert.throws(()=>validatePolicyReviewChecks({changeKind:'ORIGINAL'} as any,[],[]));
 assert.throws(()=>validatePolicyReviewChecks({changeKind:'CANCELLATION'} as any,[],[{}]));
});
