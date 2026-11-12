import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OwnerH5AuthController} from '../src/owner-h5/auth.controller';

type LegalFixture={id:string;type:string;version:number;title:string;content:string;status:string;confirmedAt:Date|null;confirmedBy:string|null;internalNote:string};
const document=(type:string,overrides:Partial<LegalFixture>={}):LegalFixture=>({id:`document-${type}`,type,version:1,title:`Synthetic ${type}`,content:`Synthetic ${type} text`,status:'PUBLISHED',confirmedAt:new Date('2026-01-01T00:00:00Z'),confirmedBy:'synthetic-reviewer',internalNote:'must-not-be-public',...overrides});
function controller(documents:LegalFixture[]){
 const db:any={legalDocument:{findFirst:async(query:any)=>{
  assert.equal(query.where.status,'PUBLISHED','public legal reads must filter published documents');
  assert.deepEqual(query.where.confirmedAt,{not:null},'public legal reads must require confirmation');
  assert.deepEqual(query.orderBy,{version:'desc'});
  return documents.filter(doc=>doc.type===query.where.type&&doc.status===query.where.status&&doc.confirmedAt!==null&&(!query.where.confirmedBy||doc.confirmedBy!==null)).sort((a,b)=>b.version-a.version)[0]||null;
 }}};
 const identity:any=new Proxy({}, {get(){throw Error('Legal bootstrap must not call identity providers');}});
 return new OwnerH5AuthController(db,identity);
}
async function inMode<T>(mode:'OFFLINE'|'ESIGN'|undefined,work:()=>Promise<T>){
 const before=process.env.NEW_ORDER_CONTRACT_MODE;
 if(mode===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=mode;
 try{return await work();}finally{if(before===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=before;}
}
const legalUnavailable=(error:any)=>error.getResponse?.().error?.code==='LEGAL_UNAVAILABLE';
const base=()=>[document('terms'),document('privacy')];

test('OFFLINE owner login legal bootstrap works with only approved terms and privacy',async()=>{
 await inMode('OFFLINE',async()=>{
  const result=await controller(base()).legal();
  assert.deepEqual(result.documents.map(doc=>doc.type),['terms','privacy']);
  assert.ok(result.documents.every(doc=>!('confirmedBy' in doc)&&!('internalNote' in doc)));
 });
});

test('OFFLINE legal bootstrap does not expose legacy electronic signing documents even when present',async()=>{
 await inMode('OFFLINE',async()=>{
  const result=await controller([...base(),...['owner-identity','owner-auto-sign','owner-rental-contract','owner-authorization-letter'].map(type=>document(type))]).legal();
  assert.deepEqual(result.documents.map(doc=>doc.type),['terms','privacy']);
 });
});

test('unset contract mode keeps the default OFFLINE legal bootstrap independent of owner identity text',async()=>{
 await inMode(undefined,async()=>{
  const result=await controller(base()).legal();
  assert.deepEqual(result.documents.map(doc=>doc.type),['terms','privacy']);
 });
});

test('OFFLINE still rejects missing, unpublished or unconfirmed required customer legal documents',async()=>{
 await inMode('OFFLINE',async()=>{
  for(const type of ['terms','privacy']){
   for(const invalid of ['missing','draft','unconfirmed']){
    const docs=base().filter(doc=>doc.type!==type);
    if(invalid!=='missing')docs.push(document(type,invalid==='draft'?{status:'DRAFT'}:{confirmedAt:null}));
    await assert.rejects(controller(docs).legal(),legalUnavailable,`${type}: ${invalid}`);
   }
  }
 });
});

test('legacy ESIGN flags cannot add an identity-document prerequisite to the readonly portal login',async()=>{
 await inMode('ESIGN',async()=>{
  assert.deepEqual((await controller(base()).legal()).documents.map(doc=>doc.type),['terms','privacy']);
  assert.deepEqual((await controller([...base(),document('owner-identity',{confirmedAt:null})]).legal()).documents.map(doc=>doc.type),['terms','privacy']);
 });
});

test('readonly portal bootstrap excludes all legacy signing documents even with ESIGN flags and published copies',async()=>{
 await inMode('ESIGN',async()=>{
  const optional=['owner-auto-sign','owner-rental-contract','owner-authorization-letter'];
  const docs=[...base(),document('owner-identity'),...optional.flatMap(type=>[
   document(type),document(type,{id:`draft-${type}`,version:2,status:'DRAFT'}),document(type,{id:`unconfirmed-${type}`,version:3,confirmedAt:null}),document(type,{id:`unreviewed-${type}`,version:4,confirmedBy:null})
  ])];
  const result=await controller(docs).legal();
  assert.deepEqual(result.documents.map(doc=>doc.type),['terms','privacy']);
  assert.ok(result.documents.every(doc=>doc.version===1));
  assert.ok(result.documents.every(doc=>!('confirmedBy' in doc)&&!('internalNote' in doc)));
 });
});

test('readonly login terms remain sufficient when no legacy signing templates exist',async()=>{
 await inMode('ESIGN',async()=>{
  const result=await controller([...base(),document('owner-identity')]).legal();
  assert.deepEqual(result.documents.map(doc=>doc.type),['terms','privacy']);
 });
});
