import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RealIdentityGateway} from '../src/integrations/identity';

const error=(code:string)=>(value:any)=>value.getResponse?.().error?.code===code;
function fixture(){
 let now=Date.parse('2026-10-28T08:00:00Z');
 const rows:any[]=[],sent:{mobile:string;code:string}[]=[];
 const matches=(row:any,where:any)=>Object.entries(where||{}).every(([key,value]:any)=>typeof value==='object'&&value?.gt?row[key]>value.gt:row[key]===value);
 const table={
  findFirst:async({where}:any)=>rows.filter(row=>matches(row,where)).sort((a,b)=>b.sentAt-a.sentAt)[0]||null,
  findUnique:async({where}:any)=>rows.find(row=>row.id===where.id)||null,
  count:async({where}:any)=>rows.filter(row=>matches(row,where)).length,
  create:async({data}:any)=>{const row={attempts:0,consumedAt:null,...data};rows.push(row);return row;},
  updateMany:async({where,data}:any)=>{const found=rows.filter(row=>matches(row,where));found.forEach(row=>Object.assign(row,data));return{count:found.length};},
  update:async({where,data}:any)=>{const row=rows.find(row=>row.id===where.id);for(const [key,value] of Object.entries(data) as any)row[key]=value?.increment?row[key]+value.increment:value;return row;}
 };
 const db:any={smsChallenge:table,serial:async(fn:any)=>fn(db)};
 const gateway:any=new RealIdentityGateway(db,{appId:'',secret:'',smsEnabled:true,smsHashSecret:'synthetic-challenge-test-secret-00000000'},async()=>{throw new Error('no network');},async(mobile,code)=>{sent.push({mobile,code});},()=>now);
 return{gateway,rows,sent,advance:()=>{now+=61000;}};
}

test('a portal OTP validates the issued SMS challenge, never the latest code for a phone',async()=>{
 const f=fixture();
 assert.equal(typeof f.gateway.requestSmsChallenge,'function');
 assert.equal(typeof f.gateway.verifySmsChallenge,'function');
 const first=await f.gateway.requestSmsChallenge('13800000001');f.advance();
 const second=await f.gateway.requestSmsChallenge('13800000001');
 assert.notEqual(first.challengeId,second.challengeId);
 await assert.rejects(f.gateway.verifySmsChallenge({challengeId:first.challengeId,mobile:'13800000001',code:f.sent[1].code}),error('SMS_CODE_INVALID'));
 assert.equal(f.rows[1].consumedAt,null);
 await assert.rejects(f.gateway.verifySmsChallenge({challengeId:second.challengeId,mobile:'13800000002',code:f.sent[1].code}),error('SMS_CODE_INVALID'));
 assert.equal((await f.gateway.verifySmsChallenge({challengeId:second.challengeId,mobile:'13800000001',code:f.sent[1].code})).mobile,'13800000001');
 await assert.rejects(f.gateway.verifySmsChallenge({challengeId:second.challengeId,mobile:'13800000001',code:f.sent[1].code}),error('SMS_CODE_INVALID'));
});

test('failed exact-challenge attempts are committed and lock out the correct code',async()=>{
 const f=fixture();assert.equal(typeof f.gateway.requestSmsChallenge,'function');
 const {challengeId}=await f.gateway.requestSmsChallenge('13800000003');
 const wrong=f.sent[0].code==='999999'?'000000':'999999';
 for(let i=0;i<5;i++)await assert.rejects(f.gateway.verifySmsChallenge({challengeId,mobile:'13800000003',code:wrong}),error('SMS_CODE_INVALID'));
 assert.equal(f.rows[0].attempts,5);
 await assert.rejects(f.gateway.verifySmsChallenge({challengeId,mobile:'13800000003',code:f.sent[0].code}),error('SMS_CODE_INVALID'));
});
