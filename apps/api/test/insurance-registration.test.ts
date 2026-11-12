import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InsuranceService} from '../src/insurance/service';
import {evaluateCoverage} from '../src/insurance/coverage';
import {reminderCandidates,leaseRenewalCandidates} from '../src/insurance/reminders';
import {createHash} from 'node:crypto';
import {policySummaries} from '../src/orders/seven-module-views';
import {auditSevenModuleFacts} from '../src/operations/seven-module-migration';
import {InsuranceController} from '../src/insurance/controller';
import {Module} from '@nestjs/common';
import {APP_GUARD,NestFactory} from '@nestjs/core';
import {Db} from '../src/common/db';
import {Access} from '../src/auth/access';
import {Errors} from '../src/common/errors';
import {tokenHash} from '../src/auth/auth.service';
import cookieParser from 'cookie-parser';

const actor={id:'registration-operator',role:'OPERATIONS',authVersion:2};
const bytes=Buffer.from('%PDF-1.4 synthetic insurance registration');
const file=(value=bytes)=>({fieldname:'files',originalname:'保单.pdf',mimetype:'application/pdf',buffer:value,size:value.length}) as Express.Multer.File;
const body=(extra:any={})=>({revision:0,idempotencyKey:'register-single-save',versionId:null,versionRevision:0,vehicleIds:['v1','v2'],policyType:'COMMERCIAL',policyNumber:'P-001',insurer:'真实机构',insuredParty:'被保险人',startAt:'2026-01-01',endAt:'2030-12-31',fileIds:[],confirmed:true,...extra});
const error=(code:string)=>(e:any)=>e?.response?.error?.code===code;
function store(){
 const policies:any[]=[],versions:any[]=[],files:any[]=[],bindings:any[]=[],commands:any[]=[],audits:any[]=[],events:string[]=[];
 const vehicles=[{id:'v1',revision:1,vin:'VIN111',plateNumber:'沪A00001',title:'车型甲'},{id:'v2',revision:2,vin:'VIN222',plateNumber:'沪A00002',title:'车型乙'}];
 let current:any={...actor,active:true},breakAudit=false,denyCas=false;
 const policyView=(row:any)=>row?{...row,versions:versions.filter(v=>v.policyId===row.id).sort((a,b)=>b.version-a.version),files:bindings.filter(b=>b.policyId===row.id)}:null;
 const tx:any={
  adminUser:{findUnique:async()=>current,findMany:async()=>[{id:actor.id,name:'登记运营',username:'operator'}]},
  $executeRaw:async()=>{events.push('advisory-lock');return 0;},$queryRaw:async()=>{events.push('row-lock');return [];},
  vehicle:{findMany:async({where}:any={})=>where?.id?.in?vehicles.filter(v=>where.id.in.includes(v.id)):vehicles},
  insurancePolicy:{findUnique:async({where,include}:any)=>{const p=policies.find(p=>p.id===where.id);return include?policyView(p):p??null;},findUniqueOrThrow:async({where}:any)=>policies.find(p=>p.id===where.id),findFirst:async({where}:any)=>policies.find(p=>p.insurer===where.insurer&&p.policyNumber===where.policyNumber&&p.id!==where.id?.not)??null,
   count:async({where}:any={})=>policies.filter(p=>(!where?.insurer||where.insurer===p.insurer)&&(!where?.policyNumber||where.policyNumber===p.policyNumber)).length,
   create:async({data}:any)=>{events.push('policy-create');const p={id:'p'+(policies.length+1),revision:0,createdAt:new Date(),...data};policies.push(p);return p;},
   updateMany:async({where,data}:any)=>{events.push('policy-cas');const p=policies.find(p=>p.id===where.id&&p.revision===where.revision);if(!p||denyCas)return{count:0};const {revision,...rest}=data;Object.assign(p,rest);p.revision+=revision.increment;return{count:1};},
   findMany:async()=>policies.map(policyView)},
  insurancePolicyVersion:{findFirst:async({where}:any)=>versions.filter(v=>v.policyId===where.policyId).sort((a,b)=>b.version-a.version)[0]??null,findUnique:async({where}:any)=>versions.find(v=>v.id===where.id)??null,
   create:async({data}:any)=>{events.push('version-create');const v={id:'version'+(versions.length+1),revision:0,createdAt:new Date(),reviewedBy:null,reviewedAt:null,reviewChecks:null,...data};versions.push(v);return v;},findMany:async()=>versions},
  storedFile:{create:async({data}:any)=>{const f={id:'file'+(files.length+1),customerId:null,...data};files.push(f);return f;},findMany:async({where}:any)=>files.filter(f=>where.id.in.includes(f.id)),findUnique:async({where}:any)=>files.find(f=>f.id===where.id)??null},
  insurancePolicyFile:{create:async({data}:any)=>{bindings.push(data);return data;},findMany:async({where}:any)=>bindings.filter(b=>b.policyId===where.policyId&&(!where.fileId?.in||where.fileId.in.includes(b.fileId))),count:async({where}:any)=>bindings.filter(b=>b.policyId===where.policyId&&b.fileId===where.fileId).length},
  insuranceCommand:{findUnique:async({where}:any)=>{const k=where.actorId_resourceId_action_key;return commands.find(c=>c.actorId===k.actorId&&c.resourceId===k.resourceId&&c.action===k.action&&c.key===k.key)??null;},create:async({data}:any)=>{commands.push(data);return data;}},
  auditLog:{create:async({data}:any)=>{if(breakAudit)throw Error('synthetic audit failure');audits.push(data);return data;}},order:{findMany:async()=>[]},serviceRequest:{findMany:async()=>[]},
  serial:async(fn:any)=>{const saved=structuredClone({policies,versions,files,bindings,commands,audits});try{return await fn(tx);}catch(e){for(const [name,items] of Object.entries(saved)){const target:any={policies,versions,files,bindings,commands,audits}[name];target.splice(0,target.length,...items);}throw e;}}
 };
 return{tx,policies,versions,files,bindings,commands,audits,events,vehicles,setCurrent:(v:any)=>{current=v;},breakAudit:()=>{breakAudit=true;},denyCas:()=>{denyCas=true;}};
}
const save=(s:ReturnType<typeof store>,input=body(),uploads=[file()],id?:string)=>s.tx.serial((tx:any)=>(new InsuranceService() as any).register(tx,actor,input,uploads,id));

