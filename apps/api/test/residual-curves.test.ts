import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonicalHash} from '../src/customers/types';
import {ResidualCurvesService} from '../src/residual-market/curves';
import {ResidualCurvesController} from '../src/residual-market/curve-controller';
import {curveCreateInput,curvePreviewInput} from '../src/residual-market/curve-types';
import {curveError,curveFinance,curveNow,curveOperator,curveRequest,residualCurveFixture} from './residual-curves-fixture';

const command=(revision=0)=>({revision,idempotencyKey:randomUUID()});
async function draft(){const f=residualCurveFixture(),service=new ResidualCurvesService(()=>curveNow),request=curveRequest(),preview=await service.preview(f.tx,curveOperator,request),input={...request,...command(),previewHash:preview.previewHash},row=await f.serial(tx=>service.create(tx,curveOperator,input));return{...f,service,request,preview,input,row};}

test('strict curve inputs require explicit model revision and reject state, snapshot, invalid dates and unsafe money',()=>{
 assert.equal(curvePreviewInput.safeParse(curveRequest()).success,true);
 for(const change of [{modelRevision:undefined},{status:'ACTIVE'},{sourceHash:'a'.repeat(64)},{sampleStartDate:'2026-02-30'},{minSamplePerPoint:0},{referencePriceAmount:2147483648},{priceTypes:['TRANSACTION','TRANSACTION']},{batteryOwnership:'UNKNOWN'}])assert.equal(curvePreviewInput.safeParse(curveRequest(change)).success,false,JSON.stringify(change));
 assert.equal(curveCreateInput.safeParse({...curveRequest(),...command(1),previewHash:'a'.repeat(64)}).success,false);
});

test('finance preview is read-only, selects this model ACTIVE samples and freezes typed provenance and exact point amounts',async()=>{
 const f=residualCurveFixture(),service=new ResidualCurvesService(()=>curveNow);f.seed('marketPriceObservation',{...f.rows('marketPriceObservation')[0],id:'ignored',status:'IGNORED',priceAmount:1});f.seed('marketPriceObservation',{...f.rows('marketPriceObservation')[0],id:'other-model',modelDefinitionId:'other',priceAmount:1});
 const before=f.writes.length,preview=await service.preview(f.tx,curveFinance,curveRequest({referencePriceAmount:200000}));assert.equal(f.writes.length,before);assert.equal(f.locks.length,0);assert.equal(preview.sampleCount,3);assert.deepEqual(preview.points.map((p:any)=>[p.ageMonth,p.sampleCount,p.medianPriceAmount,p.p25PriceAmount,p.p75PriceAmount]),[[12,3,100003,100002,100004]]);assert.equal(preview.sourceHash,canonicalHash(preview.sourceSnapshot));assert.equal(preview.sourceSnapshot.observations[0].observedOn,'2026-10-30');assert.equal(preview.sourceSnapshot.observations[0].series,null);assert.equal('sourceNote'in preview.sourceSnapshot.observations[0],false);
 for(const role of ['SUPPORT','FIELD'])await assert.rejects(service.preview(f.tx,{id:role.toLowerCase(),role,authVersion:1},curveRequest()),curveError('FORBIDDEN'));
 await assert.rejects(service.preview(f.tx,curveOperator,curveRequest({modelRevision:1})),curveError('REVISION_CONFLICT'));
});

test('create stores a DRAFT and per-point immutable sample evidence, with replay before changed live sources and no financial effects',async()=>{
 const f=await draft();assert.equal(f.row.status,'DRAFT');assert.equal(f.row.revision,0);assert.equal(f.row.activatedAt,null);assert.equal(f.row.points.length,1);assert.deepEqual(f.row.points[0].sampleSnapshot.map((s:any)=>[s.observationId,s.revision,s.priceAmount]),[['observation-0',0,100001],['observation-1',0,100003],['observation-2',0,100005]]);assert.equal(f.rows('vehicleResidualCurvePoint').length,1);
 const before=f.writes.length;f.rows('marketPriceObservation')[0].status='VOIDED';assert.deepEqual(await f.serial(tx=>f.service.create(tx,curveOperator,f.input)),f.row);assert.equal(f.writes.length,before);await assert.rejects(f.serial(tx=>f.service.create(tx,curveOperator,{...f.input,name:'同键改内容'})),curveError('IDEMPOTENCY_CONFLICT'));
 await assert.rejects(f.serial(tx=>f.service.create(tx,curveFinance,{...f.input,...command()})),curveError('FORBIDDEN'));
 f.rows('adminUser').find(u=>u.id===curveOperator.id).role='SUPPORT';await assert.rejects(f.serial(tx=>f.service.create(tx,curveOperator,f.input)),curveError('STAFF_SESSION_CHANGED'));assert.ok(f.writes.every(w=>['vehicleResidualCurve','vehicleResidualCurvePoint','archiveCommand','auditLog'].includes(w.table)));
});

