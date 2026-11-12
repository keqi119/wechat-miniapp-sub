import test from 'node:test';import assert from 'node:assert/strict';
import {readExitEvidence} from '../src/orders/exit-evidence';
test('exit evidence is bound to one stored agreement and readable only to current operations/admin',async()=>{
 const proof={id:'file',sha256:'a'.repeat(64),adminId:'maker',customerId:null},actor={id:'operator',role:'OPERATIONS',authVersion:1},record={id:'case',proposal:{evidence:[proof]}};
 const tx:any={adminUser:{findUnique:async()=>({...actor,active:true})},orderPreDeliveryCancellation:{findUnique:async()=>record},orderTermination:{findUnique:async()=>record},storedFile:{findUnique:async()=>({...proof,purpose:'evidence',storagePath:'synthetic',mimeType:'application/pdf'})}};
 assert.equal((await readExitEvidence(tx,'cancellation04','case','file',actor)).id,'file');assert.equal((await readExitEvidence(tx,'termination','case','file',actor)).id,'file');
 await assert.rejects(readExitEvidence(tx,'termination','case','foreign',actor));await assert.rejects(readExitEvidence(tx,'termination','case','file',{...actor,role:'FINANCE'}));tx.storedFile.findUnique=async()=>({...proof,sha256:'b'.repeat(64),purpose:'evidence'});await assert.rejects(readExitEvidence(tx,'termination','case','file',actor));
});
