import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readAdminVehicle,readAdminVehicles} from '../src/vehicles/admin-query';

const actor={id:'registration-ops',role:'OPERATIONS',authVersion:3};
const now=new Date('2026-11-03T04:00:00Z');
function matches(row:any,where:any):boolean{
 return !where||Object.entries(where).every(([key,value]:[string,any])=>{
  if(value===null||typeof value!=='object')return row[key]===value;
  if('in'in value&&!value.in.includes(row[key]))return false;
  if('not'in value&&row[key]===value.not)return false;
  return true;
 });
}
function fixture(){
 const staff={...actor,active:true},owners:any[]=[],agreements:any[]=[],versions:any[]=[],legacy:any[]=[],reads:any[]=[];
 const vehicles=Array.from({length:3},(_,i)=>({id:`v${i+1}`,revision:4,title:`合成车辆${i+1}`,vin:`SYNTHETIC${i+1}`,plateNumber:`测试${i+1}`,status:'DRAFT',year:2025,modelDefinition:{modelYear:2024},assetProfile:{registeredOwnerName:'合成登记人',firstRegistrationDate:null}}));
 const project=(row:any,query:any)=>!row?null:query.select?Object.fromEntries(Object.keys(query.select).map(key=>[key,row[key]])):{...row};
 function repository(name:string,rows:any[]){return{
  findUnique:async(query:any)=>{reads.push({name,method:'findUnique',query});return project(rows.find(row=>matches(row,query.where)),query);},
  findMany:async(query:any={})=>{
   reads.push({name,method:'findMany',query});let found=rows.filter(row=>matches(row,query.where));
   const order=Array.isArray(query.orderBy)?query.orderBy:query.orderBy?[query.orderBy]:[];
   found.sort((a,b)=>{for(const item of order)for(const [key,direction] of Object.entries(item)){const cmp=a[key]===b[key]?0:a[key]<b[key]?-1:1;if(cmp)return direction==='desc'?-cmp:cmp;}return 0;});
   if(query.distinct){const seen=new Set<string>();const keys=Array.isArray(query.distinct)?query.distinct:[query.distinct];found=found.filter(row=>{const key=JSON.stringify(keys.map((k:string)=>row[k]));if(seen.has(key))return false;seen.add(key);return true;});}
   return found.slice(query.skip||0,query.take===undefined?undefined:(query.skip||0)+query.take).map(row=>project(row,query));
  },count:async(query:any={})=>rows.filter(row=>matches(row,query.where)).length,
 };}
 const tx:any={adminUser:{findUnique:async()=>staff},vehicle:repository('vehicle',vehicles),vehicleOwner:repository('owner',owners),partnerAgreement:repository('agreement',agreements),partnerAgreementVersion:repository('version',versions),partnerAgreementVehicle:repository('binding',[]),ownerVehicle:repository('legacy',legacy)};
 const owner=(id:string,status='DRAFT')=>{const row={id,name:`合成主体${id}`,status,cooperationMode:'LEGACY',privateBankAccount:'MUST_NOT_LEAK'};owners.push(row);return row;};
 const draft=(id:string,ownerId:string,vehicleIds:string[],version=1,status='DRAFT')=>{
  if(!agreements.some(row=>row.id===id))agreements.push({id,ownerId,status:'DRAFT',currentVersionId:`${id}-${version}`,revision:version});
  versions.push({id:`${id}-${version}`,agreementId:id,ownerId,version,status,vehicleIds,fileIds:[],partnerRateBps:null,notes:'PRIVATE_SOURCE_NOTES'});
 };
 const active=(vehicleId:string,ownerId:string)=>legacy.push({id:`legacy-${vehicleId}`,vehicleId,ownerId,status:'APPROVED',reviewedBy:'reviewer',reviewedAt:new Date('2026-10-01'),owner:owners.find(row=>row.id===ownerId)});
 return{tx,staff,vehicles,owners,agreements,versions,legacy,reads,owner,draft,active};
}
const pending=(...ids:string[])=>({status:'PENDING_AGREEMENT',owners:ids.map(id=>({id,name:`合成主体${id}`}))});
const conflict=(...ids:string[])=>({status:'CONFLICT',owners:ids.map(id=>({id,name:`合成主体${id}`}))});

test('a source draft displays a pending partner on vehicle list and detail without becoming effective cooperation',async()=>{
 const f=fixture();f.owner('p');f.draft('a','p',['v1']);
 const list:any=await readAdminVehicles(f.tx,actor,{pageSize:'3'},now),detail:any=await readAdminVehicle(f.tx,actor,'v1',now);
 assert.deepEqual(list.items.find((row:any)=>row.id==='v1').cooperationRegistration,pending('p'));assert.deepEqual(detail.cooperationRegistration,pending('p'));
 assert.equal(detail.cooperationOwner,null);assert.equal(list.items[1].cooperationRegistration,null);
 assert.equal(JSON.stringify(detail.cooperationRegistration).includes('PRIVATE'),false);
 assert.equal(JSON.stringify(detail.cooperationRegistration).includes('Account'),false);
});

