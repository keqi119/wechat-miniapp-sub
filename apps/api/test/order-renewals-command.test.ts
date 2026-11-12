import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renewalTransaction} from '../src/order-renewals/service';
test('only the exact command unique race retries the whole renewal transaction once',async()=>{
 let calls=0;const error={code:'P2002',meta:{modelName:'ArchiveCommand',target:['actorId','resourceId','action','key']}};
 const db:any={serial:async(fn:any)=>{calls++;if(calls===1)throw error;return fn({replayed:true});}};assert.equal(await renewalTransaction(db,async tx=>tx.replayed),true);assert.equal(calls,2);
 for(const err of [{code:'P2002',meta:{modelName:'Vehicle',target:['actorId','resourceId','action','key']}},{code:'P2002',meta:{target:['orderId']}},new Error('unknown database fault')]){let attempts=0;await assert.rejects(renewalTransaction({serial:async()=>{attempts++;throw err;}} as any,async()=>true),(e:any)=>e===err);assert.equal(attempts,1);}
 let twice=0;await assert.rejects(renewalTransaction({serial:async()=>{twice++;throw error;}} as any,async()=>true),(e:any)=>e===error);assert.equal(twice,2);
});
