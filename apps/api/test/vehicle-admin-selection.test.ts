import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdminController} from '../src/operations/admin';
import {readAdminVehicles,vehicleAgeMonths} from '../src/vehicles/admin-query';

const actor={id:'ops',role:'OPERATIONS',authVersion:2};
const error=(status:number)=>(e:any)=>e.getStatus?.()===status||status===400&&e.name==='ZodError';
function matches(row:any,where:any):boolean{
 if(!where)return true;return Object.entries(where).every(([key,v]:[string,any])=>{
  if(key==='AND')return v.every((part:any)=>matches(row,part));if(key==='OR')return v.some((part:any)=>matches(row,part));if(key==='NOT')return !matches(row,v);
  const actual=row?.[key];if(v===null||typeof v!=='object')return actual===v;
  if('is'in v)return actual!=null&&matches(actual,v.is);
  if('contains'in v)return typeof actual==='string'&&actual.toLowerCase().includes(v.contains.toLowerCase());
  if('in'in v&&!v.in.includes(actual))return false;if('not'in v&&actual===v.not)return false;
  for(const op of ['gte','lte','gt','lt'])if(op in v){if(actual==null)return false;const a=actual instanceof Date?actual.getTime():actual,b=v[op] instanceof Date?v[op].getTime():v[op];if(op==='gte'&&a<b||op==='lte'&&a>b||op==='gt'&&a<=b||op==='lt'&&a>=b)return false;}
  return true;
 });
}
function fixture(){
 const rows=Array.from({length:125},(_,i)=>({id:`v${i+1}`,revision:i,title:`合成车辆${i+1}`,brand:i===124?'目标品牌':'普通品牌',model:'Model S',modelDefinitionId:'model',year:2023,city:'上海',mileageKm:i===124?90000:i,vin:`SYNTHETICVIN${String(i+1).padStart(5,'0')}`,plateNumber:`沪合成${i+1}`,status:'PUBLISHED',createdAt:new Date(2026,0,125-i),description:'原描述',reservedOrderId:'内部订单不得入选择器',modelDefinition:{id:'model',revision:7,brand:'目标品牌',name:'Model S',modelYear:2025},assetProfile:{vehicleId:`v${i+1}`,registeredOwnerName:i===124?'合成机动车登记人':'其他登记人',firstRegistrationDate:new Date('2023-10-31T00:00:00Z'),notes:'资产私密备注',batteryCapacityKwh:'75'}}));
 const staff={...actor,active:true},bindings:any[]=[],owners:any[]=[],agreements:any[]=[],versions:any[]=[],legacy:any[]=[],reads:any[]=[];
 const scalar=(row:any)=>{const{modelDefinition,assetProfile,ownerBinding,...rest}=row;return rest;};
 const project=(row:any,q:any)=>{if(!row)return null;if(q.select)return Object.fromEntries(Object.entries(q.select).filter(([,v])=>v).map(([k,v]:[string,any])=>[k,v===true?row[k]:row[k]==null?null:Object.fromEntries(Object.keys(v.select).map(f=>[f,row[k][f]]))]));return {...scalar(row),...(q.include?.modelDefinition?{modelDefinition:row.modelDefinition}:{}),...(q.include?.assetProfile?{assetProfile:row.assetProfile}:{})};};
 const read=(list:any[])=>({findUnique:async({where}:any)=>list.find(r=>Object.entries(where).every(([k,v])=>r[k]===v))??null,findMany:async({where}:any={})=>list.filter(r=>matches(r,where))});
 const tx:any={adminUser:{findUnique:async()=>staff},vehicle:{findMany:async(q:any)=>{reads.push({kind:'rows',query:q});return rows.filter(r=>matches(r,q.where)).slice(q.skip||0,q.take===undefined?undefined:(q.skip||0)+q.take).map(r=>project(r,q));},count:async(q:any)=>{reads.push({kind:'count',query:q});return rows.filter(r=>matches(r,q.where)).length;},findUnique:async(q:any)=>project(rows.find(r=>r.id===q.where.id),q)},vehicleOwner:read(owners),partnerAgreementVehicle:read(bindings),partnerAgreement:read(agreements),partnerAgreementVersion:read(versions),ownerVehicle:read(legacy),storedFile:{findMany:async()=>[{id:'file',name:'合成协议.pdf',purpose:'contract',sha256:'a'.repeat(64),size:1,mimeType:'application/pdf',adminId:'ops',customerId:null}]},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0}};tx.serial=async(fn:any)=>fn(tx);
 return{controller:new AdminController(tx),tx,rows,staff,bindings,owners,agreements,versions,legacy,reads};
}
test('product selector filters the full database before pagination and exposes only whitelisted ledger facts',async()=>{
 const f=fixture();const result:any=await f.controller.list('vehicles',{view:'product-selection',brand:'目标',model:'model',modelYear:'2025',registeredOwnerName:'机动车',mileageKmMin:'90000',mileageKmMax:'90000',vin:'00125',plateNumber:'125',page:'1',pageSize:'1'},{admin:actor});
 assert.equal(result.total,1);assert.equal(result.items[0].id,'v125');assert.equal(result.items[0].modelYear,2025);assert.equal(result.items[0].registrationYear,2023);assert.equal(result.items[0].registeredOwnerName,'合成机动车登记人');assert.equal(result.items[0].firstRegistrationDate,'2023-10-31');assert.match(result.ageAsOf,/^\d{4}-\d{2}-\d{2}$/);assert.equal(result.items[0].cooperationOwner,null);
 for(const key of ['reservedOrderId','assetProfile','notes','modelDefinition','description'])assert.equal(Object.hasOwn(result.items[0],key),false,key);
 const list=f.reads.find(r=>r.kind==='rows'),count=f.reads.find(r=>r.kind==='count');assert.deepEqual(list.query.where,count.query.where);assert.deepEqual(list.query.orderBy,[{createdAt:'desc'},{id:'desc'}]);
});
test('default operations list and detail share ledger facts but preserve vehicle fields, other roles gain no personal ledger fields',async()=>{
 const f=fixture();const list:any=await f.controller.list('vehicles',{pageSize:'1'},{admin:actor});const detail:any=await f.controller.detail('vehicles','v1',{admin:actor});assert.equal(list.items[0].registeredOwnerName,'其他登记人');assert.equal(detail.modelYear,2025);assert.equal(detail.description,'原描述');assert.equal(Object.hasOwn(detail,'assetProfile'),false);
 for(const role of ['FINANCE','SUPPORT']){f.staff.role=role;const user={...actor,role};const data:any=await f.controller.list('vehicles',{pageSize:'1'},{admin:user});assert.equal(Object.hasOwn(data.items[0],'registeredOwnerName'),false);assert.equal(Object.hasOwn(data.items[0],'cooperationOwner'),false);await assert.rejects(f.controller.list('vehicles',{view:'product-selection'},{admin:user}),error(403));await assert.rejects(f.controller.list('vehicles',{registeredOwnerName:'其他'},{admin:user}),error(403));}
});
test('selector validates ranges, bounded integer pagination, unknown columns and current session before any vehicle reads',async()=>{
 const f=fixture();for(const q of [{page:'0'},{page:'1.5'},{page:'10001'},{pageSize:'101'},{modelYear:'2025.5'},{modelYear:'0'},{ageMonthsMin:'5',ageMonthsMax:'4'},{mileageKmMin:'9',mileageKmMax:'1'},{registeredOwnerName:'a\u0000b'},{ownerName:'猜测字段'}])await assert.rejects(f.controller.list('vehicles',{view:'product-selection',...q},{admin:actor}),error(400));
 f.staff.authVersion=3;await assert.rejects(f.controller.list('vehicles',{view:'product-selection'},{admin:actor}),error(403));assert.equal(f.reads.length,0);
});
test('vehicle age uses real first registration date, ignores missing/future dates and matches filters with the same count',async()=>{
 const f=fixture(),today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());f.rows[0].assetProfile.firstRegistrationDate=new Date(today+'T00:00:00Z');f.rows[1].assetProfile.firstRegistrationDate=null as any;f.rows[2].assetProfile.firstRegistrationDate=new Date('2099-01-01T00:00:00Z');
 const result:any=await f.controller.list('vehicles',{view:'product-selection',ageMonthsMin:'0',ageMonthsMax:'0'},{admin:actor});assert.equal(result.total,1);assert.equal(result.items[0].id,'v1');assert.equal(result.items[0].ageMonths,0);
});
test('current simple cooperation is owner scoped and invalid simple source never falls back to historical owner',async()=>{
 const f=fixture();for(const n of [1,2]){f.owners.push({id:`p${n}`,name:`合成合作商${n}`,status:'DRAFT'});f.bindings.push({vehicleId:`v${n}`,ownerId:`p${n}`,agreementId:`a${n}`,agreementVersionId:`av${n}`});f.agreements.push({id:`a${n}`,ownerId:`p${n}`,status:'ACTIVE',currentVersionId:`av${n}`});f.versions.push({id:`av${n}`,ownerId:`p${n}`,agreementId:`a${n}`,status:'ACTIVE',vehicleIds:[`v${n}`],fileIds:['file'],partnerRateBps:5000});}
 const result:any=await f.controller.list('vehicles',{view:'product-selection',cooperationOwnerId:'p1'},{admin:actor});assert.equal(result.total,1);assert.equal(result.items[0].id,'v1');assert.deepEqual(result.items[0].cooperationOwner,{id:'p1',name:'合成合作商1',source:'SIMPLE_AGREEMENT'});
 f.agreements[0].status='STOPPED';f.legacy.push({id:'legacy',vehicleId:'v1',ownerId:'p2',status:'APPROVED',reviewedBy:'ops',reviewedAt:new Date(),owner:f.owners[1]});const detail:any=await f.controller.detail('vehicles','v1',{admin:actor});assert.equal(detail.cooperationOwner,null);const filtered:any=await f.controller.list('vehicles',{view:'product-selection',cooperationOwnerId:'p2'},{admin:actor});assert.deepEqual(filtered.items.map((x:any)=>x.id),['v2']);
});
test('whole-month age boundaries agree with filtering at month end and at the supported calendar floor',async()=>{
 assert.equal(vehicleAgeMonths('2024-01-31','2024-02-29'),0);assert.equal(vehicleAgeMonths('2024-01-29','2024-02-29'),1);assert.equal(vehicleAgeMonths('2024-02-29','2025-02-28'),11);assert.equal(vehicleAgeMonths('2024-02-29','2025-03-01'),12);
 const f=fixture();f.rows.splice(3);f.rows[0].assetProfile.firstRegistrationDate=new Date('2024-01-31T00:00:00Z');f.rows[1].assetProfile.firstRegistrationDate=new Date('2024-01-29T00:00:00Z');f.rows[2].assetProfile.firstRegistrationDate=new Date('0001-01-01T00:00:00Z');
 const zero:any=await readAdminVehicles(f.tx,actor,{view:'product-selection',ageMonthsMax:'0'},new Date('2024-02-28T16:00:00Z'));assert.equal(zero.ageAsOf,'2024-02-29');assert.deepEqual(zero.items.map((r:any)=>r.id),['v1']);
 const tooOld:any=await readAdminVehicles(f.tx,actor,{view:'product-selection',ageMonthsMin:'120000'},new Date('2024-02-28T16:00:00Z'));assert.equal(tooOld.total,0);
});
for(const field of ['modelDefinitionId','cooperationOwnerId'])for(const value of ['', '   '])test(`explicit ${field} ${value?'whitespace':'empty'} never falls back to an unscoped vehicle list`,async()=>{
 const f=fixture();await assert.rejects(f.controller.list('vehicles',{view:'product-selection',[field]:value},{admin:actor}),error(400));assert.equal(f.reads.length,0);
});
