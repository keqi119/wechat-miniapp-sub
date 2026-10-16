import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotUsagePolicy, usagePolicyAppendix } from '../src/usage/policy';
test('new final plans require approved published usage text and freeze exact content plus rules',async()=>{
 const doc={id:'legal-policy',type:'usage-policy',version:1,content:'已批准规则全文',status:'PUBLISHED',confirmedAt:new Date(),confirmedBy:'operator'};
 await assert.rejects(()=>snapshotUsagePolicy({legalDocument:{findFirst:async()=>null}} as any));
 const snapshot=await snapshotUsagePolicy({legalDocument:{findFirst:async()=>doc}} as any);
 assert.equal(snapshot.documentId,doc.id);assert.equal(snapshot.content,doc.content);assert.equal(snapshot.baseAllowanceKm,1500);assert.equal(snapshot.excessPriceAmount,150);
 assert.ok(usagePolicyAppendix(snapshot).includes(doc.content));
 assert.throws(()=>usagePolicyAppendix({...snapshot,content:'篡改文本'}));
});
