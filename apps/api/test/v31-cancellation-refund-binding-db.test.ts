import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {cancellationFixture} from './v31-cancellation-fixture';

test('04 refund SQL binding rejects incomplete, wrong-case/source/payment/customer and preserves an exact pair',async()=>{
 const db=new Db(),mode=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
 try{
  const {f,sub,payment,evidence,service,input}=await cancellationFixture(db),at=new Date(Date.now()-10000).toISOString();
  const intent=(subjectId:string)=>({subjectId,personName:'合成有权本人',personReference:'external-'+randomUUID(),intention:'三方真实合意全退原付款10000分',occurredAt:at,fileIds:[evidence.id],authorityFrom:new Date(Date.now()-86400000).toISOString(),authorityUntil:new Date(Date.now()+86400000).toISOString(),authorityScope:'本单解除及金额确认',authorityFileIds:[evidence.id]});
  const proposed:any=await service.propose(sub.order.id,{...input,earlierAgreement:{customer:intent(sub.customer.id),owner:intent(f.owner.id),platform:intent(f.platform.id),amountConfirmedAt:at,confirmedNetRefundAmount:10000,terms:'合成原始三方解除并明确全额退款'}},f.actor);
  await service.review(proposed.id,{revision:proposed.revision,idempotencyKey:randomUUID(),decision:'VERIFIED',note:'核验三方原始合意'},f.actor);
  const data=()=>({paymentId:payment.id,customerId:sub.customer.id,amount:1,reason:'synthetic SQL binding test',requestedBy:f.actor.id,idempotencyKey:randomUUID(),preDeliveryCancellationId:proposed.id,preDeliveryCancellationSourceHash:proposed.proposalHash});
  const malformed=data();delete (malformed as any).preDeliveryCancellationSourceHash;
  const rollback=new Error('rollback malformed binding');await assert.rejects(db.serial(async tx=>{await assert.rejects(tx.refund.create({data:malformed}),/Refund_cancellation04_pair/);throw rollback;}),(e:any)=>e===rollback);
  await assert.rejects(db.refund.create({data:{...data(),preDeliveryCancellationId:null}}),/Refund_cancellation04_pair/);
  await assert.rejects(db.refund.create({data:{...data(),preDeliveryCancellationId:randomUUID()}}),/04 refund source mismatch|foreign key/i);
  await assert.rejects(db.refund.create({data:{...data(),preDeliveryCancellationSourceHash:'a'.repeat(64)}}),/04 refund source mismatch/);
  const foreign=await db.customer.create({data:{mobile:'synthetic-'+randomUUID()}});
  await assert.rejects(db.refund.create({data:{...data(),customerId:foreign.id}}),/04 refund source mismatch/);
  const unbound=await db.payment.create({data:{billId:payment.billId,customerId:sub.customer.id,amount:1,status:'SUCCEEDED',idempotencyKey:randomUUID(),providerTransactionId:'SYN-'+randomUUID(),succeededAt:new Date()}});
  await assert.rejects(db.refund.create({data:{...data(),paymentId:unbound.id}}),/04 refund source mismatch/);
  const saved=await db.refund.create({data:data()});assert.equal(saved.preDeliveryCancellationId,proposed.id);assert.equal(saved.preDeliveryCancellationSourceHash,proposed.proposalHash);
  await assert.rejects(db.refund.update({where:{id:saved.id},data:{preDeliveryCancellationSourceHash:null}}),/04 refund immutable source/);
 }finally{if(mode===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=mode;await db.$disconnect();}
});
