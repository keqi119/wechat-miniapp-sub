import test from 'node:test';
import assert from 'node:assert/strict';
import * as forms from './field/forms.ts';

test('four task types have distinct labels, and unknown types never acquire edit authority',()=>{
 const labels=(forms as any).taskTypeLabel;
 assert.equal(typeof labels,'function');
 assert.deepEqual(['DELIVERY','RETURN','SWAP_RETURN','SWAP_DELIVERY'].map(labels),['初次交车','最终还车','换车归还','换车交付']);
 assert.equal(forms.canEdit({status:'ASSIGNED',canEdit:true,type:'UNRECOGNIZED'} as any),false);
 assert.equal(forms.canEdit({status:'ASSIGNED',canEdit:true,contextChanged:true,type:'SWAP_RETURN'} as any),false);
});

test('server source identity distinguishes quote, vehicle and paper version without computing a new batch',()=>{
 const sourceKey=(forms as any).taskSourceKey;assert.equal(typeof sourceKey,'function');
 const task={id:'t',batchKey:'CHANGE:real:RETURN',changeId:'real',quoteId:'q1',termsVersionId:null,vehicleId:'car',vehicleAssignmentId:'assignment',handover:null,offlineReceipt:null};
 assert.notEqual(sourceKey(task),sourceKey({...task,quoteId:'q2'}));assert.notEqual(sourceKey(task),sourceKey({...task,vehicleId:'other'}));assert.notEqual(sourceKey(task),sourceKey({...task,offlineReceipt:{versionId:'paper'}}));
 assert.equal(sourceKey(task),sourceKey({...task,version:9}),'ordinary task revision is not a newly invented batch');
});
