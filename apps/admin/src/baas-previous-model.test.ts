import test from 'node:test';
import assert from 'node:assert/strict';
import {baasDraftPayload,type BaasContract} from './asset-model.ts';
import {readBaasPreviousCandidates} from './baas-previous-model.ts';
const current={id:'current',vehicleId:'v',revision:4,status:'ARCHIVED',previousContractId:null} as BaasContract;
test('optional predecessor normalizes legacy none, preserves unmodified unknown links, and changes only explicitly',()=>{
 assert.equal(baasDraftPayload({previousContractId:'无',changeReason:'修正'}, {...current,previousContractId:'old-id'}).previousContractId,null);
 assert.equal('previousContractId' in baasDraftPayload({previousContractId:'unread-current-id',effectiveFrom:'2026-10-08',changeReason:'补齐日期'}, {...current,previousContractId:'unread-current-id'}),false);
 assert.equal(baasDraftPayload({previousContractId:'target-record',changeReason:'承接'},current).previousContractId,'target-record');
 assert.equal(baasDraftPayload({previousContractId:'',changeReason:'明确独立'}, {...current,previousContractId:'old-id'}).previousContractId,null);
});
test('predecessor directory reads every vehicle-scoped page and exposes business numbers with real IDs',async()=>{
 const calls:string[]=[];const rows=Array.from({length:103},(_,index)=>({id:'record-'+index,vehicleId:'v',contractNumber:'业务编号-'+index,status:index===0?'DRAFT':'TERMINATED',activatedAt:index===0?null:'2025-01-01T00:00:00Z',provider:'出租方'}));
 const result=await readBaasPreviousCandidates(async path=>{calls.push(path);const q=new URLSearchParams(path.split('?')[1]);assert.equal(q.get('vehicleId'),'v');assert.equal(q.has('group'),false);const page=Number(q.get('page')),size=Number(q.get('pageSize'));return{items:rows.slice((page-1)*size,page*size),total:103,page,pageSize:size};},'v','record-1');
 assert.equal(calls.length,2);assert.equal(result.some(row=>row.id==='record-102'&&row.contractNumber==='业务编号-102'),true);assert.equal(result.some(row=>row.id==='record-1'||row.id==='record-0'),false);
});
test('predecessor directory rejects cross-vehicle, truncated, duplicated and changing pagination without unscoped fallback',async()=>{
 for(const mode of ['vehicle','truncated','duplicate','total']){let calls=0;await assert.rejects(readBaasPreviousCandidates(async path=>{calls++;const q=new URLSearchParams(path.split('?')[1]);assert.equal(q.get('vehicleId'),'v');const page=Number(q.get('page')),size=Number(q.get('pageSize'));const items=Array.from({length:mode==='truncated'?1:100},(_,i)=>({id:mode==='duplicate'?'same':'r-'+page+'-'+i,vehicleId:mode==='vehicle'?'other':'v',contractNumber:'B-'+i,status:'ACTIVE',activatedAt:'2026-01-01T00:00:00Z'}));return{items,total:mode==='total'&&page===2?201:200,page,pageSize:size};},'v','current'));assert(calls<=2);}
});
