import test from 'node:test';
import assert from 'node:assert/strict';
import {api,ApiError,type Session} from './core.ts';
import {ProductDraftCommand} from './product-editor-command.ts';
import {InsuranceRegistrationCommand} from './insurance-registration.ts';

test('session memory retains unresolved intent, clears private payloads on session/grant loss and rejects old writers',async()=>{
 const original=(globalThis as {window?:unknown}).window;
 const fake=Object.assign(new EventTarget(),{location:{hash:'#products'}});
 (globalThis as unknown as {window:unknown}).window=fake;
 try{
  const store=await import('./session-pending-intents.ts');
  const session=():Session=>({user:{id:'staff',username:'staff',role:'OPERATIONS',permissions:['*']},csrfToken:'synthetic'});
  api.setSession(session());
  const product=store.sessionPendingIntent<ProductDraftCommand,{name:string}>('products:create',()=>new ProductDraftCommand());let posts=0;
  const fail=async()=>{posts++;throw new ApiError('unknown',503);};
  await assert.rejects(store.runPendingIntent(product,{name:'private configuration'},()=>product.command.execute('/admin/products','POST',{revision:0,name:'private configuration'},undefined,fail,async()=>{})));
  store.releasePendingIntent(product);await Promise.resolve();
  const restored=store.sessionPendingIntent('products:create',()=>new ProductDraftCommand());assert.equal(restored,product);assert.equal(restored.command.phase,'unknown');assert.equal(product.snapshot?.name,'private configuration');
  const insurance=store.sessionPendingIntent<InsuranceRegistrationCommand,{files:File[]}>('insurance:create',()=>new InsuranceRegistrationCommand());const file=new File(['%PDF PRIVATE'],'保单.pdf',{type:'application/pdf'});
  await assert.rejects(store.runPendingIntent(insurance,{files:[file]},()=>insurance.command.execute('/admin/insurance-policies/registrations',{revision:0},[file],fail,async()=>{})));
  let changes=0;const observe=(event:Event)=>{changes++;assert.equal('detail' in event,false);};fake.addEventListener('admin-session-change',observe);
  api.setSession(session());assert.equal(changes,1);assert.equal(product.snapshot,undefined);assert.equal(insurance.snapshot,undefined);assert.equal(product.command.hasPending,false);assert.equal(insurance.command.hasPending,false);assert.equal(JSON.stringify(product.command).includes('private configuration'),false,'Dispose also clears the idempotency fingerprint input cache');
  const before=posts;await assert.rejects(store.runPendingIntent(product,{name:'cannot reuse'},async()=>{posts++;}));assert.equal(posts,before);
  const fresh=store.sessionPendingIntent('products:create',()=>new ProductDraftCommand());assert.notEqual(fresh,product);
  api.session!.user.permissions=['products.read'];store.synchronizePendingSession();assert.equal(store.pendingIntentCurrent(fresh),false);
  api.setSession(null);assert.equal(store.pendingIntentCurrent(insurance),false);
 }finally{api.setSession(null);if(original===undefined)delete (globalThis as {window?:unknown}).window;else(globalThis as unknown as {window:unknown}).window=original;}
});

test('disposing an in-flight command prevents its late response from rebuilding state or reading another session',async()=>{
 for(const kind of ['product','insurance']){
  let release!:(value:unknown)=>void,reads=0;const pending=new Promise(resolve=>{release=resolve;});
  if(kind==='product'){const command=new ProductDraftCommand();const promise=command.execute('/admin/products','POST',{revision:0},undefined,async()=>pending,async()=>{reads++;});command.dispose();release({productId:'old'});await assert.rejects(promise,/原命令已清理/);assert.equal(command.hasPending,false);assert.equal(command.phase,'idle');}
  else{const command=new InsuranceRegistrationCommand();const promise=command.execute('/admin/insurance-policies/registrations',{revision:0},[],async()=>pending as Promise<{id:string}>,async()=>{reads++;});command.dispose();release({id:'old'});await assert.rejects(promise,/原命令已清理/);assert.equal(command.hasPending,false);assert.equal(command.phase,'idle');}
  assert.equal(reads,0);
 }
});
