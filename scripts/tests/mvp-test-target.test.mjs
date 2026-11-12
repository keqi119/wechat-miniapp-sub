import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateTestDatabaseUrl, testArguments, runMvpApiTests, acquireTestLock, redactOutput } from '../run-mvp-api-tests.mjs';

const safe='postgresql://tester:private-password@127.0.0.1:55432/chundian_test';
test('only the dedicated literal loopback target is accepted',()=>{
 for(const value of [undefined,'','invalid',safe.replace('127.0.0.1','db.internal'),safe.replace(':55432',':5432'),safe.replace('chundian_test','legacy_test'),safe+'?host=remote',safe+'?schema=public&hostaddr=remote',safe.replace('postgresql:','https:')])assert.throws(()=>validateTestDatabaseUrl(value));
 for(const host of ['localhost','127.0.0.1','[::1]'])assert.equal(validateTestDatabaseUrl(safe.replace('127.0.0.1',host)),safe.replace('127.0.0.1',host));
});
test('arguments cannot escape the local test directory or enable concurrent runners',()=>{
 assert.deepEqual(testArguments(['test/owner-query-isolation.test.ts']),['--test','--test-concurrency=1','test/owner-query-isolation.test.ts']);
 for(const args of [[],['../test/a.test.ts'],['test/../src/main.ts'],['--test-concurrency=9'],['--all','test/a.test.ts'],['test/a.test.ts;echo']])assert.throws(()=>testArguments(args));
 assert.deepEqual(testArguments(['--migrate']),['src/common/migrate.ts','--test']);
});
test('arguments map isolated backfill preview and apply without accepting extra flags',()=>{
 assert.deepEqual(testArguments(['--backfill-dry-run']),['src/operations/seven-module-migration.ts','--test']);
 assert.deepEqual(testArguments(['--backfill']),['src/operations/seven-module-migration.ts','--test','--apply']);
 for(const args of [
  ['--backfill','--apply'],['--backfill-dry-run','--apply'],['--backfill','--all'],
  ['--backfill','--backfill-dry-run'],['--backfill','test/owner-query-isolation.test.ts'],
  ['--test','--apply'],['src/operations/seven-module-migration.ts','--test'],['--backfill','--production']
 ])assert.throws(()=>testArguments(args),/MVP_TEST_ARGUMENTS/);
});
test('invalid target never invokes a child; validated target overwrites DATABASE_URL',async()=>{
 let calls=0,captured;
 const spawn=async(command,args,options)=>{calls++;captured={command,args,options};return 0;};
 await assert.rejects(runMvpApiTests(['test/owner-query-isolation.test.ts'],{env:{TEST_DATABASE_URL:safe.replace(':55432',':5432')},spawn}));assert.equal(calls,0);
 assert.equal(await runMvpApiTests(['test/owner-query-isolation.test.ts'],{env:{TEST_DATABASE_URL:safe,DATABASE_URL:'postgresql://legacy-secret@old/old'},spawn}),0);
 assert.equal(captured.options.env.DATABASE_URL,safe);assert.equal(captured.options.env.TEST_DATABASE_URL,safe);assert.equal(captured.options.shell,false);assert.equal(captured.args[0],'--import');assert.equal(new URL(captured.args[1]).protocol,'file:');
});
test('lock rejects concurrent runners and release is idempotent',()=>{
 mkdirSync(resolve('.runtime'),{recursive:true});const dir=mkdtempSync(resolve('.runtime/mvp-lock-test-')),path=resolve(dir,'api.lock');
 try{const release=acquireTestLock(path);assert.throws(()=>acquireTestLock(path),/MVP_TEST_BUSY/);release();release();const releaseAgain=acquireTestLock(path);releaseAgain();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('child failure releases lock and output redacts both complete URLs and passwords',async()=>{
 const raw=redactOutput('error '+safe+' private-password '+encodeURIComponent('private-password'),[safe]);assert.ok(!raw.includes(safe));assert.ok(!raw.includes('private-password'));
 await assert.rejects(runMvpApiTests(['test/owner-query-isolation.test.ts'],{env:{TEST_DATABASE_URL:safe},spawn:async()=>{throw new Error('child failed');}}));
 assert.equal(await runMvpApiTests(['test/owner-query-isolation.test.ts'],{env:{TEST_DATABASE_URL:safe},spawn:async()=>0}),0);
});
