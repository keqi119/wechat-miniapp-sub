import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LicensePlatesService} from '../src/license-plates/service';
import {plateFixture,actor,command,errorCode,now} from './license-plates-fixture';
const service=new LicensePlatesService(()=>now);
async function created(){const f=plateFixture(),p=await f.serial(tx=>service.create(tx,actor,{...command(),plateNumber:'沪 A１２３４５',plateType:'明确牌照类型'}));f.attach(p.id);return{...f,p};}
const ownership=(revision=0)=>({...command(revision),ownerId:'owner-a',ownerRevision:4,currentOwnershipPeriodId:null,currentOwnershipRevision:null,reason:'实际归属登记',fileIds:['proof']});
const binding=(revision=0)=>({...command(revision),vehicleId:'car-a',vehicleRevision:2,currentBindingId:null,currentBindingRevision:null,oldVehicleId:null,oldVehicleRevision:null,reason:'实际绑定',fileIds:['proof']});
test('registration preserves explicit facts, rejects normalized duplicate and unknown fields; reads never create history',async()=>{
 const f=await created();assert.equal(f.p.normalizedNumber,'沪A12345');assert.equal(f.p.currentOwnership,null);assert.equal(f.p.currentBinding,null);
 await assert.rejects(f.serial(tx=>service.create(tx,actor,{...command(),plateNumber:'沪a12345',plateType:'另一类型'})),errorCode('PLATE_NUMBER_EXISTS'));
 const writes=f.writes.length;const detail=await service.detail(f.tx,actor,f.p.id);assert.equal(detail.files.length,1);assert.equal(detail.ownershipHistory.length,0);assert.equal((await service.list(f.tx,actor,{})).items.length,1);assert.equal(f.writes.length,writes);assert.equal('storagePath'in detail.files[0],false);
});
test('ownership changes close only the prior period with its own CAS and never grant partner or customer scope',async()=>{
 const f=await created(),first=await f.serial(tx=>service.ownership(tx,actor,f.p.id,ownership()));assert.equal(first.currentOwnership.owner.id,'owner-a');const old=structuredClone(f.rows('plateOwnershipPeriod')[0]);
 const input={...ownership(1),ownerId:'owner-b',ownerRevision:5,currentOwnershipPeriodId:old.id,currentOwnershipRevision:0};const second=await f.serial(tx=>service.ownership(tx,actor,f.p.id,input));assert.equal(second.currentOwnership.owner.id,'owner-b');assert.equal(second.currentOwnership.previousPeriodId,old.id);
 const ended=f.rows('plateOwnershipPeriod')[0];assert.equal(ended.ownershipRevision,1);assert.equal(ended.endedBy,actor.id);assert.equal(ended.endReason,input.reason);assert.equal(ended.validUntil.getTime(),now.getTime());for(const field of ['ownerId','plateId','reason','evidenceSnapshot','evidenceFileIds','validFrom'])assert.deepEqual(ended[field],old[field]);
 const history=f.rows('plateOwnershipPeriod').length;assert.deepEqual(await f.serial(tx=>service.ownership(tx,actor,f.p.id,input)),second);assert.equal(f.rows('plateOwnershipPeriod').length,history);assert(f.writes.every(write=>['licensePlate','plateOwnershipPeriod','auditLog','archiveCommand'].includes(write.table)));
});
test('ownership rejects foreign files, suspended owner, stale period and revoked permissions before cached replay',async()=>{
 const f=await created(),other=await f.serial(tx=>service.create(tx,actor,{...command(),plateNumber:'沪B99999',plateType:'类型'}));f.attach(other.id,'foreign');const before=f.writes.length;
 await assert.rejects(f.serial(tx=>service.ownership(tx,actor,f.p.id,{...ownership(),fileIds:['foreign']})),errorCode('ASSET_FILE_INVALID'));assert.equal(f.writes.length,before);
 f.rows('vehicleOwner')[0].status='SUSPENDED';await assert.rejects(f.serial(tx=>service.ownership(tx,actor,f.p.id,ownership())),errorCode('PLATE_OWNER_UNAVAILABLE'));f.rows('vehicleOwner')[0].status='DRAFT';
 const input=ownership();await f.serial(tx=>service.ownership(tx,actor,f.p.id,input));await assert.rejects(f.serial(tx=>service.ownership(tx,actor,f.p.id,{...ownership(1),ownerId:'owner-b',ownerRevision:5})),errorCode('REVISION_CONFLICT'));
 f.rows('adminUser')[0].active=false;await assert.rejects(f.serial(tx=>service.ownership(tx,actor,f.p.id,input)),errorCode('STAFF_SESSION_CHANGED'));
});
test('binding and explicit move update compatibility revisions and end old history without touching reserved assignments',async()=>{
 const f=await created(),first=await f.serial(tx=>service.bind(tx,actor,f.p.id,binding()));const old=structuredClone(f.rows('plateVehicleBinding')[0]);assert.equal(first.currentBinding.vehicle.id,'car-a');assert.equal(first.currentOwnership,null);assert.equal(f.rows('vehicle')[0].plateNumber,f.p.plateNumber);assert.equal(f.rows('vehicle')[0].revision,3);
 await assert.rejects(f.serial(tx=>service.bind(tx,actor,f.p.id,{...binding(1),vehicleId:'car-b',vehicleRevision:3})),errorCode('REVISION_CONFLICT'));
 const input={...binding(1),vehicleId:'car-b',vehicleRevision:3,currentBindingId:old.id,currentBindingRevision:0,oldVehicleId:'car-a',oldVehicleRevision:3};const moved=await f.serial(tx=>service.bind(tx,actor,f.p.id,input));assert.equal(moved.currentBinding.vehicle.id,'car-b');assert.equal(moved.currentBinding.previousBindingId,old.id);assert.equal(f.rows('vehicle')[0].plateNumber,null);assert.equal(f.rows('vehicle')[0].revision,4);assert.equal(f.rows('vehicle')[1].revision,4);assert.equal(f.rows('vehicle')[0].currentAssignmentId,'assignment');
 const ended=f.rows('plateVehicleBinding')[0];assert.equal(ended.bindingRevision,1);assert.equal(ended.endedBy,actor.id);for(const field of ['vehicleId','reason','evidenceSnapshot','validFrom'])assert.deepEqual(ended[field],old[field]);assert.deepEqual(await f.serial(tx=>service.bind(tx,actor,f.p.id,input)),moved);assert.equal(f.rows('plateVehicleBinding').length,2);
 const vehicleWrites=f.writes.filter(w=>w.table==='vehicle');assert(vehicleWrites.every(w=>Object.keys(w.data).every(key=>['plateNumber','revision'].includes(key))));const lockA=f.locks.findIndex(lock=>lock.includes('"Vehicle"')&&lock.endsWith('car-a')),plate=f.locks.findIndex((lock,index)=>index>lockA&&lock.includes('"LicensePlate"'));assert(plate>lockA);
});
test('another active target plate and unverified duplicate text require explicit resolution',async()=>{
 const f=await created(),other=await f.serial(tx=>service.create(tx,actor,{...command(),plateNumber:'沪B99999',plateType:'类型'}));f.attach(other.id,'other-proof');await f.serial(tx=>service.bind(tx,actor,other.id,{...binding(),fileIds:['other-proof']}));
 await assert.rejects(f.serial(tx=>service.bind(tx,actor,f.p.id,{...binding(),vehicleRevision:3})),errorCode('PLATE_TARGET_BOUND'));
 const g=await created();g.rows('vehicle')[1].plateNumber='沪A12345';await assert.rejects(g.serial(tx=>service.bind(tx,actor,g.p.id,binding())),errorCode('PLATE_LEGACY_DUPLICATE'));
});
test('unbind and archive close periods once, require unchanged compatibility facts and preserve evidence',async()=>{
 const f=await created();await f.serial(tx=>service.ownership(tx,actor,f.p.id,ownership()));const bound=await f.serial(tx=>service.bind(tx,actor,f.p.id,binding(1))),b=bound.currentBinding;
 await assert.rejects(f.serial(tx=>service.archive(tx,actor,f.p.id,{...command(2),reason:'归档'})),errorCode('PLATE_STILL_BOUND'));
 const input={...command(2),bindingId:b.id,bindingRevision:0,vehicleRevision:3,reason:'实际解除'};f.rows('vehicle')[0].plateNumber='他牌';await assert.rejects(f.serial(tx=>service.unbind(tx,actor,f.p.id,input)),errorCode('PLATE_COMPATIBILITY_CONFLICT'));f.rows('vehicle')[0].plateNumber=f.p.plateNumber;
 await f.serial(tx=>service.unbind(tx,actor,f.p.id,input));assert.equal(f.rows('vehicle')[0].plateNumber,null);const archived=await f.serial(tx=>service.archive(tx,actor,f.p.id,{...command(3),reason:'实际归档'}));assert.equal(archived.status,'ARCHIVED');assert.equal(archived.currentOwnership,null);assert.equal(archived.ownershipHistory[0].endReason,'实际归档');assert.equal(archived.files.length,1);await assert.rejects(f.serial(tx=>service.update(tx,actor,f.p.id,{...command(4),notes:'change'})),errorCode('PLATE_ARCHIVED'));
});
test('legacy candidate listing is read-only, reports duplicate canonical text and never guesses an owner',async()=>{
 const f=plateFixture();f.rows('vehicle')[0].plateNumber=' 沪Ａ12345 ';f.rows('vehicle')[1].plateNumber='沪a12345';const result=await service.candidates(f.tx,actor,{});assert.equal(result.total,2);assert.equal(result.items[0].duplicateVehicleIds.length,2);assert.equal(result.items[0].normalizedNumber,'沪A12345');assert.equal('ownerId'in result.items[0],false);assert.equal(f.writes.length,0);
 await assert.rejects(service.candidates(f.tx,{id:'finance',role:'FINANCE',authVersion:1},{}),errorCode('FORBIDDEN'));
});
test('a new binding after explicit unbind links the preceding ended event without editing it',async()=>{
 const f=await created(),bound=await f.serial(tx=>service.bind(tx,actor,f.p.id,binding())),old=bound.currentBinding;
 await f.serial(tx=>service.unbind(tx,actor,f.p.id,{...command(1),bindingId:old.id,bindingRevision:0,vehicleRevision:3,reason:'实际解除'}));const ended=structuredClone(f.rows('plateVehicleBinding')[0]);
 const rebound=await f.serial(tx=>service.bind(tx,actor,f.p.id,{...binding(2),vehicleId:'car-b',vehicleRevision:3}));assert.equal(rebound.currentBinding.previousBindingId,old.id);assert.deepEqual(f.rows('plateVehicleBinding')[0],ended);
});
test('explicit correction resolves duplicate legacy candidates without inventing ownership or binding history',async()=>{
 const f=await created();f.rows('vehicle')[0].plateNumber='沪A12345';f.rows('vehicle')[1].plateNumber=' 沪ａ１２３４５ ';await assert.rejects(f.serial(tx=>service.bind(tx,actor,f.p.id,binding())),errorCode('PLATE_LEGACY_DUPLICATE'));
 const input={...command(),vehicleId:'car-b',vehicleRevision:3,plateNumber:' 沪ａ１２３４５ ',reason:'已核对B车旧号码为误录，只清理错误显示',fileIds:['proof']};const clear=(service as any).clearLegacy.bind(service);
 await assert.rejects(f.serial(tx=>clear(tx,actor,f.p.id,{...input,plateNumber:'沪A12345'})),errorCode('REVISION_CONFLICT'));
 const corrected=await f.serial(tx=>clear(tx,actor,f.p.id,input));assert.equal(corrected.revision,1);assert.equal(f.rows('vehicle')[1].plateNumber,null);assert.equal(f.rows('vehicle')[1].revision,4);assert.equal(f.rows('plateVehicleBinding').length,0);assert.equal(f.rows('plateOwnershipPeriod').length,0);
 assert.deepEqual(await f.serial(tx=>clear(tx,actor,f.p.id,input)),corrected);const audit=f.rows('auditLog').find(row=>row.action==='CLEAR_LEGACY_PLATE');assert.equal(audit.data.plateNumberBefore,input.plateNumber);assert.equal(audit.data.plateNumberAfter,null);assert.equal(audit.data.evidenceSnapshot[0].id,'proof');assert.equal(audit.data.reason,input.reason);
 const bound=await f.serial(tx=>service.bind(tx,actor,f.p.id,binding(1)));assert.equal(bound.currentBinding.vehicleId,'car-a');await assert.rejects(f.serial(tx=>clear(tx,actor,f.p.id,{...command(2),vehicleId:'car-a',vehicleRevision:3,plateNumber:f.p.plateNumber,reason:'禁止绕过正式解绑',fileIds:['proof']})),errorCode('PLATE_LEGACY_BOUND'));
});
