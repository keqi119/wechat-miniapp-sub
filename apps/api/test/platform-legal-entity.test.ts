import './legacy-esign-mode';
import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import {validateConfig} from '../src/common/config';
import {EnterpriseSealController} from '../src/esign/esign.controller';
import {renderTechnicalPdf} from '../src/technical-acceptance/pdf';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
import {hash} from '../src/common/data';

const ninda='上海宁达信息科技有限公司',legacy='上海晓浪网络科技有限公司';
const code=(expected:string)=>(error:any)=>error.getResponse?.().error?.code===expected;
async function environment(values:Record<string,string|undefined>,action:()=>unknown|Promise<unknown>){
 const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
 for(const[key,value]of Object.entries(values))if(value===undefined)delete process.env[key];else process.env[key]=value;
 try{return await action();}finally{for(const[key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
}

test('production fails before startup when its legal entity is missing instead of inheriting the old signer',()=>environment({NODE_ENV:'production',PLATFORM_LEGAL_ENTITY_NAME:undefined,PLATFORM_API_ORIGIN:'https://api.evsub.ndacar.com',H5_SIGNING_ORIGIN:'https://sign.evsub.ndacar.com',ADMIN_ORIGIN:'https://admin.evsub.ndacar.com',DATABASE_URL:'postgresql://localhost/synthetic_test',JWT_SECRET:'a'.repeat(40),SESSION_SECRET:'b'.repeat(40)},()=>{
 assert.throws(()=>validateConfig(),code('PLATFORM_LEGAL_ENTITY_INVALID'));
 process.env.PLATFORM_LEGAL_ENTITY_NAME=ninda;
 assert.doesNotThrow(()=>validateConfig());
 for(const value of ['', ' ', '待确认企业', ninda+'\n其他主体']){process.env.PLATFORM_LEGAL_ENTITY_NAME=value;assert.throws(()=>validateConfig(),code('PLATFORM_LEGAL_ENTITY_INVALID'));}
}));

test('seal registration permits only the current legal entity and still creates an unapproved draft',()=>environment({PLATFORM_LEGAL_ENTITY_NAME:ninda},async()=>{
 const records:any[]=[];
 const db:any={storedFile:{count:async()=>1},enterpriseSeal:{create:async({data}:any)=>{const item={id:'synthetic-seal',...data};records.push(item);return item;}},auditLog:{create:async()=>({})}};
 const controller=new EnterpriseSealController(db,{} as any),request={admin:{id:'requester',role:'ADMIN'}};
 const input={sealName:'企业章',organizationName:legacy,providerCustomerId:'synthetic-provider',providerSignatureId:'synthetic-signature',evidenceFileId:'synthetic-proof'};
 await assert.rejects(controller.create(request,input));
 assert.equal(records.length,0);
 const result=await controller.create(request,{...input,organizationName:ninda});
 assert.equal(result.organizationName,ninda);assert.equal(result.status,'DRAFT');assert.equal(result.confirmedBy,'requester');
}));

test('activation rechecks the legal entity even when a legacy draft matches the retained provider IDs',()=>environment({PLATFORM_LEGAL_ENTITY_NAME:ninda},async()=>{
 let changes=0;
 const seal={id:'synthetic-seal',status:'DRAFT',organizationName:legacy,confirmedBy:'requester',providerCustomerId:'retained-provider',providerSignatureId:'retained-signature'};
 const db:any={enterpriseSeal:{findUnique:async()=>seal,update:async()=>{changes++;return seal;}},auditLog:{create:async()=>({})}};
 const controller=new EnterpriseSealController(db,{platformCustomerId:'retained-provider',platformSignatureId:'retained-signature'} as any);
 await assert.rejects(controller.activate(seal.id,{admin:{id:'reviewer',role:'ADMIN'}},{identityConfirmed:true}),code('SEAL_LEGAL_ENTITY'));
 assert.equal(changes,0);
}));

test('new technical PDFs identify the configured platform and refuse an approved legacy body',()=>environment({PLATFORM_LEGAL_ENTITY_NAME:ninda},async()=>{
 const printed:string[]=[];const original=PDFDocument.prototype.text;
 PDFDocument.prototype.text=function(text:any,...args:any[]){printed.push(String(text));return(original as any).call(this,text,...args);};
 try{
  const result=await renderTechnicalPdf('# 技术验证\n甲方：'+ninda,'C:/Windows/Fonts/simhei.ttf');
  assert.equal(result.buffer.subarray(0,5).toString(),'%PDF-');
  assert.ok(printed.includes(ninda+'企业签章'));assert.ok(!printed.some(value=>value.includes(legacy)));
  await assert.rejects(renderTechnicalPdf('# 技术验证\n甲方：'+legacy,'C:/Windows/Fonts/simhei.ttf'),code('LEGAL_ENTITY_MISMATCH'));
 }finally{PDFDocument.prototype.text=original;}
}));

test('an existing technical PDF with valid hashes cannot bypass the deployment entity check',()=>environment({PLATFORM_LEGAL_ENTITY_NAME:ninda},async()=>{
 const body='甲方：'+legacy,record={id:'technical-old',customerId:'synthetic',status:'DRAFT',confirmedAt:new Date(),body,bodyHash:hash(body),documentHash:'a'.repeat(64),sourceFileId:'old-pdf',sourcePdfHash:'b'.repeat(64),slotCoordinates:[]};
 let reads=0;const writer=new ContractPdfArtifactWriterService({storedFile:{findUniqueOrThrow:async()=>({id:'old-pdf'})}} as any);
 writer.resource=async()=>record;writer.readVerified=async()=>{reads++;return Buffer.from('%PDF-old');};
 await assert.rejects(writer.prepare('TECHNICAL_ACCEPTANCE',record.id,{} as any),code('LEGAL_ENTITY_MISMATCH'));
 assert.equal(reads,0);
}));
