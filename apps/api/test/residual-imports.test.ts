import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ResidualImportsService} from '../src/residual-market/imports';
import {ResidualObservationsService} from '../src/residual-market/observations';
import {actor,finance,cmd,code,observation,fixture} from './residual-observations-fixture';
const service=new ResidualImportsService(),observations=new ResidualObservationsService();
const csv=(rows:string[],header='modelDefinitionId,modelRevision,observedOn,priceType,priceYuan,sourceNote,sourceListingId')=>({source:'CSV_IMPORT',fileName:'合成.csv',csvText:[header,...rows].join('\n')});
const row=(id:string,amount='12.345',model='model',rev='2')=>`${model},${rev},2026-10-30,TRANSACTION,${amount},明确依据,${id}`;

test('preview is read-only, accepts exact legacy/Chinese aliases and converts yuan by original rational rounding',async()=>{
 const f=fixture(),preview=await service.preview(f.tx,finance,csv([row('one')]));assert.equal(preview.rows[0].normalized.priceAmount,1235);assert.equal(preview.counts.imported,1);assert.equal(f.writes.length,0);assert.equal(preview.columnContract.version,1);
 const legacy=await service.preview(f.tx,actor,csv([row('one')],'modelDefinitionId,modelRevision,observedAt,priceType,priceAmount,remark,sourceListingId'));assert.equal(legacy.rows[0].normalized.priceAmount,1235);
 const chinese=await service.preview(f.tx,actor,csv([row('one')],'车型ID,车型版本,观察日期,价格类型,价格(元),来源说明,来源条目ID'));assert.equal(chinese.rows[0].normalized.modelDefinitionId,'model');
});

test('commit records good, in-file duplicates and bad rows once with batch replay and no swallowed infrastructure failures',async()=>{
 const f=fixture(),input=csv([row('one'),row('one'),row('bad','bad'),row('two','20')]),preview=await service.preview(f.tx,actor,input),command={...input,...cmd(),previewHash:preview.previewHash};
 const results=await Promise.all([f.serial(tx=>service.commit(tx,actor,command)),f.serial(tx=>service.commit(tx,actor,command))]);assert.deepEqual(results[0],results[1]);const batch=results[0];assert.equal(batch.status,'PARTIAL_FAILED');assert.equal(batch.importedCount,2);assert.equal(batch.duplicateCount,1);assert.equal(batch.failedCount,1);assert.equal(batch.rowResults.length,4);assert.equal(f.rows('marketPriceObservation').length,2);assert.equal(f.rows('marketPriceImportBatch').length,1);assert.equal(batch.rowResults[1].duplicateId,batch.rowResults[0].observationId);
 const before=f.writes.length;assert.equal((await service.list(f.tx,finance,{})).total,1);assert.equal((await service.detail(f.tx,finance,batch.id)).rowResults.length,4);assert.equal(f.writes.length,before);
 const broken=fixture(),p=await service.preview(broken.tx,actor,csv([row('one')]));broken.tx.marketPriceObservation.createMany=async()=>{throw Object.assign(new Error('synthetic constraint outage'),{code:'P2002',meta:{target:['unrelatedField']}});};await assert.rejects(broken.serial(tx=>service.commit(tx,actor,{...csv([row('one')]),...cmd(),previewHash:p.previewHash})),/synthetic constraint outage/);assert.equal(broken.writes.length,0);assert.equal(broken.rows('marketPriceImportBatch').length,0);
});

test('preview hashes bind current model and duplicate state, including ignored samples and changed invalid rows',async()=>{
 const f=fixture(),input=csv([row('one')]),preview=await service.preview(f.tx,actor,input);await f.serial(tx=>observations.create(tx,actor,{...cmd(),...observation({source:'CSV_IMPORT',sourceListingId:'one'})}));await assert.rejects(f.serial(tx=>service.commit(tx,actor,{...input,...cmd(),previewHash:preview.previewHash})),code('PREVIEW_CHANGED'));
 const g=fixture(),p=await service.preview(g.tx,actor,input);g.rows('modelDefinition')[0].revision=3;await assert.rejects(g.serial(tx=>service.commit(tx,actor,{...input,...cmd(),previewHash:p.previewHash})),code('PREVIEW_CHANGED'));
 const h=fixture(),missing=csv([row('one','1','missing')]),old=await service.preview(h.tx,actor,missing);assert.equal(old.counts.failed,1);h.seed('modelDefinition',{id:'missing',revision:2,brand:'真实',name:'明确',modelYear:null});await assert.rejects(h.serial(tx=>service.commit(tx,actor,{...missing,...cmd(),previewHash:old.previewHash})),code('PREVIEW_CHANGED'));
});

