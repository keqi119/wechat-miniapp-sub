import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {residualImportJson} from '../src/residual-market/import-transport';

test('large CSV JSON parsing is restricted to the exact import routes and keeps bounded errors',async()=>{
 const app=express();app.use(residualImportJson());app.use(express.json());
 app.post(['/api/admin/residual-imports','/api/admin/residual-imports/preview','/api/admin/ordinary'],(req,res)=>{res.json({length:req.body.csvText?.length||0});});
 app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(error.getStatus?.()||error.status||500).json({code:error.getResponse?.().error?.code||error.type});});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 try{
  const address=server.address();assert(address&&typeof address==='object');const origin=`http://127.0.0.1:${address.port}`;
  const post=(path:string,body:string)=>fetch(origin+path,{method:'POST',headers:{'content-type':'application/json'},body});
  const large=JSON.stringify({csvText:'x'.repeat(160000)});
  for(const path of ['/api/admin/residual-imports','/api/admin/residual-imports/preview']){const response=await post(path,large);assert.equal(response.status,200);assert.equal((await response.json()).length,160000);}
  const ordinary=await post('/api/admin/ordinary',large);assert.equal(ordinary.status,413);
  const malformed=await post('/api/admin/residual-imports/preview','{invalid');assert.equal(malformed.status,400);assert.equal((await malformed.json()).code,'CSV_REQUEST_INVALID');
  const tooLarge=await post('/api/admin/residual-imports',JSON.stringify({csvText:'x'.repeat(13*1024*1024)}));assert.equal(tooLarge.status,413);assert.equal((await tooLarge.json()).code,'CSV_REQUEST_SIZE_LIMIT');
 }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
