import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {SimpleAgreementService,readSimpleAgreementSnapshot} from '../src/partners/simple-agreements';

function fixture(){
 const actor={id:'ops',role:'OPERATIONS',authVersion:1},owners:any[]=[{id:'p',name:'合成甲',status:'DRAFT'},{id:'q',name:'合成乙',status:'DRAFT'}];
 const vehicles:any[]=['active','pending','other','old','stopped'].map(id=>({id,plateNumber:'合成'+id,vin:'SYNTHETIC-'+id,model:'合成车型',title:id,status:'DRAFT',purchaseAmount:123456}));
 const agreements:any[]=[],versions:any[]=[],bindings:any[]=[];
 const add=(id:string,ownerId:string,status:string,ids:string[],version=1)=>{const v={id:id+'-'+version,agreementId:id,ownerId,status,version,title:id,fileIds:status==='ACTIVE'?['f']:[],vehicleIds:ids,partnerRateBps:status==='ACTIVE'?5000:null,contentHash:'a'.repeat(64)};versions.push(v);const a=agreements.find(a=>a.id===id);if(a){a.currentVersionId=v.id;a.status=status;}else agreements.push({id,ownerId,status,currentVersionId:v.id});return v;};
 add('draft','p','DRAFT',['old']);add('draft','p','DRAFT',['pending','active'],2);add('duplicate','p','DRAFT',['pending']);add('foreign','q','DRAFT',['other']);add('stop','p','DRAFT',['stopped']);agreements.find(a=>a.id==='stop').status='STOPPED';
 const active=add('live','p','ACTIVE',['active']);bindings.push({vehicleId:'active',ownerId:'p',agreementId:'live',agreementVersionId:active.id});
 const match=(row:any,where:any={})=>Object.entries(where).every(([key,v]:any)=>v&&typeof v==='object'&&Array.isArray(v.in)?v.in.includes(row[key]):row[key]===v);
 const select=(row:any,fields:any)=>row&&fields?Object.fromEntries(Object.keys(fields).filter(k=>fields[k]===true).map(k=>[k,row[k]])):row;
 const model=(list:any[])=>({findMany:async(q:any={})=>{let rows=list.filter(r=>match(r,q.where));if(q.orderBy?.version==='desc')rows=rows.sort((a,b)=>b.version-a.version);if(q.take)rows=rows.slice(0,q.take);return rows.map(r=>select(r,q.select));},findUnique:async(q:any)=>select(list.find(r=>match(r,q.where))||null,q.select),count:async(q:any={})=>list.filter(r=>match(r,q.where)).length});
 const tx:any={adminUser:{findUnique:async()=>({...actor,active:true})},vehicleOwner:model(owners),vehicle:model(vehicles),partnerAgreement:model(agreements),partnerAgreementVersion:model(versions),partnerAgreementVehicle:model(bindings),ownerVehicle:{findMany:async()=>[]},storedFile:{findMany:async(q:any)=>q.where.id.in.includes('f')?[{id:'f',adminId:'ops',purpose:'contract',mimeType:'application/pdf',sha256:'b'.repeat(64)}]:[]},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0}};
 return{actor,owners,vehicles,agreements,versions,bindings,add,tx,service:new SimpleAgreementService()};
}
test('pending relation list and detail use only own latest draft, deduplicate and exclude effective vehicles',async()=>{
 const f=fixture(),detail=await f.service.detail(f.tx,f.actor,'p'),list=await f.service.list(f.tx,f.actor);
 assert.equal(detail.vehicleCount,1);assert.equal(detail.pendingVehicleCount,1);
 assert.deepEqual(detail.pendingVehicles.map((r:any)=>r.vehicleId),['pending']);assert.equal(list.find((r:any)=>r.id==='p').pendingVehicleCount,1);assert.equal(list.find((r:any)=>r.id==='q').pendingVehicleCount,1);
 const pending=detail.pendingVehicles[0];assert.equal(pending.ownerId,'p');assert.equal(pending.active,false);assert.equal(pending.status,'DRAFT');assert.equal(pending.vehicle.id,'pending');assert.equal(pending.vehicle.purchaseAmount,undefined);assert.deepEqual(pending.agreements.map((a:any)=>a.id).sort(),['draft','duplicate']);
 assert.equal(await readSimpleAgreementSnapshot(f.tx,'pending'),null);
});
test('promotion removes pending projection and keeps exactly one effective vehicle without granting draft scope',async()=>{
 const f=fixture(),version=f.add('draft','p','ACTIVE',['pending'],3);f.bindings.push({vehicleId:'pending',ownerId:'p',agreementId:'draft',agreementVersionId:version.id});
 const detail=await f.service.detail(f.tx,f.actor,'p');assert.equal(detail.pendingVehicleCount,0);assert.deepEqual(detail.pendingVehicles,[]);assert.equal(detail.vehicleCount,2);assert.equal(detail.vehicles.filter((v:any)=>v.active&&v.vehicleId==='pending').length,1);
});
test('empty, suspended, historical and wrong-owner versions cannot create pending vehicles',async()=>{
 const f=fixture();f.versions.find(v=>v.id==='draft-2').ownerId='q';f.agreements.find(a=>a.id==='duplicate').status='STOPPED';
 // The latest same-owner version is historical; never fall back to it when a higher wrong-owner version exists.
 f.versions.find(v=>v.id==='draft-1').status='ACTIVE';
 assert.equal((await f.service.detail(f.tx,f.actor,'p')).pendingVehicleCount,0);
 f.owners[1].status='SUSPENDED';assert.equal((await f.service.detail(f.tx,f.actor,'q')).pendingVehicleCount,0);
 f.agreements.splice(0);f.versions.splice(0);f.bindings.splice(0);assert.deepEqual((await f.service.detail(f.tx,f.actor,'p')).pendingVehicles,[]);
});
test('draft vehicle read is restricted to current ADMIN or OPERATIONS with no writes',async()=>{
 const f=fixture();for(const role of ['FINANCE','SUPPORT','FIELD']){f.tx.adminUser.findUnique=async()=>({...f.actor,role,active:true});await assert.rejects(f.service.detail(f.tx,{...f.actor,role},'p'),(e:any)=>e.getStatus()===403);await assert.rejects(f.service.list(f.tx,{...f.actor,role}),(e:any)=>e.getStatus()===403);}
 f.tx.adminUser.findUnique=async()=>({...f.actor,active:true});await assert.rejects(f.service.detail(f.tx,{...f.actor,authVersion:2},'p'),(e:any)=>e.getStatus()===403);
});

