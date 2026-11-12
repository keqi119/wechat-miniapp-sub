import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {QualificationService,customerProfileHash} from '../src/customers/qualifications';
import {CustomerRiskController} from '../src/customers/controller';
import {qualificationSubmitInput} from '../src/customers/types';

const actor={id:'qualification-uploader',role:'ADMIN',authVersion:1};
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
function fixture(){
 const customer:any={id:'customer',name:'合成客户',mobile:'13800000000',drivingYears:3,legalIdentityFileId:null,profile:{revision:2,identityFrontFileId:'old-front',identityBackFileId:'old-back',drivingLicenseFileId:'old-license'}};
 const files:any[]=['front','back','license'].flatMap((slot,i)=>['old','new'].map(prefix=>({id:prefix+'-'+slot,customerId:customer.id,adminId:prefix==='new'?actor.id:null,purpose:'identity',mimeType:'image/jpeg',size:20,sha256:String(i+(prefix==='old'?1:4)).repeat(64)})));
 const qs:any[]=[],commands:any[]=[],audits:any[]=[];
 const tx:any={$queryRaw:async()=>[],adminUser:{findUnique:async()=>({...actor,active:true})},customer:{findUnique:async()=>customer,update:async({data}:any)=>Object.assign(customer,data)},storedFile:{findMany:async({where}:any)=>files.filter(f=>where.id.in.includes(f.id)),create:async({data}:any)=>{const file={id:randomUUID(),...data};files.push(file);return file;}},customerQualificationVersion:{findFirst:async()=>qs.at(-1),create:async({data}:any)=>{const q={id:'q'+(qs.length+1),...data};qs.push(q);return q;}},archiveCommand:{findUnique:async({where}:any)=>commands.find(c=>Object.entries(where.actorId_resourceId_action_key).every(([k,v])=>c[k]===v)),create:async({data}:any)=>{commands.push(data);return data;}},auditLog:{create:async({data}:any)=>{audits.push(data);return data;}}};
 tx.storedFile.count=async()=>0;for(const model of ['vehicleDocumentFile','assetPrivateFile','vehicleInspectionFile','vehicleInspectionReport','electronicFileQuarantine'])tx[model]={count:async()=>0};
 const input={revision:0,idempotencyKey:'new-qualification',profileHash:customerProfileHash(customer),verificationSource:'MANUAL',identityFileIds:['new-front','new-back'],drivingLicenseFileIds:['new-license'],identityLongTerm:true,drivingLicenseLongTerm:true,documents:{identityFrontFileId:'new-front',identityBackFileId:'new-back',drivingLicenseFileId:'new-license'}};
 return{tx,customer,files,qs,commands,audits,input};
}

test('new classified qualification uploads replace current documents and bind the new snapshot without altering old files',async()=>{
 const f=fixture(),old=JSON.stringify(f.files.filter(x=>x.id.startsWith('old-'))),service=new QualificationService();
 const q=await service.submit(f.tx,actor,'customer',f.input);
 assert.equal(q.status,'SUBMITTED');assert.equal(f.customer.profile.revision,3);assert.equal(f.customer.profile.identityFrontFileId,'new-front');assert.equal(q.profileHash,customerProfileHash(f.customer));assert.notEqual(q.profileHash,f.input.profileHash);assert.equal(f.qs[0].profileSnapshot.documents.identityFront.id,'new-front');assert.equal(JSON.stringify(f.files.filter(x=>x.id.startsWith('old-'))),old);
 assert.deepEqual(await service.submit(f.tx,actor,'customer',f.input),q);assert.equal(f.qs.length,1);assert.equal(f.customer.profile.revision,3);
});
test('document replacement rejects stale profile, cross customer, unbound generic files and asset evidence',async()=>{
 for(const scenario of ['stale','cross-customer','generic','asset']){const f=fixture();if(scenario==='stale')f.input.profileHash='f'.repeat(64);if(scenario==='cross-customer')f.files.find(x=>x.id==='new-front').customerId='other';if(scenario==='generic')f.files.find(x=>x.id==='new-front').customerId=null;if(scenario==='asset')f.tx.assetPrivateFile.count=async()=>1;
 await assert.rejects(new QualificationService().submit(f.tx,actor,'customer',f.input),code(scenario==='stale'?'REVISION_CONFLICT':scenario==='asset'?'ASSET_FILE_ROUTE_REQUIRED':'PROFILE_FILE_INVALID'));assert.equal(f.customer.profile.revision,2);assert.equal(f.qs.length,0);}
});
test('classified documents are explicit, unique and exactly match evidence arrays',()=>{
 const f=fixture();assert.equal(qualificationSubmitInput.safeParse(f.input).success,true);
 for(const documents of [{identityFrontFileId:'new-front'},{...f.input.documents,identityBackFileId:'new-front'},{...f.input.documents,drivingLicenseFileId:'old-license'}])assert.equal(qualificationSubmitInput.safeParse({...f.input,documents}).success,false);
 assert.equal(qualificationSubmitInput.safeParse({...f.input,identityFileIds:['new-front','new-back','old-front']}).success,false);
});
test('same customer same slot same content reuses existing reference without profile revision churn',async()=>{
 const f=fixture();for(const slot of ['front','back','license'])f.files.find(x=>x.id==='new-'+slot).sha256=f.files.find(x=>x.id==='old-'+slot).sha256;
 const q=await new QualificationService().submit(f.tx,actor,'customer',f.input);assert.equal(f.customer.profile.revision,2);assert.equal(q.profileHash,f.input.profileHash);assert.deepEqual(q.identityFileIds,['old-front','old-back']);assert.deepEqual(q.drivingLicenseFileIds,['old-license']);
});
test('customer scoped upload endpoint exists and rejects unauthorized or missing customer before storage',async()=>{
 const f=fixture(),controller:any=new CustomerRiskController({serial:(op:any)=>op(f.tx)} as any);assert.equal(typeof controller.uploadQualificationFile,'function');
 const file={buffer:Buffer.from([0xff,0xd8,0xff,1]),size:4,mimetype:'image/jpeg',originalname:'synthetic.jpg'};
 await assert.rejects(controller.uploadQualificationFile('customer',{idempotencyKey:'scoped-upload'},file,{admin:{...actor,role:'FINANCE'}}),code('STAFF_SESSION_CHANGED'));
 f.tx.customer.findUnique=async()=>null;await assert.rejects(controller.uploadQualificationFile('missing',{idempotencyKey:'scoped-upload'},file,{admin:actor}),code('NOT_FOUND'));
 assert.equal(f.files.length,6);
});
test('customer scoped upload rejects invalid content and missing idempotency before storage',async()=>{
 const f=fixture(),controller:any=new CustomerRiskController({serial:(op:any)=>op(f.tx)} as any),valid={buffer:Buffer.from([0xff,0xd8,0xff,1]),size:4,mimetype:'image/jpeg',originalname:'synthetic.jpg'};
 for(const file of [undefined,{...valid,buffer:Buffer.from('fake')},{...valid,size:2},{...valid,mimetype:'text/plain'}])await assert.rejects(controller.uploadQualificationFile('customer',{idempotencyKey:'bad-file-upload'},file,{admin:actor}),code('FILE_TYPE'));
 await assert.rejects(controller.uploadQualificationFile('customer',{},valid,{admin:actor}));assert.equal(f.files.length,6);assert.equal(f.commands.length,0);
});
