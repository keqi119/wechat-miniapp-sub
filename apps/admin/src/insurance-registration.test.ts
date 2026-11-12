import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError,api} from './core.ts';
import {insuranceFileUrl,policyFormValues,registrationInput,InsuranceRegistrationCommand,type InsurancePolicy} from './insurance-registration.ts';
const policy:InsurancePolicy={id:'policy',revision:8,policyNumber:'001',insurer:'保险机构',policyType:'COMMERCIAL',versions:[{id:'newest',version:3,revision:4,status:'SUBMITTED',vehicleIds:['a','b'],fileIds:['file'],insuredParty:'被保险人',startAt:'2026-01-01T00:00:00.000Z',endAt:'2027-01-01T00:00:00.000Z',premiumAmount:12345}],files:[{fileId:'file',name:'保单.pdf'}]};
test('editing preserves every original vehicle and attachment, snapshots latest revisions and submits cents without invented review facts',()=>{
 const values=policyFormValues(policy);values.confirmed=true;values.reason='核对后更正';const input=registrationInput(values,[],policy);
 assert.deepEqual(input.vehicleIds,['a','b']);assert.deepEqual(input.fileIds,['file']);assert.equal(input.revision,8);assert.equal(input.versionId,'newest');assert.equal(input.versionRevision,4);assert.equal(input.premiumAmount,12345);assert.equal(input.startAt,'2026-01-01T00:00:00.000Z');assert.equal(input.endAt,'2027-01-01T00:00:00.000Z');
 for(const key of ['coverageItems','terms','reviewedBy','reviewedAt','effectiveAt'])assert.equal(Object.hasOwn(input,key),false);
 assert.throws(()=>registrationInput({...values,reason:''},[],policy),/修改说明/);assert.throws(()=>registrationInput({...values,confirmed:false},[],policy),/核对/);assert.throws(()=>registrationInput({...values,fileIds:['other-policy']},[],policy),/属于当前保单/);assert.throws(()=>registrationInput({...values,policyType:''},[],policy),/保单类型/);
});
test('single registration validates original count, format and size',()=>{const values={...policyFormValues(policy),fileIds:[],reason:'更正信息',confirmed:true};assert.throws(()=>registrationInput(values,[],policy),/1至20份/);assert.throws(()=>registrationInput(values,[new File(['text'],'bad.exe',{type:'application/octet-stream'})],policy),/PDF/);assert.throws(()=>registrationInput(values,[new File([new Uint8Array(10*1024*1024+1)],'big.pdf',{type:'application/pdf'})],policy),/10MiB/);assert.throws(()=>registrationInput({...values,endAt:values.startAt},[new File(['%PDF'],'a.pdf',{type:'application/pdf'})],policy),/晚于/);});
test('the 32MiB aggregate includes retained originals as well as new endorsements',()=>{const current={...policy,files:['a','b','c'].map(fileId=>({fileId,size:10*1024*1024}))};const values={...policyFormValues(policy),fileIds:['a','b','c'],reason:'补充批单',confirmed:true};assert.throws(()=>registrationInput(values,[new File([new Uint8Array(3*1024*1024)],'批单.pdf',{type:'application/pdf'})],current),/保留与新增文件合计/);});
test('private policy open links use the same trusted API base as the real client and reject route injection',()=>{const original=api.fileUrl;try{api.fileUrl=id=>'https://api.local.test/api/admin/files/'+encodeURIComponent(id);assert.equal(insuranceFileUrl('policy','file'),'https://api.local.test/api/admin/insurance-policies/policy/files/file/open');assert.throws(()=>insuranceFileUrl('../policy','file'),/路径无效/);}finally{api.fileUrl=original;}});
test('unknown multipart result freezes the exact key and bytes, then known commit only retries GET readback',async()=>{
 const command=new InsuranceRegistrationCommand(()=> 'stable-key');const file=new File(['%PDF-real-bytes'],'原保单.pdf',{type:'application/pdf'});const requests:FormData[]=[],reads:string[]=[];let failWrite=true,failRead=true;
 const request=async(_path:string,options:{body:FormData})=>{requests.push(options.body);if(failWrite){failWrite=false;throw new ApiError('network',0);}return {id:'saved'};};
 const readback=async(id:string)=>{reads.push(id);if(failRead){failRead=false;throw new ApiError('GET unavailable',503);} };
 await assert.rejects(command.execute('/registrations',{revision:0},[file],request,readback));assert.equal(command.phase,'unknown');
 await assert.rejects(command.execute('/different',{revision:99},[],request,readback));assert.equal(command.phase,'readback');assert.equal(requests[0],requests[1]);assert.equal(JSON.parse(String(requests[0].get('input'))).idempotencyKey,'stable-key');assert.equal(JSON.parse(String(requests[0].get('input'))).revision,0);assert.equal(await (requests[0].get('files') as File).text(),'%PDF-real-bytes');
 await command.execute('/different',undefined,[],request,readback);assert.equal(command.phase,'idle');assert.equal(requests.length,2);assert.deepEqual(reads,['saved','saved']);
});
test('revision conflict does not silently rebase or retry a registration',async()=>{const command=new InsuranceRegistrationCommand();let calls=0;await assert.rejects(command.execute('/registrations',{revision:8},[],async()=>{calls++;throw new ApiError('版本已变化',409,'REVISION_CONFLICT');},async()=>{}));assert.equal(command.phase,'conflict');assert.equal(calls,1);});
test('a 2xx invalid registration response cannot repeat POST and edits read only their trusted policy id',async()=>{
 for(const failure of ['missing','json','different']){const command=new InsuranceRegistrationCommand(),reads:string[]=[];let writes=0;const request=async()=>{writes++;if(failure==='json')throw new ApiError('bad JSON',200,'INVALID_RESPONSE');return failure==='different'?{id:'another-policy'}:{} as {id:string};};
  await command.execute('/admin/insurance-policies/policy/registrations',{revision:8},[],request,async id=>{reads.push(id);});assert.equal(writes,1);assert.deepEqual(reads,['policy']);
 }
 const command=new InsuranceRegistrationCommand();let writes=0;const request=async()=>{writes++;return {} as {id:string};};
 await assert.rejects(command.execute('/admin/insurance-policies/registrations',{revision:0},[],request,async()=>{}));assert.equal(command.phase,'readback');
 await assert.rejects(command.execute('/admin/insurance-policies/registrations',undefined,[],request,async()=>{}));assert.equal(writes,1);
});
