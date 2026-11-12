import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/common/data';
import {qualificationSubmitInput} from '../src/customers/types';
import {QualificationService,customerProfileHash,qualificationView,requireCurrentQualification} from '../src/customers/qualifications';
import {qualificationExpiryDay,qualificationValidityCurrent,normalizeQualificationValidity} from '../src/customers/qualification-validity';

const now=new Date('2026-10-29T15:59:59.000Z');
// The former Zod object emitted command fields first; archive hashes use that parsed field order.
const validInput={revision:0,idempotencyKey:'submit-validity',profileHash:'a'.repeat(64),verificationSource:'MANUAL',identityFileIds:['identity'],drivingLicenseFileIds:['license'],identityExpiresAt:'2030-02-28T00:00:00.000Z',drivingLicenseExpiresAt:'2030-03-01T00:00:00.000Z'};
const code=(value:string)=>(error:any)=>error?.getResponse?.().error?.code===value;

test('date-only and legacy ISO values are accepted without normalizing request bytes or inserting absent flags',()=>{
 const legacy=qualificationSubmitInput.parse(validInput);assert.deepEqual(legacy,validInput);assert.equal(hash(legacy),hash(validInput));
 assert(!Object.hasOwn(legacy,'identityLongTerm'));assert(!Object.hasOwn(legacy,'drivingLicenseLongTerm'));
 const day=qualificationSubmitInput.parse({...validInput,identityExpiresAt:'2030-02-28',drivingLicenseExpiresAt:'2030-03-01'});
 assert.equal(day.identityExpiresAt,'2030-02-28');
});

test('identity and driving-license long-term choices are independent and stored without fake expiry dates',()=>{
 for(const identityLongTerm of [false,true])for(const drivingLicenseLongTerm of [false,true]){
  const input={...validInput,identityLongTerm,drivingLicenseLongTerm,identityExpiresAt:identityLongTerm?null:'2030-02-28',drivingLicenseExpiresAt:drivingLicenseLongTerm?null:'2030-03-01'};
  const parsed=qualificationSubmitInput.parse(input),normalized=normalizeQualificationValidity(parsed);
  assert.equal(normalized.identityLongTerm,identityLongTerm);assert.equal(normalized.drivingLicenseLongTerm,drivingLicenseLongTerm);
  assert.equal(normalized.identityExpiresAt?.toISOString()??null,identityLongTerm?null:'2030-02-27T16:00:00.000Z');
  assert.equal(normalized.drivingLicenseExpiresAt?.toISOString()??null,drivingLicenseLongTerm?null:'2030-02-28T16:00:00.000Z');
  assert.equal(qualificationValidityCurrent(normalized,now),true);
 }
 const absentDates={...validInput,identityLongTerm:true,drivingLicenseLongTerm:true};delete (absentDates as any).identityExpiresAt;delete (absentDates as any).drivingLicenseExpiresAt;
 assert.equal(qualificationSubmitInput.safeParse(absentDates).success,true);
 assert.equal(normalizeQualificationValidity(absentDates).identityExpiresAt,null);
});

test('illegal calendar dates, missing fixed expiry and contradictory long-term/date combinations are rejected',()=>{
 for(const date of ['2030-02-29','2026-02-30','2026-13-01','2026-00-01','2026-10-00','2026-10-32','2026-1-1','2026-02-30T00:00:00.000Z','2026-10-29T25:00:00Z','not-date',''])assert.equal(qualificationSubmitInput.safeParse({...validInput,identityExpiresAt:date}).success,false,date);
 assert.equal(qualificationSubmitInput.safeParse({...validInput,identityExpiresAt:'2028-02-29'}).success,true);
 for(const change of [{identityExpiresAt:null},{identityExpiresAt:undefined},{identityLongTerm:false,identityExpiresAt:null},{identityLongTerm:true},{identityLongTerm:'true',identityExpiresAt:null},{drivingLicenseLongTerm:true}])assert.equal(qualificationSubmitInput.safeParse({...validInput,...change}).success,false,JSON.stringify(change));
});

test('fixed validity includes the whole expiry day in Beijing and expires at the next Beijing midnight',()=>{
 const value={identityExpiresAt:new Date('2026-10-28T16:00:00Z'),drivingLicenseExpiresAt:new Date('2030-01-01T00:00:00Z')};
 assert.equal(qualificationValidityCurrent(value,new Date('2026-10-28T16:00:00Z')),true);
 assert.equal(qualificationValidityCurrent(value,now),true);
 assert.equal(qualificationValidityCurrent(value,new Date('2026-10-29T16:00:00Z')),false);
 assert.equal(qualificationValidityCurrent({...value,identityExpiresAt:new Date('2026-10-27T16:00:00Z')},now),false);
});

