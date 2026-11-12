import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {activeSwapFixture} from './v31-swap-fixture';
import {v31FixtureContent} from './v31-cooperation-fixture';
import {TerminationService} from '../src/orders/termination';
test('actual earlier three-party agreement preserves genuine agreement and stop times independently of later06 signatures',async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:new Date('2026-11-14T04:00:00Z')});const db=new Db(),saved={...process.env};try{
 const {f,sub}=await activeSwapFixture(db);await db.adminUser.update({where:{id:f.actor.id},data:{role:'ADMIN'}});f.actor.role='ADMIN';await db.legalDocument.create({data:{type:'ELECTRONIC_V31_EARLY_TERMINATION',version:Math.floor(Math.random()*1000000000)+1,title:'合成06',content:v31FixtureContent('06'),status:'PUBLISHED',confirmedBy:f.actor.id,confirmedAt:new Date()}});const e=await db.storedFile.create({data:{name:'真实早期三方合意合成凭据.pdf',storagePath:'synthetic',mimeType:'application/pdf',size:50,sha256:'b'.repeat(64),purpose:'evidence',adminId:f.actor.id}}),api=new TerminationService(db),source:any=await api.read(sub.order.id,f.actor);
 const earlierAgreement={stopAt:'2026-11-13T04:00:00Z',terms:'已真实一致同意在无可用车辆时结束本单并停租',intentions:[sub.customer.id,f.owner.id,f.platform.id].map((subjectId,i)=>({subjectId,personReference:i===0?sub.customer.id:i===1?'OWNER-AUTHORIZED-SYNTHETIC':f.actor.id,occurredAt:'2026-11-13T03:00:00Z',intention:'同意本单11月13日12时终止并停租',authorityScope:i===0?'客户本人':'本单企业有权解除人员',authorityFrom:'2026-11-01T00:00:00Z',authorityUntil:'2027-11-01T00:00:00Z',evidenceFileIds:[e.id]}))};
 const input={revision:source.orderRevision,sourceHash:source.sourceHash,idempotencyKey:randomUUID(),reasonKind:'OWNER_BREACH',reason:'供车无法继续实现使用收益',plannedReturnAt:'2026-11-14T05:00:00Z',returnPlace:'原交付地',evidenceFileIds:[e.id],earlierAgreement};
 const p:any=await api.propose(sub.order.id,input,f.actor),r:any=await api.review(p.id,{revision:p.revision,decision:'VERIFIED',note:'逐一核验原始三方合意、时间和企业权限凭据',idempotencyKey:randomUUID()},f.actor);assert.equal(r.effectiveAt,'2026-11-13T03:00:00.000Z');assert.equal(r.archivedAt,null);
 const c:any=await api.confirm(p.id,{revision:r.revision,proposalHash:p.proposalHash,accepted:true,idempotencyKey:randomUUID()},sub.customer.id);assert.equal(c.effectiveAt,r.effectiveAt);
 }finally{await db.$disconnect();ctx.mock.timers.reset();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
