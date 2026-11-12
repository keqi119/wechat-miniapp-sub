import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalHash} from '../src/customers/types';
import {assertRenewalCancellationTiming,buildRenewalCancellationMutualAgreement} from '../src/order-renewals/cancellation-timing';

const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
const required=code('RENEWAL_CANCELLATION_AGREEMENT_REQUIRED'),invalid=code('RENEWAL_CANCELLATION_AGREEMENT_INVALID');
const before=new Date('2026-11-30T15:59:59.999Z'),after=new Date('2026-12-01T03:00:00Z'),startDate='2026-12-01';
function fixture(){
 const sourceSnapshot={version:1,facts:{frozenQuoteSource:{commercialHash:'c'.repeat(64)}},cancellationPaper:{version:1}},file={id:'mutual-proof',adminId:'operator',customerId:null,fieldTaskId:null,purpose:'evidence',size:400,mimeType:'application/pdf',sha256:'a'.repeat(64)};
 const record:any={id:'cancel',orderId:'order',customerId:'customer',ownerId:'owner',changeId:'change',quoteId:'quote',status:'OPEN',sourceSnapshot,sourceHash:canonicalHash(sourceSnapshot),mutuallyAgreedAt:null,mutualAgreementVerifiedBy:null,mutualAgreementVerifiedAt:null,mutualAgreementEvidenceFileIds:[],mutualAgreementNote:null,mutualAgreementHash:null,createdAt:before};
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},storedFile:{findMany:async()=>[file]}};
 const input={startDate,mutuallyAgreedAt:'2026-11-30T23:30:00+08:00',evidenceFileIds:[file.id],note:'运营核实客户与出租方有权代表已于所记时刻共同同意取消，附件为完整确认记录。'};
 return{tx,file,record,input,actor:{id:'operator',role:'OPERATIONS',authVersion:0}};
}
test('Shanghai midnight is the boundary; an OPEN case or signature timestamp never proves mutual agreement',async()=>{
 const f=fixture();assert.equal(await assertRenewalCancellationTiming(f.tx,null,startDate,before),null);
 assert.equal(await assertRenewalCancellationTiming(f.tx,f.record,startDate,before),null);
 f.record.signatureState='SIGNED';f.record.signatureVerifiedAt=before;
 await assert.rejects(assertRenewalCancellationTiming(f.tx,f.record,startDate,new Date('2026-11-30T16:00:00Z')),required);
 await assert.rejects(assertRenewalCancellationTiming(f.tx,null,startDate,after),required);
});
test('actual pre-start agreement can be evidenced later and keeps the original source immutable',async()=>{
 const f=fixture(),original=structuredClone(f.record),data=await buildRenewalCancellationMutualAgreement(f.tx,f.record,f.input,f.actor,after);
 assert.deepEqual(f.record,original);Object.assign(f.record,data);
 const proof=await assertRenewalCancellationTiming(f.tx,f.record,startDate,after);
 assert.equal(proof?.mutuallyAgreedAt,'2026-11-30T15:30:00.000Z');assert.equal(proof?.verifiedAt,after.toISOString());assert.equal(proof?.hash,data.mutualAgreementHash);assert.equal(proof?.sourceHash,original.sourceHash);
 await assert.rejects(buildRenewalCancellationMutualAgreement(f.tx,f.record,f.input,f.actor,after),invalid,'mutual agreement is once-only; existing confirmation cannot be silently replaced');
});
test('at-start, future, offset-free and malformed timestamps cannot backdate a cancellation',async()=>{
 for(const at of ['2026-12-01T00:00:00+08:00','2026-12-01T03:01:00Z','2026-11-30T23:30:00','2026-02-30T00:00:00Z','invalid']){const f=fixture();await assert.rejects(buildRenewalCancellationMutualAgreement(f.tx,f.record,{...f.input,mutuallyAgreedAt:at},f.actor,after),invalid);}
 const f=fixture();await assert.rejects(buildRenewalCancellationMutualAgreement(f.tx,f.record,f.input,f.actor,new Date('2026-11-30T15:00:00Z')),invalid);
 await assert.rejects(assertRenewalCancellationTiming(f.tx,f.record,'2026-02-30',after),invalid);
});
test('mutual proof is tied to exact case, quote, immutable source, verifier and file bytes',async()=>{
 const f=fixture();Object.assign(f.record,await buildRenewalCancellationMutualAgreement(f.tx,f.record,f.input,f.actor,after));
 for(const patch of [{quoteId:'foreign'},{sourceHash:'f'.repeat(64)},{mutuallyAgreedAt:new Date('2026-11-29')},{mutualAgreementVerifiedBy:'other'},{mutualAgreementNote:'rewritten'},{mutualAgreementEvidenceFileIds:[]},{mutualAgreementHash:'f'.repeat(64)}])await assert.rejects(assertRenewalCancellationTiming(f.tx,{...f.record,...patch},startDate,after),invalid);
 f.file.sha256='b'.repeat(64);await assert.rejects(assertRenewalCancellationTiming(f.tx,f.record,startDate,after),invalid);
});
test('all fields must be present together and a future verification time cannot authorize continuation',async()=>{
 const f=fixture();for(const patch of [{mutuallyAgreedAt:before},{mutualAgreementEvidenceFileIds:[f.file.id]},{mutualAgreementHash:'f'.repeat(64)}])await assert.rejects(assertRenewalCancellationTiming(f.tx,{...f.record,...patch},startDate,before),invalid);
 Object.assign(f.record,await buildRenewalCancellationMutualAgreement(f.tx,f.record,f.input,f.actor,after));await assert.rejects(assertRenewalCancellationTiming(f.tx,f.record,startDate,before),invalid);
});
test('new proof requires the current operator own private evidence, and never accepts asset files or client hashes',async()=>{
 for(const patch of [{adminId:'other'},{customerId:'customer'},{fieldTaskId:'task'},{purpose:'vehicle'},{size:0},{size:11*1024*1024},{mimeType:'text/html'},{sha256:'bad'}]){const f=fixture();Object.assign(f.file,patch);await assert.rejects(buildRenewalCancellationMutualAgreement(f.tx,f.record,f.input,f.actor,after),invalid);}
 const f=fixture();f.tx.assetPrivateFile.count=async()=>1;await assert.rejects(buildRenewalCancellationMutualAgreement(f.tx,f.record,f.input,f.actor,after),code('ASSET_FILE_ROUTE_REQUIRED'));
});
test('unknown evidence storage errors propagate and completed cases cannot acquire new agreement evidence',async()=>{
 const f=fixture(),failure=new Error('evidence-storage-failed');f.tx.storedFile.findMany=async()=>{throw failure;};await assert.rejects(buildRenewalCancellationMutualAgreement(f.tx,f.record,f.input,f.actor,after),e=>e===failure);
 f.record.status='COMPLETED';await assert.rejects(buildRenewalCancellationMutualAgreement(f.tx,f.record,f.input,f.actor,after),invalid);
});