test('latest version removal and latest non-draft do not revive historical draft vehicle links',async()=>{
 const f=fixture();f.owner('p');f.draft('removed','p',['v1']);f.draft('removed','p',[],2);
 f.draft('changed','p',['v2']);f.draft('changed','p',['v2'],2,'ACTIVE');
 f.draft('latest','p',[]);f.draft('latest','p',['v3'],2);
 const list:any=await readAdminVehicles(f.tx,actor,{pageSize:'3'},now);
 assert.deepEqual(Object.fromEntries(list.items.map((r:any)=>[r.id,r.cooperationRegistration])),{v1:null,v2:null,v3:pending('p')});
});

test('stopped or active agreements, suspended owners and mismatched version owners never create source associations',async()=>{
 const f=fixture();f.owner('p');f.owner('s','SUSPENDED');f.owner('q');
 f.draft('stopped','p',['v1']);f.agreements[0].status='STOPPED';
 f.draft('active','p',['v1']);f.agreements[1].status='ACTIVE';
 f.draft('suspended','s',['v2']);f.draft('mismatch','p',['v3']);f.versions[3].ownerId='q';
 const list:any=await readAdminVehicles(f.tx,actor,{pageSize:'3'},now);
 assert.deepEqual(list.items.map((r:any)=>r.cooperationRegistration),[null,null,null]);
});

test('duplicate drafts of one owner deduplicate while two distinct owners are a conflict in deterministic order',async()=>{
 const f=fixture();f.owner('b');f.owner('a');f.draft('b-one','b',['v1','v1','v2']);f.draft('b-two','b',['v1']);f.draft('a-one','a',['v2']);
 const list:any=await readAdminVehicles(f.tx,actor,{pageSize:'3'},now);
 assert.deepEqual(list.items.find((row:any)=>row.id==='v1').cooperationRegistration,pending('b'));assert.deepEqual(list.items.find((row:any)=>row.id==='v2').cooperationRegistration,conflict('a','b'));
});

test('same effective owner is excluded and a different source owner is a conflict without replacing effective cooperation',async()=>{
 const f=fixture();f.owner('effective');f.owner('source');f.active('v1','effective');f.active('v2','effective');
 f.draft('same','effective',['v1','v2']);f.draft('different','source',['v2']);
 const list:any=await readAdminVehicles(f.tx,actor,{pageSize:'3'},now);
 assert.equal(list.items.find((row:any)=>row.id==='v1').cooperationRegistration,null);
 assert.deepEqual(list.items.find((row:any)=>row.id==='v2').cooperationRegistration,conflict('source'));
 assert.deepEqual(list.items.find((row:any)=>row.id==='v2').cooperationOwner,{id:'effective',name:'合成主体effective',source:'LEGACY_OWNER_BINDING'});
});

test('source registration never broadens the effective cooperationOwnerId filter',async()=>{
 const f=fixture();f.owner('p');f.draft('draft','p',['v1']);
 const filtered:any=await readAdminVehicles(f.tx,actor,{cooperationOwnerId:'p'},now);
 assert.equal(filtered.total,0);assert.deepEqual(filtered.items,[]);
});

test('admin and operations receive the field but finance and support never load or receive source registration',async()=>{
 for(const role of ['ADMIN','OPERATIONS','FINANCE','SUPPORT']){
  const f=fixture();f.staff.role=role;f.owner('p');f.draft('draft','p',['v1']);const user={...actor,role};
  const list:any=await readAdminVehicles(f.tx,user,{},now),detail:any=await readAdminVehicle(f.tx,user,'v1',now);
  const allowed=['ADMIN','OPERATIONS'].includes(role);
  assert.equal(Object.hasOwn(list.items[0],'cooperationRegistration'),allowed);assert.equal(Object.hasOwn(detail,'cooperationRegistration'),allowed);
  if(allowed)assert.deepEqual(detail.cooperationRegistration,pending('p'));
  else assert.equal(f.reads.filter(row=>['agreement','version','owner'].includes(row.name)).length,0);
 }
});

test('one page loads draft versions in a bounded batch and only maps vehicles on that page',async()=>{
 const f=fixture();f.owner('p');f.draft('draft','p',['v1','v2','v3']);
 const list:any=await readAdminVehicles(f.tx,actor,{pageSize:'3'},now);
 assert.equal(list.items.filter((row:any)=>row.cooperationRegistration).length,3);
 for(const name of ['agreement','version','owner'])assert.equal(f.reads.filter(row=>row.name===name&&row.method==='findMany').length,1,`${name} should be fetched once for the page`);
 f.reads.splice(0);const page:any=await readAdminVehicles(f.tx,actor,{page:'2',pageSize:'1'},now);
 assert.deepEqual(page.items.map((row:any)=>[row.id,row.cooperationRegistration]),[['v2',pending('p')]]);
});

test('expired staff authorization fails before loading draft source facts',async()=>{
 const f=fixture();f.staff.authVersion=4;f.owner('p');f.draft('draft','p',['v1']);
 await assert.rejects(readAdminVehicles(f.tx,actor,{},now),(error:any)=>error.getStatus()===403);
 assert.equal(f.reads.length,0);
});
