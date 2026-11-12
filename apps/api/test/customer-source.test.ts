import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CustomerSourceService,customerSourceInput} from '../src/customers/source';
import {customerProfileHash} from '../src/customers/qualifications';
import {AdminController} from '../src/operations/admin';

const actor={id:'operator',role:'OPERATIONS',authVersion:2},denied=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
function fixture(){
 const customer:any={id:'customer',name:'合成客户',mobile:'synthetic-mobile',drivingYears:5,profile:{revision:4},legalIdentityFileId:null,sourceChannel:null,sourceRevision:0};
 const staff={...actor,active:true},commands:any[]=[],audits:any[]=[],locks:string[]=[];
 const tx:any={adminUser:{findUnique:async()=>staff},customer:{findUnique:async()=>({...customer}),updateMany:async({where,data}:any)=>{if(where.id!==customer.id||where.sourceRevision!==customer.sourceRevision)return{count:0};customer.sourceChannel=data.sourceChannel;customer.sourceRevision+=data.sourceRevision.increment;return{count:1};}},
  $queryRaw:async(strings:TemplateStringsArray)=>{locks.push(strings.join('?'));return[];},$executeRaw:async()=>0,auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},
  archiveCommand:{findUnique:async({where}:any)=>commands.find(c=>c.key===where.actorId_resourceId_action_key.key)??null,create:async({data}:any)=>{commands.push(data);return data;}}};
 return{tx,customer,staff,commands,audits,locks};
}
const input={sourceChannel:'老客户介绍',sourceRevision:0,reason:'依据客户提供的渠道说明补录',idempotencyKey:'source-edit-key'};
test('source accepts explicit text or null and rejects invented fields, NUL and incomplete commands',()=>{
 assert.equal(customerSourceInput.parse({...input,sourceChannel:'  老客户介绍  '}).sourceChannel,'老客户介绍');assert.equal(customerSourceInput.parse({...input,sourceChannel:null}).sourceChannel,null);
 for(const changed of [{sourceChannel:''},{sourceChannel:' '.repeat(4)},{sourceChannel:'字'.repeat(65)},{sourceChannel:'bad\0text'},{sourceRevision:-1},{sourceRevision:0.2},{reason:''},{reason:'bad\0reason'},{idempotencyKey:'bad\0long-key'},{sourceChannel:undefined},{profile:{revision:4}}])assert.equal(customerSourceInput.safeParse({...input,...changed}).success,false);
});
test('source command preserves customer qualification identity, uses its own version and exact replay without duplicate audit',async()=>{
 const f=fixture(),service=new CustomerSourceService(),before=customerProfileHash(f.customer);
 assert.deepEqual(await service.read(f.tx,actor,'customer'),{customerId:'customer',sourceChannel:null,sourceRevision:0});
 const result=await service.save(f.tx,actor,'customer',input);assert.deepEqual(result,{customerId:'customer',sourceChannel:'老客户介绍',sourceRevision:1});assert.equal(customerProfileHash(f.customer),before);assert.equal(f.customer.profile.revision,4);assert.match(f.locks[0],/"Customer"/);
 assert.deepEqual(await service.save(f.tx,actor,'customer',input),result);assert.equal(f.audits.length,1);assert.equal(f.commands.length,1);assert.equal(f.customer.sourceRevision,1);assert.equal(f.audits[0].data.before.sourceChannel,null);assert.equal(f.audits[0].data.after.sourceChannel,'老客户介绍');
 await assert.rejects(service.save(f.tx,actor,'customer',{...input,sourceChannel:'其他'}),denied('IDEMPOTENCY_CONFLICT'));await assert.rejects(service.save(f.tx,actor,'customer',{...input,idempotencyKey:'stale-edit-key'}),denied('REVISION_CONFLICT'));
 const cleared=await service.save(f.tx,actor,'customer',{...input,sourceRevision:1,sourceChannel:null,idempotencyKey:'clear-source-key'});assert.equal(cleared.sourceChannel,null);assert.equal(cleared.sourceRevision,2);assert.equal(customerProfileHash(f.customer),before);
});
test('finance/support/FIELD cannot read source and old successful keys do not bypass current session or role',async()=>{
 const f=fixture(),service=new CustomerSourceService();await service.save(f.tx,actor,'customer',input);
 for(const role of ['FINANCE','SUPPORT','FIELD']){f.staff.role=role;await assert.rejects(service.read(f.tx,{...actor,role},'customer'),denied('FORBIDDEN'));await assert.rejects(service.save(f.tx,{...actor,role},'customer',input),denied('FORBIDDEN'));}
 f.staff.role=actor.role;f.staff.authVersion++;await assert.rejects(service.save(f.tx,actor,'customer',input),denied('STAFF_SESSION_CHANGED'));await assert.rejects(service.read(f.tx,{id:actor.id,role:actor.role},'customer'),denied('STAFF_SESSION_CHANGED'));assert.equal(f.audits.length,1);
});

test('customer source filter applies equally to records and total and cannot become a private count oracle',async()=>{
 const f=fixture(),seen:any[]=[];f.tx.customer.findMany=async(input:any)=>{seen.push(input.where);return[{...f.customer}];};f.tx.customer.count=async(input:any)=>{seen.push(input.where);return 1;};
 const admin=new AdminController(f.tx),result=await admin.list('customers',{sourceChannel:'  老客户  ',keyword:'合成'},{admin:actor});
 assert.equal(result.total,1);assert.equal(seen.length,2);assert.deepEqual(seen[0],seen[1]);assert.deepEqual(seen[0].sourceChannel,{contains:'老客户',mode:'insensitive'});assert.equal(seen[0].OR.length,2);
 for(const role of ['FINANCE','SUPPORT','FIELD']){f.staff.role=role;seen.length=0;await assert.rejects(admin.list('customers',{sourceChannel:'老客户'},{admin:{...actor,role}}),denied('FORBIDDEN'));assert.equal(seen.length,0);}
 f.staff.role=actor.role;for(const sourceChannel of ['', ['老客户'], 'bad\0text', '字'.repeat(65)])await assert.rejects(admin.list('customers',{sourceChannel},{admin:actor}));
 f.staff.authVersion++;await assert.rejects(admin.list('customers',{sourceChannel:'老客户'},{admin:actor}),denied('STAFF_SESSION_CHANGED'));
});
