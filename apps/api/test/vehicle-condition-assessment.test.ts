import test from 'node:test';
import assert from 'node:assert/strict';
import {ConditionAssessmentService} from '../src/vehicle-inspections/condition-assessment';
const actor={id:'condition-operator',role:'OPERATIONS',authVersion:1};
const code=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
function fixture(){
 const vehicle={id:'condition-vehicle',revision:3};let row:any=null,current:any={...actor,active:true};const commands:any[]=[],audits:any[]=[],locks:string[]=[];
 const tx:any={adminUser:{findUnique:async()=>current},vehicle:{findUnique:async()=>vehicle},
 vehicleConditionAssessment:{findUnique:async()=>row,create:async({data}:any)=>{row={...data};return row;},updateMany:async({where,data}:any)=>{if(row?.revision!==where.revision)return{count:0};row={...row,...data,revision:row.revision+1};return{count:1};}},
 archiveCommand:{findUnique:async({where}:any)=>commands.find(c=>Object.entries(where.actorId_resourceId_action_key).every(([k,v])=>c[k]===v))??null,create:async({data}:any)=>{commands.push(data);return data;}},
 auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},$queryRaw:async(s:TemplateStringsArray)=>{locks.push(s.join('?'));return[];},$executeRaw:async()=>0};
 return{tx,vehicle,commands,audits,locks,get row(){return row;},revoke:()=>{current={...current,active:false};}};
}
const input={revision:0,vehicleRevision:3,idempotencyKey:'condition-first-local',fireDamage:false,floodDamage:false,structuralDamage:true};
test('missing assessment is unknown; three explicit judgments save without detailed inspection fields',async()=>{
 const f=fixture(),service=new ConditionAssessmentService(()=>new Date('2026-11-04T02:00:00Z'));
 const before=await service.read(f.tx,actor,f.vehicle.id);assert.equal(before.registered,false);assert.equal(before.fireDamage,null);
 const saved=await service.save(f.tx,actor,f.vehicle.id,input);assert.equal(saved.revision,1);assert.equal(saved.structuralDamage,true);assert.equal(saved.fireDamage,false);assert.equal(saved.registered,true);assert.equal(f.vehicle.revision,3);assert.equal(f.audits[0].data.reason,'首次登记');assert.equal(f.locks.length,1);
 assert.deepEqual(await service.save(f.tx,actor,f.vehicle.id,input),saved);assert.equal(f.audits.length,1);
});
test('edit requires explanation, both revisions and unchanged-key replay; history preserves actual true and false',async()=>{
 const f=fixture(),service=new ConditionAssessmentService();await service.save(f.tx,actor,f.vehicle.id,input);
 await assert.rejects(service.save(f.tx,actor,f.vehicle.id,{...input,idempotencyKey:'condition-second',revision:1}),code('CONDITION_REASON_REQUIRED'));
 await assert.rejects(service.save(f.tx,actor,f.vehicle.id,{...input,idempotencyKey:'condition-second',revision:0,reason:'重新检查'}),code('REVISION_CONFLICT'));
 await assert.rejects(service.save(f.tx,actor,f.vehicle.id,{...input,idempotencyKey:'condition-second',revision:1,vehicleRevision:2,reason:'重新检查'}),code('REVISION_CONFLICT'));
 const saved=await service.save(f.tx,actor,f.vehicle.id,{...input,idempotencyKey:'condition-second',revision:1,structuralDamage:false,reason:'复查结构件无损伤'});assert.equal(saved.revision,2);assert.equal(f.audits[1].data.before.structuralDamage,true);assert.equal(f.audits[1].data.after.structuralDamage,false);
 await assert.rejects(service.save(f.tx,actor,f.vehicle.id,{...input,fireDamage:true}),code('IDEMPOTENCY_CONFLICT'));
});
test('unknown answers and revoked staff cannot write or replay',async()=>{
 const f=fixture(),service=new ConditionAssessmentService();for(const value of [undefined,null,'false'])await assert.rejects(service.save(f.tx,actor,f.vehicle.id,{...input,fireDamage:value}));
 await service.save(f.tx,actor,f.vehicle.id,input);f.revoke();await assert.rejects(service.save(f.tx,actor,f.vehicle.id,input),code('STAFF_SESSION_CHANGED'));assert.equal(f.audits.length,1);
});
