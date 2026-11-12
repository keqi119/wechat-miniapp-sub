import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ensureAssignments} from '../src/vehicle-changes/assignments';
test('offline allocation uses completed physical facts and current paper archive without SIGNED fiction',async()=>{
 const item={id:'delivery',orderId:'order',type:'DELIVERY',executionMode:'OFFLINE',status:'COMPLETED',customerResponse:'CONFIRM',confirmedAt:new Date(),actualAt:new Date(),readingKm:100,manifestHash:'facts'};let allocated=0;
 const tx:any={$queryRaw:async()=>[],vehicleAssignment:{count:async()=>0,create:async({data}:any)=>{allocated++;return{id:'assignment',...data};}},order:{update:async()=>({})},handover:{findFirst:async({where}:any)=>{if(where.type==='RETURN')return null;assert.equal(where.signatureStatus,undefined);assert.equal(where.executionMode,'OFFLINE');return item;},findUnique:async()=>item,update:async()=>{}},documentArchive:{findFirst:async()=>({currentApprovedVersionId:'paper',versions:[{id:'paper',status:'ARCHIVED',businessSnapshotHash:'facts'}]})},archiveFeedback:{count:async()=>0},usagePeriod:{findMany:async()=>[]}};
 await ensureAssignments(tx,{id:'order',customerId:'customer',vehicleId:'vehicle',contractMode:'OFFLINE'});assert.equal(allocated,1);
 item.customerResponse='OBJECT';await assert.rejects(ensureAssignments(tx,{id:'order',customerId:'customer',vehicleId:'vehicle',contractMode:'OFFLINE'}));assert.equal(allocated,1);
});
