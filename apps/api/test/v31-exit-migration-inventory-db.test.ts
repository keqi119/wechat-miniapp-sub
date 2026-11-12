import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Db} from '../src/common/db';
import {exitResponseGroups} from '../src/orders/exit-amount-responses';
test('readonly applied020–024 inventory matches files and pre024 immutable response history remains usable',async()=>{const db=new Db();try{
 const rows:any[]=await db.$queryRaw`SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" WHERE migration_name IN ('202611070020_v31_termination_facts','202611070021_v31_exit_amount_response','202611070022_v31_return_receipt_review','202611070023_v31_occupancy_claim','202611070024_v31_exit_response_chain') ORDER BY migration_name`;assert.equal(rows.length,5);for(const r of rows){assert.ok(r.finished_at);assert.equal(r.rolled_back_at,null);assert.equal(r.checksum,createHash('sha256').update(readFileSync('prisma/migrations/'+r.migration_name+'/migration.sql')).digest('hex'));console.log('READONLY_APPLIED',r.migration_name,r.checksum,r.finished_at.toISOString());}
 const previous=await db.orderExitAmountResponse.findFirstOrThrow({where:{responseVersion:null,decision:'CONFIRM'},orderBy:[{confirmedAt:'asc'},{id:'asc'}]}),groups=await exitResponseGroups(db,previous.orderId),g=groups.find(g=>g.bindingHash===(previous.source as any).bindingHash)!;assert.equal(g.first.id,previous.id);assert.ok(g.view.history.some(r=>r.id===previous.id&&r.legacy));assert.deepEqual(await db.orderExitAmountResponse.findUniqueOrThrow({where:{id:previous.id}}),previous);
 }finally{await db.$disconnect();}});
