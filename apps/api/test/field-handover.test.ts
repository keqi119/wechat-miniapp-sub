import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {createApp} from '../src/app';
import {passwordHash,tokenHash} from '../src/auth/auth.service';
import {listenForHttpTests} from './http-listener';
let db:Db,app:any,base:string,staff:any,second:any,manager:any,customer:any,outsider:any,order:any,task:any,file:any;
const origin='http://localhost:3100',password='Synthetic-Field-Test-Password';
async function request(path:string,method='GET',body?:any,identity:any=manager){
 const h:any={Origin:origin,...(identity?.cookie?{Cookie:identity.cookie,'X-CSRF-Token':identity.csrf}:{}),...(identity?.token?{Authorization:`Bearer ${identity.token}`}:{})};
 if(!(body instanceof FormData))h['Content-Type']='application/json';
 const r=await fetch(base+'/api'+path,{method,headers:h,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 const ct=r.headers.get('content-type')||'';return{status:r.status,data:ct.includes('application/json')?await r.json() as any:await r.arrayBuffer(),headers:r.headers};
}
async function account(role:string){const u=await db.adminUser.create({data:{username:randomUUID(),name:role+'测试',role:role as any,passwordHash:passwordHash(password)}});const r=await request('/admin/auth/login','POST',{username:u.username,password},null);assert.equal(r.status,201);return{...u,cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrfToken};}
async function upload(t:any,who=staff){const form=new FormData();form.set('version',String(t.version));form.set('file',new Blob([Buffer.from('89504e470d0a1a0a0000000049454e44ae426082','hex')],{type:'image/png'}),'synthetic.png');return request('/admin/field-tasks/'+t.id+'/files','POST',form,who);}
before(async()=>{
 assert.ok(process.env.TEST_DATABASE_URL?.includes('_test'));process.env.NODE_ENV='test';process.env.ADMIN_ORIGIN=origin;
 db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});app=await createApp({db});base=await listenForHttpTests(app);
 manager=await account('ADMIN');staff=await account('FIELD');second=await account('FIELD');
 const mkCustomer=async()=>{const c=await db.customer.create({data:{mobile:'field-'+randomUUID(),name:'合成现场客户'}});const token=randomUUID();await db.customerSession.create({data:{id:tokenHash(token),customerId:c.id,expiresAt:new Date(Date.now()+3600000)}});return{...c,token};};
 customer=await mkCustomer();outsider=await mkCustomer();
 const v=await db.vehicle.create({data:{brand:'合成',model:'EV',title:'现场测试车',year:2026,city:'上海',mileageKm:100,status:'RESERVED'}});
 const p=await db.subscriptionPlan.create({data:{vehicleId:v.id,name:'合成',months:12,monthlyFeeAmount:100,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'测试',benefits:[],conditions:'测试'}});
 const a=await db.application.create({data:{customerId:customer.id,vehicleId:v.id,subscriptionPlanId:p.id,profile:{},consents:[],idempotencyKey:randomUUID(),requestHash:'test'}});
 order=await db.order.create({data:{applicationId:a.id,customerId:customer.id,vehicleId:v.id,finalPlanSnapshot:{commercialTerms:{vehicleIdentification:'合成测试车辆 身份已核对'}},confirmedMileageKm:100,status:'AWAITING_HANDOVER'}});
 await db.vehicle.update({where:{id:v.id},data:{reservedOrderId:order.id}});
});
after(async()=>{await app?.close();await db?.$disconnect();});
test('field credentials cannot access dashboard, customers, generic files, or manager tasks',async()=>{
 for(const p of ['/admin/dashboard','/admin/customers','/admin/files/nope','/admin/handover-tasks','/admin/orders'])assert.equal((await request(p,'GET',undefined,staff)).status,403,p);
 assert.equal((await request('/admin/field-tasks','GET',undefined,manager)).status,403);
});
test('manager assigns one task; only assigned staff sees minimum order projection',async()=>{
 const r=await request('/admin/handover-tasks','POST',{orderId:order.id,type:'DELIVERY',assigneeId:staff.id,note:'合成现场任务'});assert.equal(r.status,201,JSON.stringify(r.data));task=r.data;
 assert.equal((await request('/admin/handover-tasks','POST',{orderId:order.id,type:'DELIVERY',assigneeId:staff.id})).status,409);
 assert.equal((await request('/admin/field-tasks/'+task.id,'GET',undefined,second)).status,404);
 const own=await request('/admin/field-tasks/'+task.id,'GET',undefined,staff);assert.equal(own.status,200);assert.equal(own.data.customerName,customer.name);assert.equal(own.data.finalPlanSnapshot,undefined);assert.equal(own.data.customerId,undefined);
 assert.equal((await request('/admin/field-tasks','GET',undefined,second)).data.items.length,0);
});
test('draft and attachments stay private, forged file ids and stale versions rejected',async()=>{
 const up=await upload(task);assert.equal(up.status,201,JSON.stringify(up.data));file=up.data;task=up.data.task;
 assert.equal((await request(`/customer/files/${file.id}`,'GET',undefined,customer)).status,404);
 assert.equal((await request(`/admin/field-tasks/${task.id}/files/${file.id}`,'GET',undefined,second)).status,404);
 const draft={actualAt:new Date(Date.now()-1000).toISOString(),readingKm:100,batteryPercent:80,place:'合成现场地址',accessories:'钥匙一把',condition:'测试无损',openItems:'无',resolutionPlan:'无',fileIds:[file.id]};
 assert.equal((await request(`/admin/field-tasks/${task.id}/draft`,'POST',{version:task.version,draft:{...draft,fileIds:['foreign']}},staff)).status,403);
 let r=await request(`/admin/field-tasks/${task.id}/draft`,'POST',{version:task.version,draft},staff);assert.equal(r.status,201,JSON.stringify(r.data));task=r.data;
 assert.equal((await request(`/admin/field-tasks/${task.id}/draft`,'POST',{version:task.version-1,draft},staff)).status,409);
 assert.equal((await request(`/admin/field-tasks/${task.id}/publish`,'POST',{version:task.version,idempotencyKey:randomUUID(),checked:false},staff)).status,400);
});
test('future time and odometer regression cannot publish; no accidental handover created',async()=>{
 const original=task.draft;
 for(const altered of [{...original,actualAt:'2099-01-01T00:00:00Z'},{...original,readingKm:99},{...original,fileIds:[]}]){
  const saved=await request(`/admin/field-tasks/${task.id}/draft`,'POST',{version:task.version,draft:altered},staff);assert.equal(saved.status,201);task=saved.data;
  const pub=await request(`/admin/field-tasks/${task.id}/publish`,'POST',{version:task.version,idempotencyKey:randomUUID(),checked:true},staff);assert.ok([400,409].includes(pub.status),JSON.stringify(pub.data));
  assert.equal(await db.handover.count({where:{orderId:order.id}}),0);
 }
 task=(await request(`/admin/field-tasks/${task.id}/draft`,'POST',{version:task.version,draft:original},staff)).data;
});
test('publish retries are idempotent, customer sees same material, facts locked',async()=>{
 const b={version:task.version,idempotencyKey:randomUUID(),checked:true};
 const pair=await Promise.all([request(`/admin/field-tasks/${task.id}/publish`,'POST',b,staff),request(`/admin/field-tasks/${task.id}/publish`,'POST',b,staff)]);
 for(const r of pair)assert.equal(r.status,201,JSON.stringify(r.data));task=pair[0].data;assert.equal(task.handover.id,pair[1].data.handover.id);
 assert.equal(await db.notification.count({where:{resourceId:task.handover.id}}),1);
 assert.equal((await request(`/customer/handovers/${task.handover.id}`,'GET',undefined,outsider)).status,404);
 const c=await request(`/customer/handovers/${task.handover.id}`,'GET',undefined,customer);assert.equal(c.data.status,'PUBLISHED');assert.deepEqual(c.data.fileIds,[file.id]);
 assert.equal(c.data.checklist.find((x:any)=>x.factKey==='batteryLevel')?.label,'交接时电量');
 assert.equal(((await db.handover.findUniqueOrThrow({where:{id:task.handover.id}})).checklist as any[]).find(x=>x.label==='batteryLevel').value,'80%');
 assert.equal((await request(`/customer/files/${file.id}`,'GET',undefined,customer)).status,200);
 assert.equal((await request(`/admin/field-tasks/${task.id}/draft`,'POST',{version:task.version,draft:task.draft},staff)).status,409);
 assert.equal((await request(`/admin/handovers/${task.handover.id}/complete`,'POST',{})).status,409);
});
test('objection creates new version, customer reconfirms, original manifest preserved',async()=>{
 const old=task.handover;
 assert.equal((await request(`/customer/handovers/${old.id}/object`,'POST',{manifestHash:old.manifestHash,reason:'照片说明需要补充',idempotencyKey:randomUUID()},customer)).status,201);
 let r=await request(`/admin/field-tasks/${task.id}/draft`,'POST',{version:task.version,draft:{...task.draft,condition:'补充现场核对无损',resolutionNote:'已现场核对并补充描述'}},staff);assert.equal(r.status,201,JSON.stringify(r.data));task=r.data;
 r=await request(`/admin/field-tasks/${task.id}/publish`,'POST',{version:task.version,idempotencyKey:randomUUID(),checked:true},staff);assert.equal(r.status,201,JSON.stringify(r.data));task=r.data;
 assert.notEqual(task.handover.id,old.id);const prior=await db.handover.findUniqueOrThrow({where:{id:old.id}});assert.equal(prior.manifestHash,old.manifestHash);assert.equal(prior.status,'SUPERSEDED');
 assert.equal((await request(`/customer/handovers/${task.handover.id}/confirm`,'POST',{manifestHash:old.manifestHash,readFileIds:[file.id],idempotencyKey:randomUUID()},customer)).status,409);
 assert.equal((await request(`/customer/handovers/${task.handover.id}/confirm`,'POST',{manifestHash:task.handover.manifestHash,readFileIds:[file.id],idempotencyKey:randomUUID()},customer)).status,201);
 assert.equal((await request(`/admin/handovers/${task.handover.id}/complete`,'POST',{})).status,409);
});
test('reassignment immediately revokes old employee and preserves authorized task evidence',async()=>{
 const r=await request(`/admin/handover-tasks/${task.id}/reassign`,'POST',{version:task.version,assigneeId:second.id,note:'测试改派'});assert.equal(r.status,201,JSON.stringify(r.data));task=r.data;
 assert.equal((await request(`/admin/field-tasks/${task.id}`,'GET',undefined,staff)).status,404);
 assert.equal((await request(`/admin/field-tasks/${task.id}/files/${file.id}`,'GET',undefined,staff)).status,404);
 assert.equal((await request(`/admin/field-tasks/${task.id}/files/${file.id}`,'GET',undefined,second)).status,200);
 await db.adminUser.update({where:{id:second.id},data:{active:false}});
 assert.equal((await request(`/admin/field-tasks/${task.id}`,'GET',undefined,second)).status,401);
});
test('employee changes own password and old sessions are revoked',async()=>{
 const r=await request('/admin/auth/password','POST',{currentPassword:password,newPassword:password+'-changed'},staff);assert.equal(r.status,201,JSON.stringify(r.data));
 assert.equal((await request('/admin/auth/me','GET',undefined,staff)).status,401);
});
async function extraTask(){
 const who=await account('FIELD');const v=await db.vehicle.create({data:{brand:'测试',model:'EV',title:'审查测试车',year:2026,city:'上海',mileageKm:1,status:'RESERVED'}});
 const p=await db.subscriptionPlan.create({data:{vehicleId:v.id,name:'测试',months:12,monthlyFeeAmount:1,mileagePerMonthKm:1500,excessMileagePriceAmount:80,energyDescription:'测试',benefits:[],conditions:'测试'}});
 const a=await db.application.create({data:{customerId:customer.id,vehicleId:v.id,subscriptionPlanId:p.id,profile:{},consents:[],idempotencyKey:randomUUID(),requestHash:'test'}});
 const o=await db.order.create({data:{applicationId:a.id,customerId:customer.id,vehicleId:v.id,status:'AWAITING_HANDOVER',confirmedMileageKm:1,finalPlanSnapshot:{commercialTerms:{vehicleIdentification:'合成审查车辆',handoverArrangement:'已确认测试交还安排'}}}});
 await db.vehicle.update({where:{id:v.id},data:{reservedOrderId:o.id}});
 const r=await request('/admin/handover-tasks','POST',{orderId:o.id,type:'DELIVERY',assigneeId:who.id});assert.equal(r.status,201);return{who,order:o,task:r.data};
}
test('cancelled task can explicitly restart with audit, new generation and empty draft',async()=>{
 const f=await extraTask();let t=(await upload(f.task,f.who)).data.task;
 const oldFile=t.draft.fileIds[0];t=(await request(`/admin/handover-tasks/${t.id}/cancel`,'POST',{version:t.version,note:'预约取消'})).data;
 const r=await request(`/admin/handover-tasks/${t.id}/restart`,'POST',{version:t.version,assigneeId:f.who.id,note:'重新预约，重新采集',reset:true});assert.equal(r.status,201,JSON.stringify(r.data));t=r.data;
 assert.equal(t.status,'ASSIGNED');assert.deepEqual(t.draft.fileIds,[]);
 assert.equal((await request(`/admin/field-tasks/${t.id}/draft`,'POST',{version:t.version,draft:{...t.draft,fileIds:[oldFile]}},f.who)).status,403);
 assert.equal((await request(`/admin/field-tasks/${t.id}/files/${oldFile}`,'GET',undefined,f.who)).status,404);
 assert.equal(await db.auditLog.count({where:{resourceId:t.id,action:'RESTART'}}),1);
});
test('vehicle or assignment changes lock old draft and require explicit cleared restart',async()=>{
 const f=await extraTask();let t=(await upload(f.task,f.who)).data.task;
 await db.vehicle.update({where:{id:f.order.vehicleId},data:{reservedOrderId:null,status:'UNPUBLISHED'}});
 const newVehicle=await db.vehicle.create({data:{brand:'测试',model:'EV',title:'换后测试车辆',year:2026,city:'上海',mileageKm:1,status:'RESERVED',reservedOrderId:f.order.id}});
 await db.order.update({where:{id:f.order.id},data:{vehicleId:newVehicle.id}});
 const d={actualAt:new Date(Date.now()-1000).toISOString(),readingKm:5,batteryPercent:80,place:'测试现场',accessories:'无',condition:'无',openItems:'无',resolutionPlan:'无',fileIds:t.draft.fileIds};
 const saved=await request(`/admin/field-tasks/${t.id}/draft`,'POST',{version:t.version,draft:d},f.who);assert.equal(saved.status,409,JSON.stringify(saved.data));assert.equal(saved.data.error.code,'VEHICLE_CONTEXT_CHANGED');
 assert.equal((await request(`/admin/field-tasks/${t.id}`,'GET',undefined,f.who)).data.canEdit,false);
 const r=await request(`/admin/handover-tasks/${t.id}/restart`,'POST',{version:t.version,assigneeId:f.who.id,note:'核对新车辆后重新采集',reset:true});assert.equal(r.status,201,JSON.stringify(r.data));t=r.data;
 assert.equal(t.vehicleTitle,'换后测试车辆');assert.deepEqual(t.draft.fileIds,[]);assert.equal(t.canEdit,true);
});
test('authorized admin objection revision can add normal admin evidence; field cannot import it',async()=>{
 const f=await extraTask();let t=(await upload(f.task,f.who)).data.task;
 t=(await request(`/admin/field-tasks/${t.id}/draft`,'POST',{version:t.version,draft:{...t.draft,actualAt:new Date(Date.now()-1000).toISOString(),readingKm:5,batteryPercent:80,place:'测试现场',accessories:'无',condition:'无',openItems:'无',resolutionPlan:'无'}},f.who)).data;
 t=(await request(`/admin/field-tasks/${t.id}/publish`,'POST',{version:t.version,checked:true,idempotencyKey:randomUUID()},f.who)).data;
 await request(`/customer/handovers/${t.handover.id}/object`,'POST',{manifestHash:t.handover.manifestHash,reason:'需要补充证据',idempotencyKey:randomUUID()},customer);
 const file=await db.storedFile.create({data:{adminId:manager.id,name:'合成后台证据',mimeType:'image/png',size:1,sha256:'synthetic',storagePath:'synthetic',purpose:'handover'}});
 assert.equal((await request(`/admin/field-tasks/${t.id}/draft`,'POST',{version:t.version,draft:{...t.draft,fileIds:[file.id]}},f.who)).status,403);
 const r=await request(`/admin/handovers/${t.handover.id}/revise`,'POST',{actualAt:t.draft.actualAt,readingKm:5,fileIds:[file.id],checklist:[{label:'车辆状况',value:'补充证据'}],resolutionNote:'后台接管核对'});assert.equal(r.status,201,JSON.stringify(r.data));
 assert.equal((await request(`/admin/field-tasks/${t.id}`,'GET',undefined,f.who)).data.canEdit,false);
 assert.equal((await request(`/admin/field-tasks/${t.id}/publish`,'POST',{version:t.version,checked:true,idempotencyKey:randomUUID()},f.who)).status,409);
});