test('single save registers real files and vehicles without pretending independent review or policy clauses',async()=>{
 const s=store(),before=new Date(),view=await save(s);const v=s.versions[0];
 assert.equal(view.revision,1);assert.equal(view.currentVersionId,v.id);assert.equal(view.currentStatus,'ACTIVE');assert.equal(view.policyType,'COMMERCIAL');assert.equal(view.vehicles.length,2);
 assert.equal(v.status,'REGISTERED');assert.equal(v.registeredBy,actor.id);assert(v.registeredAt>=before);assert.equal(v.reviewedBy,null);assert.equal(v.reviewedAt,null);assert.equal(v.reviewChecks,null);assert.deepEqual(v.coverageItems,[]);assert.equal(v.terms,'');assert.equal(v.policyholder,'');
 assert.equal(v.registrationSnapshot.confirmed,true);assert.equal(v.registrationSnapshot.files[0].sha256,createHash('sha256').update(bytes).digest('hex'));assert.deepEqual(v.registrationSnapshot.vehicles.map((v:any)=>v.vin),['VIN111','VIN222']);assert.deepEqual(v.registrationSnapshot.files[0].vehicleIds,['v1','v2']);
 assert.equal(view.files[0].name,'保单.pdf');assert.equal('storagePath' in view.files[0],false);assert.equal(s.audits.length,1);assert(s.events.indexOf('row-lock')<s.events.indexOf('policy-cas'));
 const at=new Date(v.registeredAt.getTime()+1),result=evaluateCoverage({vehicleId:'v1',modelDefinitionId:null,productVersionId:'product',requirements:[],versions:[v]},at);assert.equal(result.ready,true);
 assert.equal(evaluateCoverage({vehicleId:'v1',modelDefinitionId:null,productVersionId:'product',requirements:[],versions:[v]},new Date(before.getTime()-1)).ready,false);
});

