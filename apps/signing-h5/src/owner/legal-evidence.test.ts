import test from 'node:test';
import assert from 'node:assert/strict';
import {BoundEvidenceReader,evidenceSelection,evidencePreviewMatches} from './legal-evidence.ts';
const selection=(extra={})=>evidenceSelection({ownerId:'company',sessionBinding:'session',taskId:'task',taskRevision:2,sourceHash:'source',grantId:'grant',grantRevision:4,grantSourceHash:'grant-source',fileId:'A',...extra});
function deferred(){let resolve!:(blob:Blob)=>void;const promise=new Promise<Blob>(done=>resolve=done);return{promise,resolve};}
test('fix1 late original A cannot become proof for B or ABA selections',async()=>{
 const reader=new BoundEvidenceReader(),a=selection(),b=selection({fileId:'B'}),pending=deferred();reader.select(a);
 const result=reader.read(a,()=>pending.promise);reader.select(b);reader.select(a);pending.resolve(new Blob(['original A']));
 assert.equal(await result,null);
});
test('fix1 original proof loses validity on task/source/grant/session changes and confirms only matching bytes',async()=>{
 for(const change of [{taskRevision:3},{sourceHash:'changed'},{grantRevision:5},{grantSourceHash:'changed'},{sessionBinding:'other'},{ownerId:'other'}]){
 const reader=new BoundEvidenceReader(),a=selection(),pending=deferred();reader.select(a);const result=reader.read(a,()=>pending.promise);reader.select(selection(change));pending.resolve(new Blob(['A']));assert.equal(await result,null);
 }
 const reader=new BoundEvidenceReader(),key=selection();reader.select(key);const proof=await reader.read(key,async()=>new Blob(['current original']));assert.ok(proof);assert.equal(evidencePreviewMatches(proof,key,proof.sha256),true);assert.equal(evidencePreviewMatches(proof,selection({fileId:'B'}),proof.sha256),false);assert.equal(evidencePreviewMatches(proof,key,'wrong-hash'),false);
});

test('fix1 resolved B remains the only current proof when older A completes last',async()=>{
 const reader=new BoundEvidenceReader(),a=selection(),b=selection({fileId:'B'}),pendingA=deferred(),pendingB=deferred();
 reader.select(a);const readA=reader.read(a,()=>pendingA.promise);reader.select(b);const readB=reader.read(b,()=>pendingB.promise);
 pendingB.resolve(new Blob(['actual B']));const proofB=await readB;assert.ok(proofB);assert.equal(evidencePreviewMatches(proofB,b,proofB.sha256),true);
 pendingA.resolve(new Blob(['old A']));assert.equal(await readA,null);assert.equal(evidencePreviewMatches(proofB,b,proofB.sha256),true);
});

test('fix1 a completed original preview cannot be reconfirmed after its selection is invalidated and restored',async()=>{
 const reader=new BoundEvidenceReader(),key=selection();reader.select(key);const proof=await reader.read(key,async()=>new Blob(['original']));assert.ok(proof);assert.equal(reader.matches(proof,key,proof.sha256),true);
 reader.select(selection({fileId:'B'}));reader.select(key);assert.equal(reader.matches(proof,key,proof.sha256),false);
 const fresh=await reader.read(key,async()=>new Blob(['fresh original']));assert.ok(fresh);reader.invalidate();assert.equal(reader.matches(fresh,key,fresh.sha256),false);
});
