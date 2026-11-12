import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Db} from '../src/common/db';
test('serial transactions retry only recognized serialization and deadlock failures including raw row locks',async()=>{
 for(const error of [{code:'P2034'},{code:'P2010',meta:{code:'40001'}},{code:'P2010',meta:{code:'40P01'}}]){
  let calls=0;const db:any={$transaction:async(fn:any)=>{if(++calls<3)throw error;return fn({});}};
  assert.equal(await Db.prototype.serial.call(db,async()=>42),42);assert.equal(calls,3);
 }
 for(const error of [{code:'P2002'},{code:'P2010',meta:{code:'23514'}},{code:'P2010'},{code:'TIMEOUT'}]){
  let calls=0;const db:any={$transaction:async()=>{calls++;throw error;}};await assert.rejects(Db.prototype.serial.call(db,async()=>42),e=>e===error);assert.equal(calls,1);
 }
 let calls=0;const last={code:'P2010',meta:{code:'40001'}};await assert.rejects(Db.prototype.serial.call({$transaction:async()=>{calls++;throw last;}} as any,async()=>42),e=>e===last);assert.equal(calls,5);
});
