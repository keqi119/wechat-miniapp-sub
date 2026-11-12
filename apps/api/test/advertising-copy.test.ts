import '../src/common/config';
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Db} from '../src/common/db';
import {createApp} from '../src/app';
import {tokenHash} from '../src/auth/auth.service';
import {hash} from '../src/common/data';

const defaults=JSON.parse(readFileSync(new URL('../src/advertising-copy/defaults.json',import.meta.url),'utf8'));
let db:Db,app:any,base:string,original:any;
const actors:any[]=[];
const origin=process.env.ADMIN_ORIGIN?.split(',')[0]||'http://localhost:3100';
async function actor(role:string){
 const user=await db.adminUser.create({data:{username:randomUUID(),name:'广告词合成测试',role,passwordHash:'synthetic-unused-password'}});
 const token=randomUUID(),csrf=randomUUID();
 await db.adminSession.create({data:{id:tokenHash(token),adminId:user.id,authVersion:user.authVersion,csrfToken:csrf,expiresAt:new Date(Date.now()+600000)}});
 const value={...user,token,csrf};actors.push(value);return value;
}
async function request(path='',method='GET',body?:any,user?:any,csrf=true){
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(user?{Cookie:`admin_session=${user.token}`,...(csrf?{'X-CSRF-Token':user.csrf}:{})}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,headers:response.headers,data:await response.json()};
}
const adminPath='/api/admin/advertising-copy',publicPath='/api/public/advertising-copy';
const save=(revision:number,items=structuredClone(defaults))=>({revision,items,idempotencyKey:randomUUID()});
before(async()=>{db=new Db();original=await db.advertisingCopySet.findUniqueOrThrow({where:{id:'discovery'}});app=await createApp({db});await app.listen(0,'127.0.0.1');base=await app.getUrl();});
after(async()=>{
 if(original)await db.advertisingCopySet.update({where:{id:'discovery'},data:original});
 const ids=actors.map(a=>a.id);
 await db.advertisingCopyPublication.deleteMany({where:{publishedBy:{in:ids}}});
 await db.productCommand.deleteMany({where:{actorId:{in:ids}}});await db.auditLog.deleteMany({where:{actorId:{in:ids}}});
 await db.adminSession.deleteMany({where:{adminId:{in:ids}}});await db.adminUser.deleteMany({where:{id:{in:ids}}});
 await app?.close();await db?.$disconnect();
});

