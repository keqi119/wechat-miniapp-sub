import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FilesController} from '../src/files/files';
import {fileReadStore} from './file-store-fixture';
const code=(value:string)=>(error:any)=>error.getResponse?.().error?.code===value;
test('simple agreement attachments are only readable through their scoped agreement route',async()=>{
 const file={id:'file',purpose:'evidence',customerId:'customer',name:'contract.pdf',mimeType:'application/pdf',storagePath:'ignored'};
 const tx:any=fileReadStore({storedFile:{findUnique:async()=>file,findFirst:async()=>({...file,purpose:'vehicle',mimeType:'image/png',customerId:null})},partnerAgreementVersion:{count:async()=>1},vehicle:{count:async()=>1}});
 const out={setHeader(){},sendFile(){throw new Error('must not stream')}};
 const controller=new FilesController(tx);
 await assert.rejects(controller.adminRead(file.id,{admin:{id:'admin',role:'ADMIN'}},out),code('ARCHIVE_ROUTE_REQUIRED'));
 await assert.rejects(controller.customerRead(file.id,{customer:{id:'customer'}},out),code('ARCHIVE_ROUTE_REQUIRED'));
 await assert.rejects(controller.media(file.id,out),code('NOT_FOUND'));
});
