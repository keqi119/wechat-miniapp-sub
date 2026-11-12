import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';

const denied=(error:any)=>error.getStatus?.()===403&&error.getResponse?.().error?.code==='ASSET_FILE_ROUTE_REQUIRED';
test('signing artifact reads reject mapped asset PDFs before reading metadata or bytes',async()=>{
 const queries:any[]=[],reads:string[]=[];
 const db:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async(query:any)=>{queries.push(query);return 1;}},storedFile:{findUnique:async()=>{reads.push('metadata');return null;}}};
 await assert.rejects(new ContractPdfArtifactWriterService(db).readVerified('asset-file','a'.repeat(64)),denied);
 assert.deepEqual(queries,[{where:{fileId:{in:['asset-file']}}}]);
 assert.deepEqual(reads,[]);
});
test('handover PDF rejects a historically injected asset image before rendering or loading files',async()=>{
 const queries:any[]=[],reads:string[]=[];
 const db:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async(query:any)=>{queries.push(query);return 1;}},storedFile:{findMany:async()=>{reads.push('files');return[];}}};
 await assert.rejects((new ContractPdfArtifactWriterService(db) as any).renderHandover({fileIds:['ordinary-photo','asset-photo']},{},{},undefined),denied);
 assert.deepEqual(queries,[{where:{fileId:{in:['ordinary-photo','asset-photo']}}}]);
 assert.deepEqual(reads,[]);
});
