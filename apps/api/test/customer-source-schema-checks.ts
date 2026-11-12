import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

/** Only called by the guarded migration test inside its freshly created schema. */
export async function verifyCustomerSourceSchema(db:any){
 const columns=await db.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Customer'`;
 assert.ok(columns.some((row:any)=>row.column_name==='sourceChannel'),'missing customer source column');
 assert.ok(columns.some((row:any)=>row.column_name==='sourceRevision'),'missing customer source revision');
 const id=randomUUID(),mobile=`synthetic-source-${id}`;
 await db.$executeRaw`INSERT INTO "Customer" (id,mobile,"updatedAt") VALUES (${id},${mobile},now())`;
 const [customer]=await db.$queryRaw`SELECT "sourceChannel","sourceRevision" FROM "Customer" WHERE id=${id}`;
 assert.equal(customer.sourceChannel,null);assert.equal(customer.sourceRevision,0);
 const constraint=(e:any)=>e?.meta?.code==='23514'&&String(e.message).includes('Customer_source_values');
 for(const source of ['', '   ', '\t\n\r', '\u3000', '字'.repeat(65)])await assert.rejects(db.$executeRaw`UPDATE "Customer" SET "sourceChannel"=${source} WHERE id=${id}`,constraint);
 await assert.rejects(db.$executeRaw`UPDATE "Customer" SET "sourceRevision"=-1 WHERE id=${id}`,constraint);
 await assert.rejects(db.$executeRaw`UPDATE "Customer" SET "sourceRevision"=NULL WHERE id=${id}`,(e:any)=>e?.meta?.code==='23502');
 await db.$executeRaw`UPDATE "Customer" SET "sourceChannel"=${'字'.repeat(64)},"sourceRevision"=1 WHERE id=${id}`;
 await db.$executeRaw`UPDATE "Customer" SET "sourceChannel"=NULL,"sourceRevision"=2 WHERE id=${id}`;
}
