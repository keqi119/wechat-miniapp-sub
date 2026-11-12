import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FieldArchiveService} from '../src/offline-documents/field';
test('paper receipt files require the current assignee, task, manifest and material generation',async()=>{
 const task:any={id:'task',orderId:'o',assigneeId:'field',status:'ASSIGNED',version:2,materialGeneration:3,currentHandoverId:'h',vehicleId:'v',vehicleAssignmentId:null,type:'RETURN'};
 const file:any={id:'f',purpose:'offline-archive',fieldTaskId:'task',fieldTaskGeneration:3};
 const archive:any={id:'a',orderId:'o',handoverId:'h',kind:'RETURN_RECEIPT',versions:[{id:'av',version:1,businessSnapshotHash:'current',files:[{fileId:'f',file}]}]};
 const handover:any={id:'h',fieldTaskId:'task',vehicleId:'v',assignmentId:null,type:'RETURN',manifestHash:'current'};
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},$queryRaw:async()=>[],fieldHandoverTask:{findUnique:async()=>task},adminUser:{findUnique:async()=>({id:'field',role:'FIELD',active:true,authVersion:1})},archiveFile:{findUnique:async()=>({fileId:'f',versionId:'av',version:{archiveId:'a'},file})},documentArchive:{findUnique:async()=>archive},handover:{findUnique:async()=>handover}};
 const service=new FieldArchiveService({serial:async(fn:any)=>fn(tx)} as any),actor={id:'field',role:'FIELD',authVersion:1};
 assert.equal((await service.file('task','f',actor)).id,'f');
 task.assigneeId='replacement';await assert.rejects(service.file('task','f',actor));task.assigneeId='field';
 handover.manifestHash='new-manifest';await assert.rejects(service.file('task','f',actor));handover.manifestHash='current';
 file.fieldTaskGeneration=2;await assert.rejects(service.file('task','f',actor));
});
