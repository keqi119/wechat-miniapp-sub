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
import {OrderRenewalsController} from '../src/order-renewals/controller';
import {OrderRenewalsService} from '../src/order-renewals/service';
import {renewalFixture,renewalNow,renewalPreviewInput} from './order-renewals-fixture';
import {renewalFinanceFixture} from './order-renewals-finance-fixture';

export type HttpActor='admin'|'ops'|'finance'|'support'|'field'|'customer'|'foreign'|'anonymous';
export type HttpResult={status:number;body:any;headers:Headers};
export const httpOrigin='http://127.0.0.1:39999',httpCsrf='synthetic-renewal-csrf';
function matches(row:any,where:any):boolean{return Object.entries(where??{}).every(([key,value]:[string,any])=>{
 if(value&&typeof value==='object'&&!Array.isArray(value)){return Object.entries(value).every(([op,operand]:[string,any])=>op==='not'?row[key]!==operand:op==='notIn'?!operand.includes(row[key]):op==='in'?operand.includes(row[key]):op==='contains'?String(row[key]??'').includes(operand):false);}
 return row[key]===value;
});}

/** Only delegates to isolated arrays. Db is an injection token, never constructed. */
export async function renewalHttpFixture(finance=false){
 const f:any=finance?await renewalFinanceFixture():renewalFixture(),queries:any[]=[],sessions=new Map<string,any>(),customerSessions=new Map<string,any>();
 // Production LegalDocument.title is required; the old pricing-only fixture omitted it.
 const findLegal=f.tx.legalDocument.findFirst;f.tx.legalDocument.findFirst=async(args:any)=>{const doc=await findLegal(args);return doc?{...doc,title:doc.title??'合成正式文书标题'}:doc;};
 const customers=new Map([[f.customer.id,f.customer],['foreign-customer',{id:'foreign-customer',name:'合成其他客户'}]]);
 for(const[id,role]of [['admin','ADMIN'],['ops','OPERATIONS'],['finance','FINANCE'],['support','SUPPORT'],['field','FIELD']]){
  f.staff.set(id,{id,role,authVersion:1,active:true});sessions.set(tokenHash('renewal-http-'+id),{adminId:id,authVersion:1,csrfToken:httpCsrf,expiresAt:new Date(Date.now()+3600000)});
 }
 for(const[id,customerId]of [['customer',f.customer.id],['foreign','foreign-customer']])customerSessions.set(tokenHash('renewal-http-'+id),{customerId,expiresAt:new Date(Date.now()+3600000)});
 f.tx.customer.findUnique=async({where}:any)=>customers.get(where.id)??null;
 f.tx.orderChange.findMany=async(args:any={})=>{queries.push({table:'change',...args});const rows=f.changes.filter((r:any)=>matches(r,args.where));return rows.slice(args.skip??0,args.take===undefined?undefined:(args.skip??0)+args.take);};
 f.tx.orderChange.count=async(args:any={})=>{queries.push({table:'count',...args});return f.changes.filter((r:any)=>matches(r,args.where)).length;};
 f.tx.delayQuote.findMany=async({where,include}:any)=>f.quotes.filter((q:any)=>matches(q,where)).map((q:any)=>include?.contract?{...q,contract:f.contracts.find((c:any)=>c.delayQuoteId===q.id)??null}:q);
 f.tx.orderServiceStage.findFirst=async({where}:any)=>f.stages.find((s:any)=>matches(s,where))??null;
 let afterAuthentication:(()=>void)|undefined;
 const db:any={...f.tx,serial:async(action:any)=>action(f.tx),
  adminSession:{findUnique:async({where}:any)=>{const session=sessions.get(where.id),current=session&&f.staff.get(session.adminId);if(!session||!current)return null;const result={...session,admin:{...current}};afterAuthentication?.();afterAuthentication=undefined;return result;}},
  customerSession:{findUnique:async({where}:any)=>{const session=customerSessions.get(where.id);return session?{...session,customer:customers.get(session.customerId)}:null;}}
 };
 const snapshot=()=>JSON.stringify({order:f.order,initial:f.initial,changes:f.changes,quotes:f.quotes,contracts:f.contracts,stages:f.stages,terms:f.terms,bills:f.bills,credits:f.credits,obligations:f.obligations,allocations:f.allocations,refunds:f.refunds,commands:f.commands,audits:f.audits,writes:f.writes});
 return{...f,db,queries,sessions,customerSessions,customers,snapshot,afterAuthentication:(fn:()=>void)=>{afterAuthentication=fn;}};
}
export type RenewalHttpFixture=Awaited<ReturnType<typeof renewalHttpFixture>>;
export type HttpCall=(actor:HttpActor,path:string,body?:unknown,options?:{csrf?:string|null;origin?:string|null})=>Promise<HttpResult>;
export async function withRenewalHttp(run:(f:RenewalHttpFixture,call:HttpCall)=>Promise<void>,finance=false){
 const f=await renewalHttpFixture(finance),previousOrigin=process.env.ADMIN_ORIGIN;process.env.ADMIN_ORIGIN=httpOrigin;
 @Module({controllers:[OrderRenewalsController],providers:[{provide:Db,useValue:f.db},{provide:USAGE_CLOCK,useValue:()=>renewalNow},OrderRenewalsService,{provide:APP_GUARD,useClass:Access}]})class RenewalHttpModule{}
 const app=await NestFactory.create(RenewalHttpModule,{logger:false});app.setGlobalPrefix('api');app.use(cookieParser());app.useGlobalFilters(new Errors());
 try{await app.listen(0,'127.0.0.1');const base=await app.getUrl();assert.equal(new URL(base).hostname,'127.0.0.1');
  const call:HttpCall=async(actor,path,body,options={})=>{assert(path.startsWith('/')&&!path.startsWith('//'));const headers:Record<string,string>={'Content-Type':'application/json'};
   if(['customer','foreign'].includes(actor))headers.authorization='Bearer renewal-http-'+actor;else if(actor!=='anonymous')headers.cookie='admin_session=renewal-http-'+actor;
   if(body!==undefined){if(options.csrf!==null)headers['x-csrf-token']=options.csrf??httpCsrf;if(options.origin!==null)headers.origin=options.origin??httpOrigin;}
   const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json(),headers:response.headers};
  };await run(f,call);
 }finally{await app.close();if(previousOrigin===undefined)delete process.env.ADMIN_ORIGIN;else process.env.ADMIN_ORIGIN=previousOrigin;}
}
export function expectHttp(result:HttpResult,status:number,code?:string){assert.equal(result.status,status,JSON.stringify(result.body));if(code)assert.equal(result.body.error?.code,code);return result.body;}
export async function createThroughHttp(f:RenewalHttpFixture,call:HttpCall){const raw=renewalPreviewInput(f),preview=expectHttp(await call('ops','/admin/orders/order/renewals/preview',raw),201),input={...raw,previewHash:preview.previewHash,idempotencyKey:'http-create-once'};const receipt=expectHttp(await call('ops','/admin/orders/order/renewals',input),201);return{receipt,input};}
export async function publishThroughHttp(f:RenewalHttpFixture,call:HttpCall){const {receipt}=await createThroughHttp(f,call),raw=renewalPreviewInput(f),preview=expectHttp(await call('ops','/admin/orders/order/renewals/preview?changeId='+receipt.id,raw),201);
 let r=expectHttp(await call('ops',`/admin/order-renewals/${receipt.id}/quotes`,{...raw,previewHash:preview.previewHash,revision:receipt.revision,idempotencyKey:'http-quote-once'}),201);
 r=expectHttp(await call('finance',`/admin/order-renewals/${receipt.id}/review`,{revision:r.revision,idempotencyKey:'http-review-once',decision:'APPROVED',note:'合成HTTP独立复核'}),201);
 r=expectHttp(await call('ops',`/admin/order-renewals/${receipt.id}/publish`,{revision:r.revision,idempotencyKey:'http-publish-once'}),201);
 const view=expectHttp(await call('customer','/customer/order-renewals/'+r.id),200);assert(view.quote,'Published customer quote missing; blockers='+JSON.stringify(view.blockers));return{receipt:r,view,confirm:{revision:r.revision,idempotencyKey:'http-confirm-once',quoteId:view.quote.id,quoteRevision:view.quote.revision,commercialHash:view.quote.commercialHash,bodyHash:view.quote.document.bodyHash,lessorHash:view.quote.lessorHash,noticeHash:view.quote.noticeHash,sharingAccepted:true}};
}
