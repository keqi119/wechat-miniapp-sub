import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ApiClient} from './core.ts';
import {canReadCustomerProfile,customerFilePath,customerSourceLabel,profileQualificationEvidence,customerIdentityStatus} from './customer-profile-model.ts';
import {paragraphs} from './prose.ts';
import {vehicleFormFields} from './vehicle-fields.ts';
import {serializeForm} from './form.ts';
import {actionAllowed,detailFor,resources} from './resources.ts';

test('customer evidence is restricted to reviewers and never promotes current supplements to historical facts',()=>{
 for(const role of ['ADMIN','OPERATIONS'])assert.equal(canReadCustomerProfile(role),true);
 for(const role of ['FINANCE','SUPPORT','FIELD',undefined])assert.equal(canReadCustomerProfile(role),false);
 assert.match(customerSourceLabel('CURRENT_SUPPLEMENT'),/当前补充资料，非下单时快照/);
 assert.match(customerSourceLabel('APPLICATION_SNAPSHOT'),/申请/);assert.match(customerSourceLabel('ORDER_SNAPSHOT'),/订单/);
});
test('only explicit manual identity policy explains manual review without inventing online verification',()=>{
 assert.equal(customerIdentityStatus({identityPolicy:'MANUAL_REVIEW',verified:false}),'未进行线上实名认证，由运营审核资料');
 assert.equal(customerIdentityStatus({identityPolicy:'MANUAL_REVIEW',verified:true}),'未进行线上实名认证，由运营审核资料');
 for(const identityPolicy of [undefined,'UNKNOWN','manual_review'])assert.equal(customerIdentityStatus({identityPolicy,verified:false}),'尚无可信实名记录');
 assert.equal(customerIdentityStatus({identityPolicy:'PROVIDER_REQUIRED',verified:true}),'已实名');
 assert.equal(customerIdentityStatus({verified:true}),'已实名');
});
test('private attachment paths must bind the current application or order and exact file',()=>{
 const file={id:'photo-1',url:'/api/admin/applications/a/customer-profile/files/photo-1'};
 assert.equal(customerFilePath('applications','a',file),'/admin/applications/a/customer-profile/files/photo-1');
 for(const url of ['https://foreign.example/photo','javascript:alert(1)','/api/admin/applications/b/customer-profile/files/photo-1','/api/admin/files/photo-1','/api/admin/applications/a/customer-profile/files/photo-2'])assert.throws(()=>customerFilePath('applications','a',{...file,url}));
});
test('multiline text retains paragraphs and single line breaks as plain text',()=>{
 assert.deepEqual(paragraphs('第一段\r\n第二行\r\n\r\n<script>alert(1)</script>\n\n第三段'),['第一段\n第二行','<script>alert(1)</script>','第三段']);
});
test('vehicle create validates VIN while ordinary editing cannot replace VIN or registered plate',()=>{
 const create=vehicleFormFields('create',[{key:'vin',label:'VIN',required:true,minLength:17,maxLength:17},{key:'plateNumber',label:'车牌'}]);
 assert.equal(create[0].required,true);assert.throws(()=>serializeForm(create,{vin:'',plateNumber:'沪A'}));
 assert.equal(serializeForm(create,{vin:' lsvnu61e2sn513145 ',plateNumber:'沪A'}).vin,'LSVNU61E2SN513145');
 assert.throws(()=>serializeForm(create,{vin:'IIIIIIIIIIIIIIIII'}));
 const edit=vehicleFormFields('edit',create);assert.equal(edit[0].readOnly,true);assert.equal(edit[0].submit,false);
 assert.deepEqual(serializeForm(edit,{vin:'malicious-change',plateNumber:'沪B'}),{});assert.equal(create.some(field=>field.key==='plateNumber'),false);
 assert(resources.find(r=>r.key==='vehicles')!.columns.some(c=>c.key==='vin'));
});
test('application generic details do not substitute the mutable or legacy raw profile for scoped customer evidence',()=>{
 const shown=detailFor('applications',{id:'a',profile:{fileIds:['old-photo']},customer:{id:'c',name:'姓名',mobile:'13800000000'}});
 assert.equal(shown.profile,undefined);assert.deepEqual(shown.customer,{id:'c',name:'姓名',mobile:'13800000000'});
});
test('private image fetch uses credentials, validates content and rejects late former-session bytes',async()=>{
 let options:RequestInit|undefined;
 const api=new ApiClient(async function(this:unknown,_url,init){assert.equal(this,undefined,'fetch must not be bound to ApiClient');options=init;return new Response(new Uint8Array([1,2]),{headers:{'Content-Type':'image/png'}});});
 api.setSession({user:{id:'a',username:'a',role:'ADMIN',permissions:['*']},csrfToken:'a'});
 const result=await api.readPrivateFile('/admin/orders/o/customer-profile/files/f','image/png');assert.equal(result.type,'image/png');assert.equal(options?.credentials,'include');
 const bad=new ApiClient(async()=>new Response('<script>bad</script>',{headers:{'Content-Type':'text/html'}}));bad.setSession(api.session);await assert.rejects(bad.readPrivateFile('/admin/orders/o/customer-profile/files/f','image/png'),(error:any)=>error.code==='FILE_TYPE_MISMATCH');
 let resolve!: (response:Response)=>void;const late=new ApiClient(()=>new Promise(done=>{resolve=done;}));
 late.setSession({user:{id:'a',username:'a',role:'ADMIN',permissions:['*']},csrfToken:'a'});const request=late.readPrivateFile('/admin/orders/o/customer-profile/files/f','image/png');
 late.setSession({user:{id:'b',username:'b',role:'ADMIN',permissions:['*']},csrfToken:'b'});resolve(new Response(new Uint8Array([1]),{headers:{'Content-Type':'image/png'}}));
 await assert.rejects(request,(error:any)=>error.code==='SESSION_CHANGED');
});

test('awaiting customer confirmation permits only a return for additional information',()=>{
 const actions=resources.find(r=>r.key==='applications')!.actions!.filter(a=>a.path==='review');
 const awaiting={id:'a',status:'AWAITING_CONFIRMATION'};
 assert.equal(actionAllowed('applications',actions.find(a=>a.fixed?.decision==='NEEDS_INFO')!,awaiting),true);
 for(const action of actions.filter(a=>a.fixed?.decision!=='NEEDS_INFO'))assert.equal(actionAllowed('applications',action,awaiting),false);
 for(const action of actions)assert.equal(actionAllowed('applications',action,{id:'a',status:'FINAL_PLAN_CONFIRMED'}),false);
});

test('reuse evidence keeps the displayed profile hash and classified document IDs together',()=>{
 const file=(id:string)=>({id,name:id,mimeType:'image/png',size:1,url:id});
 const data={currentProfile:{revision:7,profileHash:'displayed-hash'},files:{current:{identityFront:file('front'),identityBack:file('back'),drivingLicense:file('license'),legacy:[file('unclassified')]}}};
 assert.deepEqual(profileQualificationEvidence(data as any),{profileHash:'displayed-hash',profileRevision:7,identityFileIds:['front','back'],drivingLicenseFileIds:['license']});
 assert.equal(profileQualificationEvidence({...data,files:{current:{...data.files.current,identityBack:null}}} as any),null);
 assert.equal(profileQualificationEvidence({...data,currentProfile:{revision:7}} as any),null);
});