test('stale preview, model changes and no usable points cannot create any partial curve',async()=>{
 const f=residualCurveFixture(),service=new ResidualCurvesService(()=>curveNow),request=curveRequest(),preview=await service.preview(f.tx,curveOperator,request);f.rows('marketPriceObservation')[0].revision++;
 await assert.rejects(f.serial(tx=>service.create(tx,curveOperator,{...request,...command(),previewHash:preview.previewHash})),curveError('PREVIEW_CHANGED'));assert.equal(f.rows('vehicleResidualCurve').length,0);assert.equal(f.writes.length,0);
 f.rows('modelDefinition')[0].revision++;await assert.rejects(f.serial(tx=>service.create(tx,curveOperator,{...request,...command(),previewHash:preview.previewHash})),curveError('REVISION_CONFLICT'));f.rows('modelDefinition')[0].revision=0;
 const empty=await service.preview(f.tx,curveOperator,curveRequest({minSamplePerPoint:4}));assert.equal(empty.points.length,0);await assert.rejects(f.serial(tx=>service.create(tx,curveOperator,{...curveRequest({minSamplePerPoint:4}),...command(),previewHash:empty.previewHash})),curveError('RESIDUAL_NO_POINTS'));assert.equal(f.rows('vehicleResidualCurve').length,0);
});

test('activation uses Shanghai today, source freshness and dimension locks, supersedes one old ACTIVE without rewriting either source',async()=>{
 const f=await draft();await assert.rejects(f.serial(tx=>f.service.activate(tx,curveOperator,f.row.id,{...command(),effectiveFrom:'2026-10-30',reason:'不回填'})),curveError('RESIDUAL_EFFECTIVE_DATE'));
 const activate={...command(),effectiveFrom:'2026-10-31',reason:'核对生效'},first=await f.serial(tx=>f.service.activate(tx,curveOperator,f.row.id,activate));assert.equal(first.status,'ACTIVE');assert.equal(first.effectiveFrom,'2026-10-31');assert.equal(first.activatedBy,curveOperator.id);assert.equal(first.revision,1);assert.ok(f.locks.some(lock=>lock.includes('pg_advisory_xact_lock')&&lock.includes(first.dimensionHash)));assert.ok(f.locks.some(lock=>lock.includes('VehicleResidualCurve')));
 const firstHash=first.sourceHash,preview=await f.service.preview(f.tx,curveOperator,{...f.request,name:'新曲线'}),second=await f.serial(tx=>f.service.create(tx,curveOperator,{...f.request,name:'新曲线',...command(),previewHash:preview.previewHash}));
 const active=await f.serial(tx=>f.service.activate(tx,curveOperator,second.id,{...command(),effectiveFrom:'2026-10-31',reason:'新曲线替代'}));assert.equal(active.status,'ACTIVE');const older=f.rows('vehicleResidualCurve').find(r=>r.id===first.id);assert.equal(older.status,'SUPERSEDED');assert.ok(older.supersededAt);assert.equal(older.sourceHash,firstHash);assert.equal(f.rows('vehicleResidualCurve').filter(r=>r.status==='ACTIVE').length,1);
 const writes=f.writes.length;f.rows('marketPriceObservation')[0].status='VOIDED';assert.deepEqual(await f.serial(tx=>f.service.activate(tx,curveOperator,f.row.id,activate)),first);assert.equal(f.writes.length,writes);assert.equal((await f.service.detail(f.tx,curveFinance,first.id)).sourceHash,firstHash);
});

test('first activation rejects changed sample set, status, evidence revision and model revision while preserving its original draft',async()=>{
 for(const mutate of [(f:any)=>{f.rows('marketPriceObservation')[0].status='IGNORED';},(f:any)=>{f.rows('marketPriceObservation')[0].revision++;},(f:any)=>{f.rows('modelDefinition')[0].revision++;},(f:any)=>f.seed('marketPriceObservation',{...f.rows('marketPriceObservation')[0],id:'new-sample'})]){
  const f=await draft(),hash=f.row.sourceHash;mutate(f);const count=f.writes.length;await assert.rejects(f.serial(tx=>f.service.activate(tx,curveOperator,f.row.id,{...command(),effectiveFrom:'2026-10-31',reason:'旧来源'})),curveError('SOURCE_CHANGED'));assert.equal(f.writes.length,count);assert.equal(f.rows('vehicleResidualCurve')[0].status,'DRAFT');assert.equal(f.rows('vehicleResidualCurve')[0].sourceHash,hash);assert.equal((await f.service.detail(f.tx,curveFinance,f.row.id)).sourceHash,hash);
 }
});

