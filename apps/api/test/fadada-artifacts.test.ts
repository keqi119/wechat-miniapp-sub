import '../src/common/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { Db } from '../src/common/db';
import { ContractPdfArtifactWriterService } from '../src/contract/contract-pdf-artifact-writer.service';
let db: Db, writer: ContractPdfArtifactWriterService, customerId: string;
before(async () => {
  assert.ok(process.env.TEST_DATABASE_URL?.includes('_test'));
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  db = new Db();
  const customer = await db.customer.create({ data: { mobile: '138' + String(Date.now()).slice(-8), name: '合成归档测试' } }); customerId = customer.id;
  writer = new ContractPdfArtifactWriterService(db);
});
after(async () => { if(db){ await db.storedFile.deleteMany({ where: { customerId } }); await db.customer.deleteMany({ where: { id: customerId } }); await db.$disconnect(); } });
async function pdf() { const doc = new PDFDocument(); const chunks: Buffer[]=[]; const result = new Promise<Buffer>((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});doc.text('Synthetic archive verification '+randomUUID());doc.end();return result; }
test('immutable PDF writer persists actual bytes and file SHA then rejects modified storage', async () => {
  const content = await pdf();
  const file = await writer.persistPdf(content, { customerId, name: 'test-signed.pdf', purpose: 'contract' });
  assert.deepEqual(await writer.readVerified(file.id, file.sha256), content);
  const original = await readFile(file.storagePath);
  await writeFile(file.storagePath, Buffer.from('%PDF-mutated'));
  await assert.rejects(writer.readVerified(file.id, file.sha256), (e:any)=>e.getResponse?.().error?.code==='ARTIFACT_HASH_MISMATCH');
  await writeFile(file.storagePath, original);
  await assert.rejects(writer.persistPdf(Buffer.from('not a pdf'), { customerId, name: 'bad.pdf', purpose: 'contract' }), (e:any)=>e.getResponse?.().error?.code==='ARTIFACT_PDF_REQUIRED');
});