test('identity corrections create immutable history with reasons and retain original file bindings',async()=>{
 const s=store(),first=await save(s),original=structuredClone(s.versions[0]);
 const next=await save(s,body({revision:first.revision,versionId:original.id,versionRevision:0,idempotencyKey:'registration-correction',policyNumber:'P-002',insurer:'更正机构',fileIds:[s.files[0].id],reason:'根据原件更正保单号码'}),[],first.id);
 assert.equal(next.revision,2);assert.equal(next.versions.length,2);assert.deepEqual(s.versions[0],original);assert.equal(s.versions[1].policyNumberSnapshot,'P-002');assert.equal(s.versions[1].insurerSnapshot,'更正机构');assert.equal(s.versions[1].changeReason,'根据原件更正保单号码');assert.equal(s.versions[1].changeKind,'ENDORSEMENT');assert.equal(s.files.length,1);assert.equal(s.bindings.length,1);
 for(const patch of [{revision:0},{versionId:'wrong'},{versionRevision:1},{reason:''}])await assert.rejects(save(s,body({revision:2,versionId:s.versions[1].id,versionRevision:0,fileIds:[s.files[0].id],reason:'修改说明',idempotencyKey:'stale-'+JSON.stringify(patch),...patch}),[],first.id));
 assert.equal(s.versions.length,2);
});

test('idempotency replays committed response before revisions and hashes actual bytes',async()=>{
 const s=store(),first=await save(s);s.policies[0].revision=9;
 assert.deepEqual(JSON.parse(JSON.stringify(await save(s))),JSON.parse(JSON.stringify(first)));assert.equal(s.versions.length,1);assert.equal(s.files.length,1);assert.equal(s.policies[0].revision,9);
 await assert.rejects(save(s,body(),[file(Buffer.from('%PDF-1.4 changed actual bytes'))]),error('IDEMPOTENCY_CONFLICT'));
 await assert.rejects(save(s,body({insuredParty:'修改'})),error('IDEMPOTENCY_CONFLICT'));
 s.setCurrent({...actor,active:false});await assert.rejects(save(s),error('STAFF_SESSION_CHANGED'));
});

test('registration rejects malformed originals, missing or foreign attachment scope, absent vehicle and fake audit fields',async()=>{
 for(const uploads of [[],[file(Buffer.from('not pdf'))],Array.from({length:21},()=>file()),[file(Buffer.concat([bytes,Buffer.alloc(10*1024*1024)]))],Array.from({length:4},()=>file(Buffer.concat([bytes,Buffer.alloc(9*1024*1024)])))]){
  const s=store();await assert.rejects(save(s,body(),uploads));assert.equal(s.policies.length,0);assert.equal(s.versions.length,0);
 }
 for(const patch of [{confirmed:false},{reviewedBy:'fake'},{coverageItems:[{}]},{vehicleIds:['missing']},{fileIds:['foreign']}]){const s=store();await assert.rejects(save(s,body(patch)));assert.equal(s.versions.length,0);}
 for(const role of ['FINANCE','SUPPORT','FIELD']){const s=store();s.setCurrent({...actor,role,active:true});await assert.rejects(save(s),error('STAFF_SESSION_CHANGED'));assert.equal(s.versions.length,0);}
 const audit=store();audit.breakAudit();await assert.rejects(save(audit),/synthetic audit failure/);assert.equal(audit.policies.length,0);assert.equal(audit.files.length,0);assert.equal(audit.commands.length,0);
 const cas=store();cas.denyCas();await assert.rejects(save(cas),error('REVISION_CONFLICT'));assert.equal(cas.versions.length,0);
});

test('retained and new originals together respect the 32MiB registration limit',async()=>{
 const s=store(),large=file(Buffer.concat([bytes,Buffer.alloc(9*1024*1024)])),first=await save(s,body(),[large,large,large]);
 await assert.rejects(save(s,body({revision:1,versionId:s.versions[0].id,versionRevision:0,idempotencyKey:'total-retained-limit',fileIds:s.files.map(f=>f.id),reason:'保留原件并增加批单'}),[large],first.id),error('INSURANCE_FILE_INVALID'));
 assert.equal(s.files.length,3);assert.equal(s.versions.length,1);
});

test('registered coverage and renewal selection reject damaged latest evidence rather than revive older facts',async()=>{
 const s=store();await save(s);const v=s.versions[0],at=new Date(v.registeredAt.getTime()+1);const facts={vehicleId:'v1',modelDefinitionId:null,productVersionId:'p',requirements:[],versions:[v]};
 assert.equal(evaluateCoverage(facts,at).ready,true);
 assert.equal(leaseRenewalCandidates([v],'v1',new Date('2032-01-01'),at).length,1);
 const due=new Date(v.endAt.getTime()-86400000);assert.equal(reminderCandidates([v],due).length,4);
 for(const patch of [{registeredBy:null},{registrationSnapshot:null},{fileIds:[]},{coverageItems:[{code:'fake'}]},{requirementVersionIds:null},{registrationSnapshot:{...v.registrationSnapshot,confirmed:false}},{registrationSnapshot:{...v.registrationSnapshot,files:[{...v.registrationSnapshot.files[0],sha256:'wrong'}]}}]){
  const invalid={...v,id:'broken',version:2,...patch};assert.equal(evaluateCoverage({...facts,versions:[v,invalid]},at).ready,false);assert.equal(reminderCandidates([v,invalid],due).length,0);assert.equal(leaseRenewalCandidates([v,invalid],'v1',new Date('2032-01-01'),at).length,0);
 }
});