test('stored hash, point arithmetic and per-sample evidence are revalidated; archival only changes state metadata',async()=>{
 for(const corrupt of [(f:any)=>{f.rows('vehicleResidualCurve')[0].sourceHash='b'.repeat(64);},(f:any)=>{f.rows('vehicleResidualCurvePoint')[0].medianPriceAmount++;},(f:any)=>{f.rows('vehicleResidualCurvePoint')[0].sampleSnapshot[0].revision++;}]){const f=await draft();corrupt(f);await assert.rejects(f.service.detail(f.tx,curveFinance,f.row.id),curveError('RESIDUAL_SOURCE_INVALID'));}
 const f=await draft(),frozen=structuredClone(f.rows('vehicleResidualCurvePoint')),archived=await f.serial(tx=>f.service.archive(tx,curveOperator,f.row.id,{...command(),reason:'保留历史归档'}));assert.equal(archived.status,'ARCHIVED');assert.ok(archived.archivedAt);assert.deepEqual(f.rows('vehicleResidualCurvePoint'),frozen);assert.equal(archived.sourceHash,f.row.sourceHash);await assert.rejects(f.serial(tx=>f.service.activate(tx,curveOperator,f.row.id,{...command(1),effectiveFrom:'2026-10-31',reason:'归档不复活'})),curveError('RESIDUAL_CURVE_STATE'));
 const list=await f.service.list(f.tx,curveFinance,{status:'ARCHIVED',modelDefinitionId:'model'});assert.equal(list.total,1);assert.equal('sourceSnapshot'in list.items[0],false);assert.equal(list.items[0].id,f.row.id);
});

test('curve controller registers the exact read-preview POST and separate mutation routes',()=>{
 assert.equal(Reflect.getMetadata('path',ResidualCurvesController),'admin/residual-curves');for(const [name,path,method] of [['preview','preview',1],['create','/',1],['detail',':id',0],['activate',':id/activate',1],['archive',':id/archive',1]] as const){const handler=(ResidualCurvesController.prototype as any)[name];assert.equal(typeof handler,'function');assert.equal(Reflect.getMetadata('path',handler),path);assert.equal(Reflect.getMetadata('method',handler),method);}
});

test('curve mutation transactions restart a precise command unique race and replay the existing result without live-source writes',async()=>{
 const race={code:'P2002',meta:{modelName:'ArchiveCommand',target:['actorId','resourceId','action','key']}};
 for(const method of ['create','activate','archive'] as const){
  const f=await draft();let expected=f.row,input:any=f.input;
  if(method==='activate'){input={...command(),effectiveFrom:'2026-10-31',reason:'同键生效重放'};expected=await f.serial(tx=>f.service.activate(tx,curveOperator,f.row.id,input));}
  if(method==='archive'){input={...command(),reason:'同键归档重放'};expected=await f.serial(tx=>f.service.archive(tx,curveOperator,f.row.id,input));}
  f.rows('marketPriceObservation')[0].status='VOIDED';const before=f.writes.length;let attempts=0;
  const db={serial:async(operation:any)=>{attempts++;if(attempts===1)throw race;return f.serial(operation);}},controller=new ResidualCurvesController(db as any);(controller as any).curves=f.service;
  const actual=method==='create'?await controller.create(input,{admin:curveOperator}):await controller[method](f.row.id,input,{admin:curveOperator});
  assert.deepEqual(actual,expected);assert.equal(attempts,2);assert.equal(f.writes.length,before);
 }
});

test('curve transaction retries are bounded and other unique constraints, unknown errors and reads are never retried',async()=>{
 const commandTarget=['actorId','resourceId','action','key'],f=await draft();
 for(const error of [new Error('unknown database failure'),{code:'P2002',meta:{target:['dimensionHash']}},{code:'P2002',meta:{target:[...commandTarget,'extra']}},{code:'P2002',meta:{modelName:'OtherModel',target:commandTarget}},{code:'P2002',meta:{target:'ArchiveCommand_actorId_resourceId_action_key_key'}},{code:'P2010',meta:{target:commandTarget}}]){
  let attempts=0;const controller=new ResidualCurvesController({serial:async()=>{attempts++;throw error;}} as any);await assert.rejects(controller.create(f.input,{admin:curveOperator}),(caught)=>caught===error);assert.equal(attempts,1);
 }
 const race={code:'P2002',meta:{target:commandTarget}};let attempts=0;const controller=new ResidualCurvesController({serial:async()=>{attempts++;throw race;}} as any);
 await assert.rejects(controller.create(f.input,{admin:curveOperator}),(error)=>error===race);assert.equal(attempts,2);
 attempts=0;await assert.rejects(controller.preview(f.request,{admin:curveFinance}),(error)=>error===race);assert.equal(attempts,1);
});
