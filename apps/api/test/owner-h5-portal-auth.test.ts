import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownerH5Config} from '../src/owner-h5/config';
import {OwnerH5AuthController} from '../src/owner-h5/auth.controller';
test('portal config is independent readonly and anonymous legal never requests signing consents',async()=>{
 assert.equal(ownerH5Config().mode,'PARTNER_READONLY');
 const requested:string[]=[];const db:any={legalDocument:{findFirst:async({where}:any)=>{requested.push(where.type);return{id:where.type,type:where.type,version:1,title:'Synthetic',content:'Synthetic'};}}};
 const controller=new OwnerH5AuthController(db,{} as any);const result=await controller.legal();
 assert.deepEqual(requested,['terms','privacy']);assert.deepEqual(result.documents.map(d=>d.type),['terms','privacy']);
});
