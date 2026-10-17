import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {createApp} from '../src/app';
import {tokenHash} from '../src/auth/auth.service';
import {listenForHttpTests} from './http-listener';
let db:Db,app:any,base:string;const admins:any={},customers:any[]=[];let ownerId:string;
before(async()=>{
 assert.ok(new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith('_test'));process.env.NODE_ENV='test';db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});
 for(const role of ['OPERATIONS','FINANCE','SUPPORT']){const token=randomUUID(),user=await db.adminUser.create({data:{username:token,name:'Synthetic',passwordHash:'unused',role:role as any}});await db.adminSession.create({data:{id:tokenHash(token),adminId:user.id,csrfToken:'synthetic-csrf',expiresAt:new Date(Date.now()+3600000)}});admins[role]={user,token};}
 for(let i=0;i<2;i++){const token=randomUUID(),customer=await db.customer.create({data:{mobile:'13'+String(i+5)+String(Date.now()).slice(-8)}});await db.customerSession.create({data:{id:tokenHash(token),customerId:customer.id,expiresAt:new Date(Date.now()+3600000)}});customers.push({token,customer});}
 app=await createApp({db});base=await listenForHttpTests(app);
});
after(async()=>{await app?.close();await db?.$disconnect();});
async function req(path:string,body?:any,actor?:string,customer?:number,csrf=true){const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(actor?{Cookie:'admin_session='+admins[actor].token,Origin:(process.env.ADMIN_ORIGIN||'http://localhost:3100').split(',')[0],...(csrf?{'X-CSRF-Token':'synthetic-csrf'}:{})}:{}),...(customer===undefined?{}:{Authorization:'Bearer '+customers[customer].token})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json() as any,cache:r.headers.get('cache-control')};}
test('owner admin routes enforce authentication, role and CSRF without exposing provider identities',async()=>{
 assert.equal((await req('/admin/vehicle-owners')).status,401);for(const role of ['FINANCE','SUPPORT'])assert.equal((await req('/admin/vehicle-owners',undefined,role)).status,403);
 const data={name:'HTTP合成企业',creditCode:'TEST'+randomUUID().replaceAll('-','').slice(0,14).toUpperCase(),address:'合成地址'};
 assert.equal((await req('/admin/vehicle-owners',data,'OPERATIONS',undefined,false)).status,403);
 const result=await req('/admin/vehicle-owners',data,'OPERATIONS');assert.equal(result.status,201,JSON.stringify(result.body));ownerId=result.body.id;
 assert.equal((await req('/admin/vehicle-owners/'+ownerId,undefined,'SUPPORT')).status,403);
 assert.ok(!JSON.stringify((await req('/admin/vehicle-owners/'+ownerId,undefined,'OPERATIONS')).body).includes('providerCustomerId'));
});
test('customer routes bind invitation and read access to authenticated phone and cannot be self-promoted',async()=>{
 assert.equal((await req('/customer/owners')).status,401);
 const invite=await req('/admin/vehicle-owners/'+ownerId+'/invitations',{mobile:customers[0].customer.mobile},'OPERATIONS');assert.equal(invite.status,201);
 assert.equal((await req('/customer/owners/claim',{token:invite.body.token},undefined,1)).status,403);
 assert.equal((await req('/customer/owners/claim',{token:invite.body.token},undefined,0)).status,201);
 const own=await req('/customer/owners/'+ownerId,undefined,undefined,0);assert.equal(own.status,200);assert.equal(own.body.memberStatus,'CLAIMED');assert.equal(own.cache,'no-store');
 assert.equal((await req('/customer/owners/'+ownerId,undefined,undefined,1)).status,404);
 assert.equal((await req('/customer/owners/'+ownerId+'/seal',{sealId:'other'},undefined,0)).status,503);
 assert.equal((await req('/customer/owners/'+ownerId+'/verification',{accepted:true,providerCustomerId:'spoof'},undefined,0)).status,503);
 assert.equal(await db.ownerESignAccount.count({where:{ownerId}}),0);
});
test('owner identity callback cannot create readiness from unsigned claims',async()=>{
 const result=await req('/callbacks/fadada-owner-identity',{transactionNo:'unknown',status:'4'});assert.ok([401,400,503].includes(result.status));assert.equal(await db.ownerESignAccount.count({where:{ownerId}}),0);
});