test('database pending projections follow saved latest drafts and activation without creating effective draft bindings',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.port==='55432'&&url.pathname==='/chundian_test');
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL}),suffix=randomUUID(),service=new SimpleAgreementService();
 try{
  const staff=await db.adminUser.create({data:{username:'inventory-pending-'+suffix,name:'合成运营',role:'OPERATIONS',passwordHash:'synthetic-unused'}}),actor={id:staff.id,role:staff.role,authVersion:staff.authVersion};
  const owner=await db.serial(tx=>service.create(tx,actor,{profile:{name:'合成待补'+suffix},idempotencyKey:randomUUID()}));
  const vehicle=await db.vehicle.create({data:{title:'合成待补车辆',brand:'Synthetic',model:'Sample',year:2026,city:'合成城市',mileageKm:0}});
  const draft=await db.serial(tx=>service.save(tx,actor,owner.id,{revision:0,idempotencyKey:randomUUID(),status:'DRAFT',title:'资料待补',vehicleIds:[vehicle.id],fileIds:[],partnerRateBps:null}));
  assert.equal(await readSimpleAgreementSnapshot(db,vehicle.id),null);assert.equal(await db.partnerAgreementVehicle.count({where:{vehicleId:vehicle.id}}),0);
  const detail=await db.serial(tx=>service.detail(tx,actor,owner.id));assert.equal(detail.pendingVehicleCount,1);assert.equal(detail.pendingVehicles[0].vehicle.id,vehicle.id);assert.equal(detail.vehicleCount,0);assert.equal((await db.serial(tx=>service.list(tx,actor))).find((r:any)=>r.id===owner.id)!.pendingVehicleCount,1);
  const empty=await db.serial(tx=>service.save(tx,actor,owner.id,{agreementId:draft.id,revision:draft.revision,idempotencyKey:randomUUID(),status:'DRAFT',vehicleIds:[],fileIds:[],partnerRateBps:null}));assert.equal((await db.serial(tx=>service.detail(tx,actor,owner.id))).pendingVehicleCount,0);
  const file=await db.storedFile.create({data:{adminId:actor.id,name:'合成协议.pdf',purpose:'contract',mimeType:'application/pdf',size:1,sha256:'a'.repeat(64),storagePath:'synthetic-never-read'}});
  await db.serial(tx=>service.save(tx,actor,owner.id,{agreementId:empty.id,revision:empty.revision,idempotencyKey:randomUUID(),status:'ACTIVE',vehicleIds:[vehicle.id],fileIds:[file.id],partnerRateBps:5000}));
  const active=await db.serial(tx=>service.detail(tx,actor,owner.id));assert.equal(active.pendingVehicleCount,0);assert.equal(active.vehicleCount,1);assert.equal(active.vehicles.filter((v:any)=>v.active&&v.vehicleId===vehicle.id).length,1);
 }finally{await db.$disconnect();}
});