test('CSV headers reject unknown/ambiguous/absent columns, empty required cells and unsupported boolean forms',async()=>{
 const f=fixture();for(const header of ['modelDefinitionId,observedOn,priceType,priceYuan,sourceNote','modelDefinitionId,modelRevision,observedOn,observedAt,priceType,priceYuan,sourceNote','modelDefinitionId,modelRevision,observedOn,priceType,priceYuan,priceAmount,sourceNote','modelDefinitionId,modelRevision,observedOn,priceType,priceYuan,sourceNote,brand'])await assert.rejects(service.preview(f.tx,actor,csv(['x'],header)),code('CSV_COLUMNS'));
 const empty=await service.preview(f.tx,actor,csv(['model,2,2026-10-30,TRANSACTION,1,,one']));assert.equal(empty.rows[0].action,'FAILED');
 const bool=await service.preview(f.tx,actor,csv(['model,2,2026-10-30,TRANSACTION,1,依据,yes'],'modelDefinitionId,modelRevision,observedOn,priceType,priceYuan,sourceNote,accidentFlag'));assert.equal(bool.rows[0].action,'FAILED');
 await assert.rejects(service.preview(f.tx,actor,csv(Array.from({length:1001},(_,i)=>row(String(i))))),code('CSV_ROW_LIMIT'));
 await assert.rejects(service.preview(f.tx,actor,{...csv([]),csvText:'x'.repeat(2*1024*1024+1)}),code('CSV_SIZE_LIMIT'));assert.equal(f.writes.length,0);
});

test('finance preview/history is read-only, current revoked actor cannot replay and query errors never become CSV row failures',async()=>{
 const f=fixture(),input=csv([row('one')]),p=await service.preview(f.tx,finance,input);await assert.rejects(f.serial(tx=>service.commit(tx,finance,{...input,...cmd(),previewHash:p.previewHash})),code('FORBIDDEN'));
 const command={...input,...cmd(),previewHash:p.previewHash};await f.serial(tx=>service.commit(tx,actor,command));f.rows('adminUser')[0].authVersion=2;await assert.rejects(f.serial(tx=>service.commit(tx,actor,command)),code('STAFF_SESSION_CHANGED'));
 const broken=fixture();broken.tx.modelDefinition.findMany=async()=>{throw new Error('synthetic database unavailable');};await assert.rejects(service.preview(broken.tx,actor,input),/synthetic database unavailable/);assert.equal(broken.writes.length,0);
});

test('NUL model IDs fail only their CSV row and never reach a database text parameter',async()=>{
 const f=fixture(),find=f.tx.modelDefinition.findMany;f.tx.modelDefinition.findMany=async(args:any)=>{assert(args.where.id.in.every((id:string)=>!id.includes('\u0000')),'NUL must be rejected before ORM query');return find(args);};
 const input=csv([row('good'),row('bad','1','model\u0000')]),preview=await service.preview(f.tx,actor,input);assert.equal(preview.counts.imported,1);assert.equal(preview.counts.failed,1);assert.equal(preview.rows[1].errorCode,'VALIDATION');
 const result=await f.serial(tx=>service.commit(tx,actor,{...input,...cmd(),previewHash:preview.previewHash}));assert.equal(result.status,'PARTIAL_FAILED');assert.equal(f.rows('marketPriceObservation').length,1);
});

test('NUL notes fail only their row while quoted normal newlines remain valid PostgreSQL text',async()=>{
 const f=fixture(),input=csv(['model,2,2026-10-30,TRANSACTION,1,"明确\n多行依据",good','model,2,2026-10-30,TRANSACTION,1,无效\u0000说明,bad']),preview=await service.preview(f.tx,actor,input);assert.equal(preview.counts.imported,1);assert.equal(preview.counts.failed,1);assert.equal(preview.rows[0].normalized.sourceNote,'明确\n多行依据');
 const result=await f.serial(tx=>service.commit(tx,actor,{...input,...cmd(),previewHash:preview.previewHash}));assert.equal(result.status,'PARTIAL_FAILED');assert.equal(f.rows('marketPriceObservation').length,1);
});
