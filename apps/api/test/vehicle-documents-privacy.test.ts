import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FilesController} from '../src/files/files';
import {assertNotAssetFiles} from '../src/files/asset-files';
import {fileReadStore} from './file-store-fixture';
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
test('vehicle original mappings deny general admin/customer/public and cross-domain references even with corrupt purpose',async()=>{
 const file={id:'original',purpose:'vehicle',mimeType:'image/png',customerId:'customer'};
 const db:any=fileReadStore({storedFile:{findUnique:async()=>file,findFirst:async()=>({...file,customerId:null})},vehicleDocumentFile:{count:async()=>1},vehicle:{count:async()=>1}});
 const c=new FilesController(db),response={setHeader(){},sendFile(){throw Error('private original escaped');}};
 await assert.rejects(c.adminRead('original',{admin:{id:'admin',role:'ADMIN'}},response),code('VEHICLE_DOCUMENT_ROUTE_REQUIRED'));
 await assert.rejects(c.customerRead('original',{customer:{id:'customer'}},response),code('VEHICLE_DOCUMENT_ROUTE_REQUIRED'));
 await assert.rejects(c.media('original',response),code('NOT_FOUND'));
 await assert.rejects(assertNotAssetFiles(db,['original']),code('VEHICLE_DOCUMENT_ROUTE_REQUIRED'));
});
test('vehicle-document purpose fails closed before unrelated mapping lookups',async()=>{
 const c=new FilesController({storedFile:{findUnique:async()=>({purpose:'vehicle-document'})}} as any);
 for(const method of ['adminRead','customerRead'] as const)await assert.rejects(c[method]('file',{},{}),code('VEHICLE_DOCUMENT_ROUTE_REQUIRED'));
});