test('legacy ISO and stored Date use their Beijing date without rewriting the old instant',()=>{
 const old=new Date('2026-10-28T20:15:00Z'),before=old.getTime();
 assert.equal(qualificationExpiryDay(old),'2026-10-29');assert.equal(qualificationExpiryDay('2026-10-28T20:15:00Z'),'2026-10-29');
 assert.equal(qualificationExpiryDay('2026-10-29T23:30:00-02:00'),'2026-10-30');
 assert.equal(qualificationExpiryDay('2026-10-29'),'2026-10-29');
 assert.equal(qualificationValidityCurrent({identityExpiresAt:old,drivingLicenseExpiresAt:old},now),true);assert.equal(old.getTime(),before);
 const normalized=normalizeQualificationValidity({...validInput,identityExpiresAt:'2026-10-28T20:15:00Z'});
 assert.equal(normalized.identityExpiresAt?.toISOString(),'2026-10-28T16:00:00.000Z');
});

test('legacy missing flags mean fixed dates and corrupt stored combinations fail closed',()=>{
 assert.equal(qualificationValidityCurrent({identityExpiresAt:new Date('2030-01-01'),drivingLicenseExpiresAt:new Date('2030-01-01')},now),true);
 assert.equal(qualificationValidityCurrent({identityExpiresAt:null,drivingLicenseExpiresAt:new Date('2030-01-01')},now),false);
 assert.equal(qualificationValidityCurrent({identityLongTerm:true,identityExpiresAt:new Date('2030-01-01'),drivingLicenseLongTerm:true,drivingLicenseExpiresAt:null},now),false);
 assert.equal(qualificationValidityCurrent({identityLongTerm:true,identityExpiresAt:null,drivingLicenseLongTerm:true,drivingLicenseExpiresAt:null},now),true);
 const result=qualificationView({id:'q',identityExpiresAt:new Date('2030-01-01'),drivingLicenseExpiresAt:new Date('2030-01-01')});
 assert.equal(result.identityLongTerm,false);assert.equal(result.drivingLicenseLongTerm,false);
});

function fixture(){
 const customer:any={id:'customer',name:'合成客户',mobile:'13800000000',profile:{},drivingYears:5,legalIdentityFileId:null};
 const files:any[]=[{id:'identity',customerId:'customer',adminId:null,purpose:'identity',sha256:hash('identity'),mimeType:'image/jpeg'},{id:'license',customerId:'customer',adminId:'uploader',purpose:'identity',sha256:hash('license'),mimeType:'image/jpeg'}];
 const rows:any[]=[],commands:any[]=[];
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},$queryRaw:async()=>[],adminUser:{findUnique:async({where}:any)=>({id:where.id,role:'OPERATIONS',authVersion:0,active:true})},customer:{findUnique:async()=>customer},storedFile:{findMany:async({where}:any)=>files.filter(f=>where.id.in.includes(f.id))},customerQualificationVersion:{findFirst:async()=>rows.at(-1),create:async({data}:any)=>{const q={...data,id:'q'+(rows.length+1)};rows.push(q);return q;},update:async({where,data}:any)=>Object.assign(rows.find(r=>r.id===where.id),data)},archiveCommand:{findUnique:async({where}:any)=>commands.find(c=>Object.entries(where.actorId_resourceId_action_key).every(([key,value])=>c[key]===value)),create:async({data}:any)=>{commands.push(data);return data;}},auditLog:{create:async()=>({})}};
 tx.storedFile.count=async()=>0;tx.vehicleInspectionFile={count:async()=>0};tx.electronicFileQuarantine={count:async()=>0};
 const actor={id:'submitter',role:'OPERATIONS',authVersion:0};
 const input={...validInput,profileHash:customerProfileHash(customer),identityLongTerm:true,identityExpiresAt:null,drivingLicenseLongTerm:false,drivingLicenseExpiresAt:'2026-10-29'};
 return{customer,files,rows,commands,tx,actor,input};
}