test('registered basic document presence never proves explicitly required coverage items or amounts',async()=>{
 const s=store();await save(s);const v=s.versions[0],at=new Date(v.registeredAt.getTime()+1);
 const result=evaluateCoverage({vehicleId:'v1',modelDefinitionId:null,productVersionId:'p',requirements:[{id:'specific',items:[{code:'THIRD_PARTY',minAmount:100000000}]}],versions:[v]},at);
 assert.equal(result.ready,false);assert(result.blockers.some(b=>b.code==='INSURANCE_REQUIREMENTS_UNVERIFIED'));
});

test('registration list projects every vehicle and performs current status/search/type filtering before pagination',async()=>{
 const s=store(),service=new InsuranceService();await save(s);
 for(const search of ['VIN222','沪A00002','车型乙','被保险人','P-001']){const page:any=await service.list(s.tx,actor,{search});assert.equal(page.total,1);assert.equal(page.items[0].vehicles.length,2);}
 assert.equal((await service.list(s.tx,actor,{search:'不存在'})).total,0);
 assert.equal((await service.list(s.tx,actor,{status:'ACTIVE'})).total,1);
 assert.equal((await service.list(s.tx,actor,{status:'EXPIRED'})).total,0);
 assert.equal((await service.list(s.tx,actor,{policyType:'COMMERCIAL'} as any)).total,1);
 assert.equal((await service.list(s.tx,actor,{policyType:'OTHER'} as any)).total,0);
});

test('legacy mutations cannot late-submit stale versions after registration takes over',async()=>{
 const s=store(),view=await save(s),service=new InsuranceService();const old:any={...s.versions[0],id:'old-draft',status:'DRAFT',version:0,revision:0};s.versions.push(old);
 await assert.rejects(service.submit(s.tx,actor,old.id,{revision:0,idempotencyKey:'legacy-late-submit'}),error('INSURANCE_REGISTRATION_REQUIRED'));
 assert.equal(old.status,'DRAFT');assert.equal(s.policies[0].revision,view.revision);
});

test('registered policies appear in external summaries and audit as actual basic document facts',async()=>{
 const s=store(),view=await save(s),v=s.versions[0],at=new Date(v.registeredAt.getTime()+1);
 const rows=policySummaries([{...s.policies[0],versions:[v]}],['v1'],at);assert.equal(rows.length,1);assert.equal(rows[0].status,'ACTIVE');assert.deepEqual(rows[0].coverage,[]);
 const facts:any={vehicles:[{...s.vehicles[0],modelDefinitionId:null}],plans:[],owners:[],verifications:[],identityBindings:[],archives:[],feedback:[],requirements:[],policies:[v],productVersions:[],counts:{products:0,legacyEsignOrders:0,offlineOrders:0,legacyEsignContracts:0}};
 assert.equal(auditSevenModuleFacts(facts,at).issues.some(i=>i.code==='INSURANCE_POLICY_MISSING'),false);
 const invalid={...v,registrationSnapshot:null};assert.equal(policySummaries([{...s.policies[0],versions:[invalid]}],['v1'],at).length,0);assert.equal(auditSevenModuleFacts({...facts,policies:[invalid]},at).issues.some(i=>i.code==='INSURANCE_POLICY_MISSING'),true);
});

