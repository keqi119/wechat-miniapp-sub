import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {createApp} from '../src/app';
import {tokenHash} from '../src/auth/auth.service';
import {listenForHttpTests} from './http-listener';
import {ownerH5Access} from '../src/owner-h5/access';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import {ElectronicDocumentService} from '../src/electronic-documents/service';
const code=(v:string)=>(e:any)=>e?.getResponse?.().error?.code===v;
test('electronic HTTP routes enforce current staff role, origin, CSRF and customer authentication',async()=>{
 const db=new Db();let app:any;try{
  const sessions:any={};for(const role of ['ADMIN','OPERATIONS','FINANCE','SUPPORT','FIELD']){const raw=randomUUID(),staff=await db.adminUser.create({data:{username:'esign-http-'+raw,name:'合成员工',passwordHash:'synthetic',role:role as any}});await db.adminSession.create({data:{id:tokenHash(raw),adminId:staff.id,csrfToken:'synthetic-csrf',expiresAt:new Date(Date.now()+3600000)}});sessions[role]=raw;}
  const stub:any={list:async(actor:any)=>({items:[],actorKind:actor.kind}),start:async()=>({accepted:true})};app=await createApp({db,extraProviders:[{provide:ElectronicDocumentService,useValue:stub}]});const base=await listenForHttpTests(app),origin=(process.env.ADMIN_ORIGIN||'http://localhost:3100').split(',')[0];
  const request=async(path:string,role?:string,body?:unknown,csrf=true,requestOrigin=origin)=>{const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(role?{Cookie:'admin_session='+sessions[role],Origin:requestOrigin,...(csrf?{'X-CSRF-Token':'synthetic-csrf'}:{})}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};};
  assert.equal((await request('/admin/electronic-documents')).status,401);for(const role of ['ADMIN','OPERATIONS','FINANCE','SUPPORT'])assert.equal((await request('/admin/electronic-documents',role)).status,200);assert.equal((await request('/admin/electronic-documents','FIELD')).status,403);
  const path='/admin/electronic-documents/synthetic/start';assert.equal((await request(path,'OPERATIONS',{},false)).status,403);assert.equal((await request(path,'OPERATIONS',{},true,'https://foreign.invalid')).status,403);assert.equal((await request(path,'FINANCE',{})).status,403);assert.equal((await request(path,'OPERATIONS',{})).status,201);assert.equal((await request('/customer/electronic-documents')).status,401);
 }finally{await app?.close();await db.$disconnect();}
});
test('only a new legal session can use owner signing; viewing or historical sessions cannot be promoted by cookies or CSRF',async()=>{
 const flags={NEW_ORDER_CONTRACT_MODE:'ELECTRONIC',OWNER_LEGAL_H5_ENABLED:'true',PORTAL_SMS_ENABLED:'true',SESSION_SECRET:'synthetic-owner-electronic-session-secret',ALIYUN_SMS_ACCESS_KEY_ID:'synthetic',ALIYUN_SMS_ACCESS_KEY_SECRET:'synthetic',ALIYUN_SMS_SIGN_NAME:'synthetic',ALIYUN_SMS_LOGIN_TEMPLATE_CODE:'synthetic',H5_SIGNING_ORIGIN:'https://app.evsub.ndacar.com'},old=Object.fromEntries(Object.keys(flags).map(k=>[k,process.env[k]]));Object.assign(process.env,flags);
 try{
  const customer={id:'legal',mobile:'13800000000'},profile={name:'合成法人',revision:2,mobileHash:ownerMobileHash(customer.mobile)},owner={id:'owner',status:'DRAFT',legalRepresentative:profile},member:any={customer,owner,status:'CLAIMED'},session:any={id:tokenHash('a'.repeat(64)),customerId:'legal',csrfToken:'csrf',expiresAt:new Date(Date.now()+3600000),identitySnapshot:{mode:'ELECTRONIC_LEGAL',owners:[{ownerId:'owner',legalRevision:2,legalMobileHash:profile.mobileHash}]}},db:any={ownerH5Session:{findUnique:async()=>session},partnerPortalSession:{findUnique:async()=>null},ownerMember:{findUnique:async()=>member},customer:{findUnique:async()=>customer}};
  const request=()=>({method:'POST',cookies:{owner_h5_session:'a'.repeat(64)},headers:{origin:'https://app.evsub.ndacar.com','x-csrf-token':'csrf'}}),response={setHeader:()=>{}};const path='/owner-h5/owners/owner/electronic-documents/doc/sign';
  const good:any=request();assert.equal(await ownerH5Access(db,good,response,path),true);assert.equal(good.ownerH5Customer.id,'legal');
  const noCsrf=request();delete (noCsrf.headers as any)['x-csrf-token'];await assert.rejects(ownerH5Access(db,noCsrf,response,path),code('CSRF_DENIED'));
  const foreign=request();foreign.headers.origin='https://foreign.invalid';await assert.rejects(ownerH5Access(db,foreign,response,path),code('ORIGIN_DENIED'));
  await assert.rejects(ownerH5Access(db,request(),response,path.replace('/owner/','/another/')),code('NOT_FOUND'));
  profile.revision++;await assert.rejects(ownerH5Access(db,request(),response,path),code('SESSION_EXPIRED'));profile.revision--;
  session.identitySnapshot=[];await assert.rejects(ownerH5Access(db,request(),response,path),code('PARTNER_READ_ONLY'));
 }finally{for(const[k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