test('submit and review use long-term/date semantics while retaining evidence and independent reviewer rules',async()=>{
 const f=fixture(),service=new QualificationService(()=>now);
 const q=await service.submit(f.tx,f.actor,'customer',f.input);
 assert.equal(f.rows[0].identityExpiresAt,null);assert.equal(f.rows[0].identityLongTerm,true);
 assert.equal(f.rows[0].drivingLicenseExpiresAt.toISOString(),'2026-10-28T16:00:00.000Z');
 const review={qualificationId:q.id,revision:1,decision:'APPROVED',reasonCodes:[],supplementaryInstructions:'',idempotencyKey:'review-validity'};
 for(const id of ['submitter','uploader'])await assert.rejects(service.review(f.tx,{...f.actor,id},'customer',review),code('QUALIFICATION_SELF_REVIEW'));
 await service.review(f.tx,{...f.actor,id:'reviewer'},'customer',review);
 assert.equal((await requireCurrentQualification(f.tx,'customer',q.id,now)).id,q.id);
 await assert.rejects(requireCurrentQualification(f.tx,'customer',q.id,new Date('2026-10-29T16:00:00Z')),code('CUSTOMER_QUALIFICATION_REQUIRED'));
 f.files[0].sha256=hash('changed');await assert.rejects(requireCurrentQualification(f.tx,'customer',q.id,now),code('CUSTOMER_QUALIFICATION_REQUIRED'));
});

test('legacy ISO command replay keeps its original input hash and never inserts an extra qualification',async()=>{
 const f=fixture(),service=new QualificationService(()=>now),input={...validInput,profileHash:customerProfileHash(f.customer)};
 const prior={id:'legacy-q',revision:1,status:'SUBMITTED'};
 f.commands.push({actorId:f.actor.id,resourceId:'customer-qualification:customer',action:'SUBMIT',key:input.idempotencyKey,requestHash:hash(input),resultSnapshot:prior});
 assert.deepEqual(await service.submit(f.tx,f.actor,'customer',input),prior);assert.equal(f.rows.length,0);
 await assert.rejects(service.submit(f.tx,f.actor,'customer',{...input,identityLongTerm:false}),code('IDEMPOTENCY_CONFLICT'));
});

test('past dates remain rejected in submit and approval, while long-term does not bypass missing evidence',async()=>{
 const f=fixture(),service=new QualificationService(()=>now);
 await assert.rejects(service.submit(f.tx,f.actor,'customer',{...f.input,drivingLicenseExpiresAt:'2026-10-28'}),code('QUALIFICATION_EXPIRED'));
 const q=await service.submit(f.tx,f.actor,'customer',f.input);
 await assert.rejects(new QualificationService(()=>new Date('2026-10-29T16:00:00Z')).review(f.tx,{...f.actor,id:'reviewer'},'customer',{qualificationId:q.id,revision:1,decision:'APPROVED',reasonCodes:[],supplementaryInstructions:'',idempotencyKey:'expired-review'}),code('QUALIFICATION_EXPIRED'));
 const other=fixture();other.files.pop();await assert.rejects(service.submit(other.tx,other.actor,'customer',{...other.input,drivingLicenseLongTerm:true,drivingLicenseExpiresAt:null}),code('QUALIFICATION_MATERIALS_REQUIRED'));
});


test('ADMIN can review own qualification upload and submission; approved version remains usable and audited',async()=>{
 const f=fixture(),service=new QualificationService(()=>now),admin={...f.actor,role:'ADMIN'};const audits:any[]=[];
 f.tx.adminUser.findUnique=async({where}:any)=>({id:where.id,role:'ADMIN',authVersion:0,active:true});
 f.tx.auditLog.create=async({data}:any)=>{audits.push(data);return data;};f.files[1].adminId=admin.id;
 const q=await service.submit(f.tx,admin,'customer',f.input),body={qualificationId:q.id,revision:1,decision:'APPROVED',reasonCodes:[],supplementaryInstructions:'',idempotencyKey:'admin-self-review'};
 const result=await service.review(f.tx,admin,'customer',body);assert.equal(result.reviewedBy,admin.id);
 assert.equal((await requireCurrentQualification(f.tx,'customer',q.id,now)).id,q.id);assert.ok(audits.some(a=>a.action==='QUALIFICATION_REVIEWED'));
 assert.deepEqual(await service.review(f.tx,admin,'customer',body),result);assert.equal(audits.filter(a=>a.action==='QUALIFICATION_REVIEWED').length,1);
 f.files[1].sha256=hash('changed');await assert.rejects(requireCurrentQualification(f.tx,'customer',q.id,now),code('CUSTOMER_QUALIFICATION_REQUIRED'));
});
test('unprivileged role cannot review qualifications even with a different actor ID',async()=>{
 const f=fixture(),service=new QualificationService(()=>now);const q=await service.submit(f.tx,f.actor,'customer',f.input);
 f.tx.adminUser.findUnique=async({where}:any)=>({id:where.id,role:'FIELD',authVersion:0,active:true});
 await assert.rejects(service.review(f.tx,{...f.actor,id:'field',role:'FIELD'},'customer',{qualificationId:q.id,revision:1,decision:'APPROVED',idempotencyKey:'field-review'}),code('FORBIDDEN'));
});