test('a new registration corrects a previously future-approved legacy version immediately and permanently',async()=>{
 const s=store(),first=await save(s),old=s.versions[0];
 Object.assign(old,{status:'APPROVED',effectiveAt:new Date('2035-01-01'),registeredAt:null,registeredBy:null,registrationSnapshot:null});
 const view=await save(s,body({revision:first.revision,versionId:old.id,versionRevision:0,idempotencyKey:'future-legacy-correction',fileIds:[s.files[0].id],reason:'更正旧生效记录'}),[],first.id),v=s.versions[1];
 assert.equal(view.currentStatus,'ACTIVE');assert(v.effectiveAt<=new Date());
 const at=new Date('2036-01-01');v.endAt=new Date('2040-01-01');v.registrationSnapshot.policy.endAt=v.endAt.toISOString();
 const result=evaluateCoverage({vehicleId:'v1',modelDefinitionId:null,productVersionId:'p',requirements:[],versions:s.versions},at);assert.equal(result.ready,true);assert.deepEqual(result.policyVersionIds,[v.id]);
});

test('multipart registration routes enforce cookie/Origin/CSRF and expose only scoped inline originals',async()=>{
 const s=store(),session='synthetic-registration-session',origin='https://admin.registration.invalid',savedOrigin=process.env.ADMIN_ORIGIN;
 let who:any={...actor,active:true};s.tx.adminSession={findUnique:async({where}:any)=>where.id===tokenHash(session)?{id:where.id,admin:who,authVersion:2,csrfToken:'synthetic-registration-csrf',expiresAt:new Date(Date.now()+60000)}:null};
 @Module({controllers:[InsuranceController],providers:[{provide:Db,useValue:s.tx},InsuranceService,{provide:APP_GUARD,useClass:Access}]})class RegistrationHttpModule{}
 const failures:any[]=[],filter=new Errors();const app=await NestFactory.create(RegistrationHttpModule,{logger:false});app.setGlobalPrefix('api');app.use(cookieParser());app.useGlobalFilters({catch(e:any,host:any){failures.push(e);filter.catch(e,host);}});process.env.ADMIN_ORIGIN=origin;
 // The isolated test workspace is inside .runtime; Express otherwise hides all files below that dot-directory.
 app.use((_req:any,res:any,next:any)=>{const send=res.sendFile.bind(res);res.sendFile=(path:string)=>send(path,{dotfiles:'allow'});next();});
 try{
  await app.listen(0,'127.0.0.1');const base=await app.getUrl(),path=base+'/api/admin/insurance-policies/registrations';
  const form=(input:any=body(),extra=false)=>{const data=new FormData();data.set('input',JSON.stringify(input));data.append('files',new Blob([bytes],{type:'application/pdf'}),'保单.pdf');if(extra)data.set('unexpected','1');return data;};
  const headers={Cookie:'admin_session='+session,Origin:origin,'X-CSRF-Token':'synthetic-registration-csrf'};
  assert.equal((await fetch(path,{method:'POST',body:form()})).status,401);
  assert.equal((await fetch(path,{method:'POST',headers:{...headers,Origin:'https://wrong.invalid'},body:form()})).status,403);
  assert.equal((await fetch(path,{method:'POST',headers:{Cookie:headers.Cookie,Origin:origin},body:form()})).status,403);
  who={...actor,role:'SUPPORT',active:true};s.setCurrent(who);assert.equal((await fetch(path,{method:'POST',headers,body:form()})).status,403);
  who={...actor,active:true};s.setCurrent(who);assert.equal((await fetch(path,{method:'POST',headers,body:form(body(),true)})).status,400);
  const response=await fetch(path,{method:'POST',headers,body:form()}),result:any=await response.json();assert.equal(response.status,201,JSON.stringify(result));assert.equal(result.currentStatus,'ACTIVE');assert.equal(result.versions[0].status,'REGISTERED');
  const open=base+'/api/admin/insurance-policies/'+result.id+'/files/'+result.files[0].id+'/open';
  assert.equal((await fetch(open)).status,401);const opened=await fetch(open,{headers:{Cookie:headers.Cookie}});assert.equal(opened.status,200,String(failures.at(-1)));assert.match(opened.headers.get('content-disposition')||'',/^inline;/);assert.equal(opened.headers.get('cache-control'),'private, no-store');assert.equal(Buffer.from(await opened.arrayBuffer()).equals(bytes),true);
  assert.equal((await fetch(open.replace('/'+result.id+'/', '/other/'),{headers:{Cookie:headers.Cookie}})).status,404);
  const replay=await fetch(path,{method:'POST',headers,body:form()});assert.equal(replay.status,201);assert.equal(s.files.length,1);assert.equal(s.versions.length,1);
 }finally{await app.close();if(savedOrigin===undefined)delete process.env.ADMIN_ORIGIN;else process.env.ADMIN_ORIGIN=savedOrigin;}
});
