import {test} from 'node:test';
import assert from 'node:assert/strict';
import {platformAuthorityState,canRequestPlatformAuthority} from './platform-authority.ts';
const base:any={id:'a',scope:{version:3},status:'AUTHORIZED',enabled:true,scopeReviewStatus:'VERIFIED',pausedAt:null,document:{signedAvailable:true}};
test('completed grant hides repeat application and enable confirmation; signed PDF remains accessible',()=>{
 assert.deepEqual(platformAuthorityState(base),{label:'已授权',canResume:false,canContinue:false,canRevoke:true});assert.equal(canRequestPlatformAuthority([base]),false);
 assert.equal(platformAuthorityState({...base,enabled:false,scopeReviewStatus:'PENDING'}).label,'授权范围待核验');
});
test('only explicit pause exposes resume; pending, unknown and revoked are distinct',()=>{
 assert.equal(platformAuthorityState({...base,pausedAt:'now',enabled:false}).canResume,true);
 assert.equal(platformAuthorityState({...base,status:'PENDING',enabled:false,document:null}).canContinue,true);
 assert.equal(platformAuthorityState({...base,status:'UNKNOWN',enabled:false,document:null}).canContinue,false);
 assert.equal(platformAuthorityState({...base,status:'REVOKING',pausedAt:'now',enabled:false}).label,'取消授权处理中');
 assert.equal(canRequestPlatformAuthority([{...base,status:'REVOKED'}]),true);
});
