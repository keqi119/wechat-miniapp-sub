import test from 'node:test';
import assert from 'node:assert/strict';
import {OwnerClient,OwnerApiError} from './client.ts';
import * as workspace from './workspace.ts';

const handover={id:'shared-task',resourceId:'shared-document',documentDomain:'PLATFORM_HANDOVER',kind:'HANDOVER',handoverType:'DELIVERY',status:'PENDING',ownerMode:'MANUAL',createdAt:'2026-10-25T00:00:00Z',archivedAt:null,reviewedAt:null,parties:[{role:'CUSTOMER',status:'SIGNED'},{role:'PLATFORM',status:'PENDING'}],orderId:'order-1',vehicleTitle:'测试车辆',monthlyFeeAmount:null,depositAmount:null,months:null,documentHash:'a'.repeat(64),sourceSha256:'b'.repeat(64),sourceAvailable:true,signedAvailable:false,canSign:true,canQuery:true,blockers:[]};
const owner={...handover,documentDomain:undefined,kind:'SUBSCRIPTION',handoverType:undefined,parties:[{role:'CUSTOMER',status:'SIGNED'},{role:'OWNER',status:'PENDING'}]};

test('historical handover links stay closed in the readonly portal',async()=>{
 let requests=0;const api=new OwnerClient(async()=>{requests++;return new Response('{}');});api.setCsrf('local');
 for(const path of ['/owners/p1/handovers','/owners/p1/handovers/t1','/owners/p1/handovers/t1/files/source'])await assert.rejects(api.request(path));
 for(const action of ['sign','sync'])await assert.rejects(api.request(`/owners/p1/handovers/t1/${action}`,{}),(e:unknown)=>e instanceof OwnerApiError&&e.code==='PARTNER_READ_ONLY');
 assert.equal(requests,0);
});test('handover grouping uses PLATFORM signature rather than OWNER, including archive pending state',()=>{
 assert.deepEqual(workspace.contractPresentation({...handover,parties:[{role:'CUSTOMER',status:'SIGNED'},{role:'PLATFORM',status:'SIGNED'}]} as any),{group:'processing',label:'双方已签，待归档'});
 assert.equal(workspace.contractPresentation({...handover,parties:[{role:'CUSTOMER',status:'SIGNED'},{role:'PLATFORM',status:'UNKNOWN'}]} as any).group,'processing');
 assert.equal(workspace.contractPresentation({...handover,parties:[{role:'CUSTOMER',status:'PENDING'},{role:'PLATFORM',status:'PENDING'}]} as any).label,'待客户签署');
 assert.equal(workspace.contractPresentation({...handover,status:'ARCHIVED'} as any).group,'completed');
});
test('same task and PDF hashes cannot transfer manual confirmation between document domains or handover types',()=>{
 const key=workspace.contractConfirmationKey(handover as any);
 assert.deepEqual(workspace.contractSignPayload(handover as any,key,true),{accepted:true,documentHash:'a'.repeat(64),sourceSha256:'b'.repeat(64)});
 assert.notEqual(key,workspace.contractConfirmationKey({...handover,documentDomain:undefined} as any));
 for(const changed of [owner,{...handover,handoverType:'RETURN'},{...handover,id:'another-task'},{...handover,documentHash:'c'.repeat(64)},{...handover,sourceSha256:'d'.repeat(64)},{...handover,canSign:false},{...handover,sourceAvailable:false},{...handover,parties:[{role:'CUSTOMER',status:'PENDING'}]}])assert.throws(()=>workspace.contractSignPayload(changed as any,key,true));
 assert.throws(()=>workspace.contractSignPayload(handover as any,key,false));
});
test('document keys and all action paths separate colliding task IDs and reject mismatched endpoint data',()=>{
 assert.notEqual(workspace.contractTaskKey(handover as any),workspace.contractTaskKey(owner as any));
 assert.equal(workspace.contractPath('owner-1',handover as any),'/owners/owner-1/handovers/shared-task');
 assert.equal(workspace.contractPath('owner-1',owner as any),'/owners/owner-1/contracts/shared-task');
 assert.equal(workspace.contractFilePath('owner-1','shared-task','source','PLATFORM_HANDOVER'),'/owner/api/owners/owner-1/handovers/shared-task/files/source');
 assert.equal(workspace.contractFilePath('owner-1','shared-task','signed'),'/owner/api/owners/owner-1/contracts/shared-task/files/signed');
 assert.equal(workspace.checkedContract(handover as any,'PLATFORM_HANDOVER','shared-task').id,'shared-task');
 assert.throws(()=>workspace.checkedContract(handover as any,'OWNER_CONTRACT'));
 assert.throws(()=>workspace.checkedContract(owner as any,'PLATFORM_HANDOVER'));
 assert.throws(()=>workspace.checkedContract(handover as any,'PLATFORM_HANDOVER','another-task'));
 assert.throws(()=>workspace.contractPath('owner-1',{...handover,documentDomain:undefined} as any));
 assert.throws(()=>workspace.contractPath('../owner-1',handover as any));
 assert.throws(()=>workspace.contractPath('owner-1',{...handover,documentDomain:'OTHER'} as any));
});
test('handover type names distinguish delivery and return and never infer unfamiliar handover kinds',()=>{
 assert.equal(workspace.contractKindLabel(handover as any),'交车交接单');
 assert.equal(workspace.contractKindLabel({...handover,handoverType:'RETURN'} as any),'还车交接单');
 assert.equal(workspace.contractKindLabel({...handover,handoverType:'SWAP_RETURN'} as any),'车辆交接单');
 assert.equal(workspace.contractKindLabel(owner as any),'订阅主合同及费用附件');
});

