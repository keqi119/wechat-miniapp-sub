import test from 'node:test';
import assert from 'node:assert/strict';
import * as workspace from './workspace.ts';

const base={id:'task-1',resourceId:'contract-1',kind:'SUBSCRIPTION',status:'PENDING',ownerMode:'MANUAL',parties:[{role:'CUSTOMER',status:'SIGNED'},{role:'OWNER',status:'PENDING'}],documentHash:'a'.repeat(64),sourceSha256:'b'.repeat(64),sourceAvailable:true,signedAvailable:false,canSign:true,canQuery:true,blockers:[]};
test('contract grouping uses actual signature state, never treats a signing link as contract expiry',()=>{
 assert.equal(workspace.contractPresentation(base as any).group,'pending');
 assert.equal(workspace.contractPresentation(base as any).label,'待法人签署');
 assert.equal(workspace.contractPresentation({...base,parties:[{role:'CUSTOMER',status:'PENDING'}]} as any).label,'待客户签署');
 for(const status of ['ARCHIVED','REJECTED','EXPIRED','CANCELLED','UNKNOWN']){
  const result=workspace.contractPresentation({...base,status} as any);
  assert.equal(result.group,status==='ARCHIVED'?'completed':status==='UNKNOWN'?'processing':'closed');
 }
 assert.equal(workspace.contractPresentation({...base,status:'EXPIRED'} as any).label,'签署已过期');
});
test('manual confirmation is bound to exact task and immutable PDF and never inferred from an authorization letter',()=>{
 const key=workspace.contractConfirmationKey(base as any);
 assert.deepEqual(workspace.contractSignPayload(base as any,key,true),{accepted:true,documentHash:base.documentHash,sourceSha256:base.sourceSha256});
 for(const changed of [{...base,id:'other'},{...base,documentHash:'c'.repeat(64)},{...base,sourceSha256:'c'.repeat(64)},{...base,canSign:false},{...base,status:'ARCHIVED'},{...base,parties:[{role:'CUSTOMER',status:'PENDING'}]}])assert.throws(()=>workspace.contractSignPayload(changed as any,key,true));
 assert.throws(()=>workspace.contractSignPayload(base as any,key,false));
 assert.throws(()=>workspace.contractSignPayload({...base,sourceSha256:null} as any,key,true));
});
test('current signed letters stay visible and historical channel grants cannot masquerade as current signing authorization',()=>{
 const letter={method:'UNILATERAL_LETTER',status:'SIGNED',certificateMatchesCurrent:true,scope:{validFrom:'2026-01-01',validUntil:'2099-01-01'}};
 assert.equal(workspace.authoritySection(letter as any),'current');
 assert.equal(workspace.authoritySection({...letter,status:'PENDING',certificateMatchesCurrent:false} as any),'attention');
 assert.equal(workspace.authoritySection({...letter,status:'WITHDRAWN'} as any),'history');
 assert.equal(workspace.authoritySection({...letter,method:'PROVIDER_AUTO_GRANT',status:'REVOKING'} as any),'history');
 assert.equal(workspace.authoritySection({...letter,scope:{validUntil:'2020-01-01'}} as any),'history');
 assert.match(workspace.authorityGuidance({...letter,status:'PENDING',certificateMatchesCurrent:false} as any),/建议撤回/);
 assert.match(workspace.authorityGuidance({...letter,status:'REJECTED',certificateMatchesCurrent:false} as any),/无需继续/);
 assert.match(workspace.authorityGuidance({...letter,scope:{validUntil:'2020-01-01'}} as any),/授权期间已结束/);
 assert.match(workspace.authorityGuidance({...letter,method:'PROVIDER_AUTO_GRANT',status:'REVOKING'} as any),/查询/);
});