test('advertising copy real HTTP publication, authorization, validation and transaction contracts',async t=>{
 const admin=await actor('ADMIN'),operations=await actor('OPERATIONS');
 await t.test('anonymous reads initialized immutable publication only',async()=>{
  const result=await request(publicPath);assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
  assert.deepEqual(Object.keys(result.data).sort(),['contentHash','items','publishedAt','version']);assert.equal(result.data.contentHash,hash(result.data.items));assert.equal(result.data.items.length,12);
  assert.deepEqual(result.data.items,defaults);assert.equal(result.data.version,1);
 });
 await t.test('independent read/write roles, anonymous denial and CSRF',async()=>{
  assert.equal((await request(adminPath)).status,401);
  for(const role of ['FINANCE','SUPPORT','FIELD']){const user=await actor(role);assert.equal((await request(adminPath,'GET',undefined,user)).status,403);assert.equal((await request(adminPath+'/draft','PATCH',save(original.revision),user)).status,403);assert.equal((await request(adminPath+'/publish','POST',{revision:original.revision,draftHash:original.draftHash,idempotencyKey:randomUUID()},user)).status,403);}
  assert.equal((await request(adminPath,'GET',undefined,operations)).status,200);
  assert.equal((await request(adminPath+'/draft','PATCH',save(original.revision),admin,false)).data.error.code,'CSRF_DENIED');
 });
 await t.test('all unknown fields, lengths, fixed positions and plain text rejected',async()=>{
  const bad:any[]=[];const changed=(edit:(x:any)=>void)=>{const items=structuredClone(defaults);edit(items);bad.push(save(original.revision,items));};
  bad.push({...save(original.revision),extra:true});changed(x=>x.pop());changed(x=>x.reverse());changed(x=>x[0].id='unknown');changed(x=>x[0].extra=true);changed(x=>x[0].title='');changed(x=>x[0].title='中'.repeat(10));changed(x=>x[0].lines[0]='中'.repeat(33));changed(x=>x[0].catalogDescription='中'.repeat(41));changed(x=>x[0].lines.push('多余'));changed(x=>x[0].title='a\nb');changed(x=>x[0].lines[0]='a\u0000b');changed(x=>x[0].title='<b>文字</b>');
  for(const char of ['\u0085','\u2028','\u2029','\t','\r'])changed(x=>x[0].title=`a${char}b`);
  for(const body of bad)assert.equal((await request(adminPath+'/draft','PATCH',body,admin)).status,400);
  assert.equal((await request(adminPath+'/publish','POST',{revision:original.revision,draftHash:original.draftHash,idempotencyKey:randomUUID(),extra:true},admin)).status,400);
 });
 await t.test('draft isolation, normalized Unicode hash, replay and stale draft checks',async()=>{
  const prior=(await request(publicPath)).data,items=structuredClone(defaults);items[0].title=' 😀😀😀😀😀😀😀😀😀 ';const input=save(original.revision,items);
  const [a,b]=await Promise.all([request(adminPath+'/draft','PATCH',input,operations),request(adminPath+'/draft','PATCH',input,operations)]);assert.equal(a.status,200);assert.deepEqual(a.data,b.data);
  const detail=(await request(adminPath,'GET',undefined,admin)).data;assert.equal(detail.draft.items[0].title,'😀'.repeat(9));assert.equal(detail.draft.contentHash,hash(detail.draft.items));assert.deepEqual((await request(publicPath)).data,prior);
  assert.equal((await request(adminPath+'/draft','PATCH',{...input,items:defaults},operations)).data.error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await request(adminPath+'/draft','PATCH',save(original.revision),admin)).data.error.code,'REVISION_CONFLICT');
  assert.equal((await request(adminPath+'/publish','POST',{revision:detail.revision,draftHash:'a'.repeat(64),idempotencyKey:randomUUID()},admin)).data.error.code,'DRAFT_CHANGED');
 });
 await t.test('concurrent different saves conflict without duplicate receipts or audits',async()=>{
  const detail=(await request(adminPath,'GET',undefined,admin)).data;
  const left=structuredClone(detail.draft.items),right=structuredClone(left);left[0].title='新的旅途';right[0].title='新的风景';
  const results=await Promise.all([request(adminPath+'/draft','PATCH',save(detail.revision,left),admin),request(adminPath+'/draft','PATCH',save(detail.revision,right),admin)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(results.find(r=>r.status===409)!.data.error.code,'REVISION_CONFLICT');
 });
 await t.test('publish atomically increments version, replay returns receipt, unchanged refused',async()=>{
  const detail=(await request(adminPath,'GET',undefined,admin)).data,input={revision:detail.revision,draftHash:detail.draft.contentHash,idempotencyKey:randomUUID()};
  const [a,b]=await Promise.all([request(adminPath+'/publish','POST',input,admin),request(adminPath+'/publish','POST',input,admin)]);assert.equal(a.status,201);assert.deepEqual(a.data,b.data);
  const publicCopy=(await request(publicPath)).data;assert.equal(publicCopy.version,2);assert.deepEqual(publicCopy.items,detail.draft.items);assert.equal(publicCopy.contentHash,input.draftHash);
  const now=(await request(adminPath,'GET',undefined,admin)).data;assert.equal(now.revision,detail.revision+1);assert.equal(now.history.length,2);
  assert.equal((await request(adminPath+'/publish','POST',{...input,revision:now.revision,idempotencyKey:randomUUID()},admin)).data.error.code,'ADVERTISING_COPY_UNCHANGED');
  assert.equal(await db.productCommand.count({where:{actorId:admin.id,resourceId:'advertising-copy:discovery',action:'PUBLISH'}}),1);
  assert.equal(await db.auditLog.count({where:{actorId:admin.id,resourceType:'advertising-copy',action:'PUBLISH'}}),1);
 });
 await t.test('different publish commands race once and save/publication race keeps one coherent winner',async()=>{
  let detail=(await request(adminPath,'GET',undefined,operations)).data;
  const items=structuredClone(detail.draft.items);items[0].title='一起去远方';
  assert.equal((await request(adminPath+'/draft','PATCH',save(detail.revision,items),operations)).status,200);
  detail=(await request(adminPath,'GET',undefined,operations)).data;
  const publish=()=>({revision:detail.revision,draftHash:detail.draft.contentHash,idempotencyKey:randomUUID()});
  let results=await Promise.all([request(adminPath+'/publish','POST',publish(),operations),request(adminPath+'/publish','POST',publish(),operations)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal(results.find(r=>r.status===409)!.data.error.code,'REVISION_CONFLICT');
  detail=(await request(adminPath,'GET',undefined,operations)).data;items[0].title='再出发';
  await request(adminPath+'/draft','PATCH',save(detail.revision,items),operations);detail=(await request(adminPath,'GET',undefined,operations)).data;
  const another=structuredClone(items);another[0].title='新的期待';
  results=await Promise.all([request(adminPath+'/draft','PATCH',save(detail.revision,another),operations),request(adminPath+'/publish','POST',publish(),operations)]);
  assert.equal(results.filter(r=>r.status===200||r.status===201).length,1);assert.equal(results.find(r=>r.status===409)!.data.error.code,'REVISION_CONFLICT');
  const now=(await request(adminPath,'GET',undefined,operations)).data,visible=(await request(publicPath)).data;
  assert.equal(now.published.version,visible.version);assert.equal(now.published.contentHash,visible.contentHash);
  assert.equal(now.revision,detail.revision+1);
  for(const user of [admin,operations])for(const action of ['SAVE_DRAFT','PUBLISH']){
   const receipts=await db.productCommand.count({where:{actorId:user.id,resourceId:'advertising-copy:discovery',action}});
   const audits=await db.auditLog.count({where:{actorId:user.id,resourceType:'advertising-copy',resourceId:'discovery',action}});assert.equal(audits,receipts);
  }
 });
 await t.test('read does not initialize missing set or expose corrupt publication',async()=>{
  const row=await db.advertisingCopySet.findUniqueOrThrow({where:{id:'discovery'}});
  await db.advertisingCopySet.update({where:{id:row.id},data:{draftHash:'0'.repeat(64)}});
  assert.equal((await request(adminPath,'GET',undefined,operations)).status,503);assert.equal((await request(publicPath)).status,200);
  await db.advertisingCopySet.update({where:{id:row.id},data:{draftHash:row.draftHash}});
  const publication=await db.advertisingCopyPublication.findUniqueOrThrow({where:{id:row.publishedVersionId}});
  await db.advertisingCopyPublication.update({where:{id:publication.id},data:{contentHash:'0'.repeat(64)}});
  try{assert.equal((await request(publicPath)).status,503);}finally{await db.advertisingCopyPublication.update({where:{id:publication.id},data:{contentHash:publication.contentHash}});}
  await db.advertisingCopySet.delete({where:{id:row.id}});
  try{assert.equal((await request(publicPath)).status,503);assert.equal((await request(adminPath,'GET',undefined,operations)).status,503);assert.equal(await db.advertisingCopySet.count({where:{id:'discovery'}}),0);}finally{await db.advertisingCopySet.create({data:row});}
 });
 await t.test('audit failure rolls draft/publication/pointer/revision/receipt back together',async()=>{
  const {AdvertisingCopyService}=await import('../src/advertising-copy/service');
  const broken=new AdvertisingCopyService({serial:(operation:any)=>db.serial(tx=>operation(new Proxy(tx,{get(target,property){if(property==='auditLog')return {create:async()=>{throw new Error('synthetic audit failure');}};return Reflect.get(target,property);}})))} as Db);
  const before=await db.advertisingCopySet.findUniqueOrThrow({where:{id:'discovery'}}),items=structuredClone(defaults);items[0].title='事务验证';
  const receipts=await db.productCommand.count({where:{actorId:operations.id}}),publications=await db.advertisingCopyPublication.count();
  await assert.rejects(broken.saveDraft(save(before.revision,items),operations),/synthetic audit failure/);
  assert.deepEqual(await db.advertisingCopySet.findUniqueOrThrow({where:{id:'discovery'}}),before);
  const service=new AdvertisingCopyService(db);await service.saveDraft(save(before.revision,items),operations);
  const saved=await db.advertisingCopySet.findUniqueOrThrow({where:{id:'discovery'}});
  await assert.rejects(broken.publish({revision:saved.revision,draftHash:saved.draftHash,idempotencyKey:randomUUID()},operations),/synthetic audit failure/);
  assert.deepEqual(await db.advertisingCopySet.findUniqueOrThrow({where:{id:'discovery'}}),saved);
  assert.equal(await db.advertisingCopyPublication.count(),publications);assert.equal(await db.productCommand.count({where:{actorId:operations.id}}),receipts+1);
 });
 await t.test('command receipt recovery is exact, actor/action/resource scoped and read only',async()=>{
  const absentKey=randomUUID(),endpoint=(action:string,key:string)=>`${adminPath}/commands/${encodeURIComponent(action)}/${encodeURIComponent(key)}`;
  const missing=await request(endpoint('SAVE_DRAFT',absentKey),'GET',undefined,operations);
  assert.equal(missing.status,200);assert.deepEqual(missing.data,{found:false});
  assert.equal(missing.headers.get('cache-control'),'private, no-store');
  assert.equal((await request(endpoint('SAVE_DRAFT',absentKey))).status,401);
  for(const role of ['FINANCE','SUPPORT','FIELD'])assert.equal((await request(endpoint('SAVE_DRAFT',absentKey),'GET',undefined,actors.find(a=>a.role===role))).status,403);
  for(const [action,key] of [['SAVE','valid-key'],['save_draft','valid-key'],['PUBLISH','short'],['SAVE_DRAFT','x'.repeat(129)]])assert.equal((await request(endpoint(action,key),'GET',undefined,operations)).status,400);
  const current=(await request(adminPath,'GET',undefined,operations)).data,items=structuredClone(defaults);items[0].title='  恢复核对  ';
  // Property order and surrounding spaces intentionally differ from parsed canonical input.
  const rawItems=items.map((item:any)=>({catalogDescription:item.catalogDescription,lines:item.lines,title:item.title,id:item.id}));
  const commandKey=`receipt / ? # 😀 ${randomUUID()}`,input={idempotencyKey:commandKey,items:rawItems,revision:current.revision};
  const saved=await request(adminPath+'/draft','PATCH',input,operations);assert.equal(saved.status,200);
  const canonicalItems=items.map((item:any)=>({id:item.id,title:item.title.trim(),lines:item.lines.map((line:string)=>line.trim()),catalogDescription:item.catalogDescription.trim()}));
  const saveHash=hash({revision:input.revision,items:canonicalItems,idempotencyKey:commandKey});
  const publishInput={revision:saved.data.revision,draftHash:saved.data.draftHash,idempotencyKey:commandKey};
  const published=await request(adminPath+'/publish','POST',publishInput,operations);assert.equal(published.status,201);
  const later=await request(adminPath+'/draft','PATCH',save(published.data.revision,canonicalItems),operations);assert.equal(later.status,200);
  const before=await db.advertisingCopySet.findUniqueOrThrow({where:{id:'discovery'}}),counts=await Promise.all([db.productCommand.count(),db.auditLog.count(),db.advertisingCopyPublication.count()]);
  for(let retry=0;retry<2;retry++){
   const result=await request(endpoint('SAVE_DRAFT',commandKey),'GET',undefined,operations,false);assert.equal(result.status,200);
   assert.deepEqual(result.data,{found:true,requestHash:saveHash,result:saved.data});
   assert.ok(result.data.result.revision<before.revision);
   assert.deepEqual((await request(endpoint('PUBLISH',commandKey),'GET',undefined,operations)).data,{found:true,requestHash:hash(publishInput),result:published.data});
   assert.deepEqual((await request(endpoint('SAVE_DRAFT',commandKey),'GET',undefined,admin)).data,{found:false});
   assert.deepEqual((await request(endpoint('SAVE_DRAFT',absentKey),'GET',undefined,operations)).data,{found:false});
  }
  assert.deepEqual(await db.advertisingCopySet.findUniqueOrThrow({where:{id:'discovery'}}),before);
  assert.deepEqual(await Promise.all([db.productCommand.count(),db.auditLog.count(),db.advertisingCopyPublication.count()]),counts);
  await db.productCommand.create({data:{actorId:operations.id,resourceId:'products',action:'SAVE_DRAFT',key:absentKey,requestHash:'a'.repeat(64),resultSnapshot:{private:true}}});
  assert.deepEqual((await request(endpoint('SAVE_DRAFT',absentKey),'GET',undefined,operations)).data,{found:false});
 });
 await t.test('receipt lookup rechecks current staff before receipt access',async()=>{
  const {AdvertisingCopyService}=await import('../src/advertising-copy/service');const service=new AdvertisingCopyService(db);
  for(const change of [{authVersion:{increment:1}},{role:'FINANCE'},{active:false}]){
   const captured=await actor('OPERATIONS'),input={action:'SAVE_DRAFT',key:randomUUID()};
   await db.productCommand.create({data:{actorId:captured.id,resourceId:'advertising-copy:discovery',action:input.action,key:input.key,requestHash:'a'.repeat(64),resultSnapshot:{private:true}}});
   await db.adminUser.update({where:{id:captured.id},data:change});
   await assert.rejects(service.commandReceipt(input,captured),(e:any)=>e.getResponse?.().error.code==='STAFF_SESSION_CHANGED');
   const response=await request(`${adminPath}/commands/${input.action}/${input.key}`,'GET',undefined,captured);assert.ok([401,403].includes(response.status));assert.equal(response.data.found,undefined);
  }
 });
 await t.test('captured staff authority is checked before receipt replay',async()=>{
  const {AdvertisingCopyService}=await import('../src/advertising-copy/service');const service=new AdvertisingCopyService(db);
  const current=await db.advertisingCopySet.findUniqueOrThrow({where:{id:'discovery'}}),input=save(current.revision,current.draftItems as any);
  await service.saveDraft(input,admin);await db.adminUser.update({where:{id:admin.id},data:{authVersion:{increment:1}}});
  await assert.rejects(service.saveDraft(input,admin),(e:any)=>e.getResponse?.().error.code==='STAFF_SESSION_CHANGED');
  assert.equal((await request(adminPath,'GET',undefined,admin)).status,401);
  await db.adminUser.update({where:{id:operations.id},data:{role:'FINANCE'}});
  await assert.rejects(service.detail(operations),(e:any)=>e.getResponse?.().error.code==='STAFF_SESSION_CHANGED');
  await assert.rejects(service.saveDraft(save(current.revision+1,current.draftItems as any),operations),(e:any)=>e.getResponse?.().error.code==='STAFF_SESSION_CHANGED');
  const finance=await db.adminUser.findUniqueOrThrow({where:{id:operations.id}});
  await assert.rejects(service.saveDraft(input,finance),(e:any)=>e.getResponse?.().error.code==='FORBIDDEN');
 });
});
