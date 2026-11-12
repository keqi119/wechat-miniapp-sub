import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {refundStaff} from '../src/billing/refund-execution';

function fixture(role='FINANCE',personId:string|null='reviewer-person'){
 const reviewer={id:'reviewer',role,active:true,authVersion:1,staffPersonId:personId};
 const maker={id:'maker',role:'ADMIN',active:true,authVersion:1,staffPersonId:'maker-person'};
 const rows=[reviewer,maker];
 const tx={adminUser:{
  findUnique:async({where}:any)=>rows.find(row=>row.id===where.id),
  findUniqueOrThrow:async({where}:any)=>{const row=rows.find(row=>row.id===where.id);assert.ok(row);return row;},
  findMany:async({where}:any)=>rows.filter(row=>where.id.in.includes(row.id)),
 }};
 return{tx,reviewer,maker};
}

test('unverified refund reviewers receive actionable identity guidance for both finance and admin',async()=>{
 for(const role of ['FINANCE','ADMIN']){
  const f=fixture(role,null);
  await assert.rejects(refundStaff(f.tx,f.reviewer,f.maker.id),(error:any)=>{
   assert.equal(error.getStatus(),409);
   const detail=error.getResponse().error;
   assert.equal(detail.code,'STAFF_PERSON_UNVERIFIED');
   assert.match(detail.message,/实际人员.*核实/);
   assert.match(detail.message,/人员管理/);
   assert.match(detail.message,/重新登录/);
   return true;
  });
 }
});

test('refund review still rejects the applicant and another account belonging to that person',async()=>{
 const f=fixture('ADMIN','maker-person');
 const dual=(error:any)=>error.getResponse().error.code==='DUAL_APPROVAL';
 await assert.rejects(refundStaff(f.tx,f.maker,f.maker.id),dual);
 await assert.rejects(refundStaff(f.tx,f.reviewer,f.maker.id),dual);
});

test('verified distinct refund reviewer passes while stale sessions and non-financial roles remain blocked',async()=>{
 const f=fixture();
 assert.equal((await refundStaff(f.tx,f.reviewer,f.maker.id)).id,f.reviewer.id);
 await assert.rejects(refundStaff(f.tx,{...f.reviewer,authVersion:0},f.maker.id),(error:any)=>error.getResponse().error.code==='STAFF_SESSION_CHANGED');
 const operations=fixture('OPERATIONS');
 await assert.rejects(refundStaff(operations.tx,operations.reviewer,operations.maker.id),(error:any)=>error.getResponse().error.code==='FORBIDDEN');
});
