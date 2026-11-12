import 'reflect-metadata';
import assert from 'node:assert/strict';
import {Module} from '@nestjs/common';
import {APP_GUARD,NestFactory} from '@nestjs/core';
import cookieParser from 'cookie-parser';
import {Access} from '../src/auth/access';
import {tokenHash} from '../src/auth/auth.service';
import {Db} from '../src/common/db';
import {Errors} from '../src/common/errors';
import {USAGE_CLOCK} from '../src/usage/rules';
import {OrderChangesController} from '../src/order-changes/controller';
import {OrderChangesService} from '../src/order-changes/service';
import {DelaySigning} from '../src/order-changes/signing';
import {VehicleChangesController} from '../src/vehicle-changes/controller';
import {VehicleChangesService} from '../src/vehicle-changes/service';
import {offlineDelayFixture} from './offline-delivery-delay-fixture';
import {offlineSwapFixture} from './offline-swap-quotes-fixture';

export type CreateKind='DELIVERY_DELAY'|'VEHICLE_CHANGE';
export const createNow=new Date('2026-10-31T00:00:00Z');
export const createOps={id:'ops',role:'OPERATIONS',authVersion:1};
const matches=(row:any,where:any):boolean=>Object.entries(where??{}).every(([key,value]:[string,any])=>value&&typeof value==='object'?Object.entries(value).every(([op,values]:[string,any])=>op==='notIn'?!values.includes(row[key]):op==='in'?values.includes(row[key]):op==='not'?row[key]!==values:false):row[key]===value);
export function changeCreateFixture(kind:CreateKind){
 const f:any=kind==='DELIVERY_DELAY'?offlineDelayFixture():offlineSwapFixture(),tx=f.tx,locks:string[]=[],staff=new Map<string,any>();
 for(const[id,role]of [['admin','ADMIN'],['ops','OPERATIONS'],['finance','FINANCE'],['support','SUPPORT'],['field','FIELD']])staff.set(id,{id,role,authVersion:1,active:true});
 f.changes.length=0;f.quotes.length=0;f.contracts.splice(0,f.contracts.length,...f.contracts.filter((c:any)=>c.id===f.original.id));
 tx.adminUser.findUnique=async({where}:any)=>staff.get(where.id)??null;
 tx.$queryRaw=async(strings:TemplateStringsArray,...values:any[])=>{locks.push(strings.join('?')+values.join(','));return[];};
 tx.order.findFirst=async({where}:any)=>matches(f.order,where)?f.order:null;
 tx.orderChange.findUnique=async({where}:any)=>f.changes.find((c:any)=>where.orderId_idempotencyKey?matches(c,where.orderId_idempotencyKey):c.id===where.id)??null;
 tx.orderChange.findFirst=async({where,include}:any)=>{const c=f.changes.find((c:any)=>matches(c,where));return c&&include?{...c,quotes:f.quotes.filter((q:any)=>q.changeId===c.id).map((q:any)=>({...q,contract:f.contracts.find((c:any)=>c.delayQuoteId===q.id)??null}))}:c??null;};
 tx.orderChange.findMany=async({where}:any={})=>f.changes.filter((c:any)=>matches(c,where));
 tx.orderChange.count=async({where}:any={})=>f.changes.filter((c:any)=>matches(c,where)).length;
 tx.orderChange.create=async({data}:any)=>{const c={id:'created-'+(f.changes.length+1),revision:0,kind:'DELIVERY_DELAY',status:'DRAFT',createdAt:createNow,activeQuoteId:null,...data};f.changes.push(c);f.writes.push({table:'change',data});return c;};
 const db:any={...tx,serial:async(action:any)=>action(tx)};
 const delay=new OrderChangesService(db,()=>createNow),swap=new VehicleChangesService(db,()=>createNow);
 const context=()=>kind==='DELIVERY_DELAY'?delay.context(f.order.id,createOps):swap.context(tx,f.order.id);
 const create=(input:any,actor:any=createOps,customerId?:string)=>kind==='DELIVERY_DELAY'?delay.create(f.order.id,input,actor):swap.create(f.order.id,input,actor,customerId);
 const snapshot=()=>JSON.stringify({order:f.order,changes:f.changes,quotes:f.quotes,contracts:f.contracts,credits:f.credits,ledger:f.ledger,holds:f.holds,obligations:f.obligations,allocations:f.allocations,refunds:f.refunds,writes:f.writes,audits:f.audits});
 return{...f,tx,db,kind,staff,locks,delay,swap,context,create,snapshot};
}
export const createPaths=(kind:CreateKind)=>({context:`/admin/orders/order/${kind==='DELIVERY_DELAY'?'delivery-delay-context':'vehicle-change-context'}`,create:`/admin/orders/order/${kind==='DELIVERY_DELAY'?'delivery-delay-changes':'vehicle-changes'}`});
export const createBody=(context:any,key='create-once-key')=>({expectedOrderRevision:context.orderRevision,priorTermsHash:context.priorTermsHash,reason:'双方申请合成变更',idempotencyKey:key});
type Actor='admin'|'ops'|'finance'|'support'|'field'|'customer'|'foreign'|'anonymous';
type Result={status:number;body:any};
type Call=(actor:Actor,path:string,body?:unknown,options?:{csrf?:string|null;origin?:string|null})=>Promise<Result>;
export async function withChangeHttp(kind:CreateKind,run:(f:ReturnType<typeof changeCreateFixture>&{sessions:Map<string,any>;afterAuthentication:(fn:()=>void)=>void},call:Call)=>Promise<void>){
 const f=changeCreateFixture(kind),sessions=new Map<string,any>(),customerSessions=new Map<string,any>(),origin='http://127.0.0.1:39998',csrf='synthetic-change-csrf',prior={ADMIN_ORIGIN:process.env.ADMIN_ORIGIN,MVP_V2_ENABLED:process.env.MVP_V2_ENABLED,ESIGN_NEW_REQUESTS_ENABLED:process.env.ESIGN_NEW_REQUESTS_ENABLED};let hook:(()=>void)|undefined;
 for(const id of f.staff.keys())sessions.set(tokenHash('change-http-'+id),{adminId:id,authVersion:1,csrfToken:csrf,expiresAt:new Date(Date.now()+3600000)});
 for(const [id,customerId]of [['customer','customer'],['foreign','foreign-customer']])customerSessions.set(tokenHash('change-http-'+id),{customer:{id:customerId},expiresAt:new Date(Date.now()+3600000)});
 f.db.adminSession={findUnique:async({where}:any)=>{const session=sessions.get(where.id);if(!session)return null;const result={...session,admin:{...f.staff.get(session.adminId)}};hook?.();hook=undefined;return result;}};
 f.db.customerSession={findUnique:async({where}:any)=>customerSessions.get(where.id)??null};
 Object.assign(process.env,{ADMIN_ORIGIN:origin,MVP_V2_ENABLED:'true',ESIGN_NEW_REQUESTS_ENABLED:'false'});
 const forbidden=()=>{throw Error('FORBIDDEN_PROVIDER_CALL');};
 @Module({controllers:[OrderChangesController,VehicleChangesController],providers:[{provide:Db,useValue:f.db},{provide:USAGE_CLOCK,useValue:()=>createNow},OrderChangesService,VehicleChangesService,{provide:DelaySigning,useValue:{prepare:forbidden,sign:forbidden,sync:forbidden}},{provide:APP_GUARD,useClass:Access}]})class CreateHttpModule{}
 const app=await NestFactory.create(CreateHttpModule,{logger:false});app.setGlobalPrefix('api');app.use(cookieParser());app.useGlobalFilters(new Errors());
 try{await app.listen(0,'127.0.0.1');const base=await app.getUrl();assert.equal(new URL(base).hostname,'127.0.0.1');
  const call:Call=async(actor,path,body,options={})=>{const headers:Record<string,string>={'Content-Type':'application/json'};if(['customer','foreign'].includes(actor))headers.authorization='Bearer change-http-'+actor;else if(actor!=='anonymous')headers.cookie='admin_session=change-http-'+actor;if(body!==undefined){if(options.csrf!==null)headers['x-csrf-token']=options.csrf??csrf;if(options.origin!==null)headers.origin=options.origin??origin;}const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json()};};
  await run({...f,sessions,afterAuthentication:(fn:()=>void)=>{hook=fn;}},call);
 }finally{await app.close();for(const[k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;}
}
export function expectCreateHttp(r:Result,status:number,code?:string){assert.equal(r.status,status,JSON.stringify(r.body));if(code)assert.equal(r.body.error?.code,code);return r.body;}
