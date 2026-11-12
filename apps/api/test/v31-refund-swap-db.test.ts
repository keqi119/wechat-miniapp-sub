import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runSwapCommandJourney} from './v31-swap-command-journey';
import {RefundObligationsService} from '../src/billing/refund-obligations';
test('actual03 gap exact confirmed payment source becomes7day obligation independent of late finance/current correction',ctx=>runSwapCommandJourney(ctx,'gap',{configureSources:async()=>{},beforeFinance:async(ctx,db,f)=>{const api=new RefundObligationsService(db),v:any=await api.read(f.sub.order.id,f.f.actor);assert.ok(v.candidates.some((c:any)=>c.sourceKind==='SWAP03'&&c.refs.financeId===null));const out:any=await api.materialize(f.sub.order.id,{sourceHash:v.sourceHash,idempotencyKey:randomUUID()},f.reviewer);assert.ok(out.items.length>0);assert.ok(out.items.every((o:any)=>o.amountConfirmedAt===f.confirmedAmount.createdAt.toISOString()));},run:async(ctx,db,f)=>{
 const api=new RefundObligationsService(db),v:any=await api.read(f.sub.order.id,f.f.actor),sources=v.candidates.filter((c:any)=>c.sourceKind==='SWAP03');assert.ok(sources.length>0);assert.ok(sources.every((c:any)=>c.workingDays===7));assert.ok(sources.every((c:any)=>c.refs.financeId&&c.refs.planHash&&c.refs.periodSequence));
 const finance=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic',name:'9a财务源读取',role:'FINANCE'}}),out:any=await api.materialize(f.sub.order.id,{sourceHash:v.sourceHash,idempotencyKey:randomUUID()},finance);assert.equal(out.items.filter((c:any)=>c.sourceKind==='SWAP03').reduce((n:number,c:any)=>n+c.amount,0),sources.reduce((n:number,c:any)=>n+c.amount,0));assert.ok(out.items.every((o:any)=>o.factAt!==o.triggerAt||o.factAt===o.amountConfirmedAt));
 for(const o of out.items){const p=await db.payment.findUniqueOrThrow({where:{id:o.paymentId},include:{bill:true}});assert.notEqual(p.bill.type,'DEPOSIT');assert.equal(p.bill.orderId,f.sub.order.id);}
}}));
