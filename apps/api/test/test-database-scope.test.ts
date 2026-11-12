import test from 'node:test';
import assert from 'node:assert/strict';
import {testScopedOptions} from '../src/common/test-database-scope';
import {Db} from '../src/common/db';
const target='postgresql://synthetic:synthetic@127.0.0.1:55432/chundian_test';
const env={NODE_ENV:'test',MVP_TEST_GUARD:'local-project-v1',TEST_DATABASE_URL:target,DATABASE_URL:target};
test('test DB construction requires the guarded runner and its exact isolated target',()=>{
 const options={datasourceUrl:target};assert.equal(testScopedOptions(options,env),options);
 assert.equal(testScopedOptions(undefined,env),undefined);
 assert.throws(()=>testScopedOptions(undefined,{...env,MVP_TEST_GUARD:undefined}),/MVP_TEST_GUARD_REQUIRED/);
 assert.throws(()=>testScopedOptions(undefined,{...env,NODE_ENV:undefined,NODE_TEST_CONTEXT:'child-v8',MVP_TEST_GUARD:undefined}),/MVP_TEST_GUARD_REQUIRED/);
 for(const url of [target.replace('chundian_test','chundian_dev'),target.replace('55432','5432'),target.replace('127.0.0.1','example.invalid'),target+'?schema=other',target+'#fragment'])assert.throws(()=>testScopedOptions({datasourceUrl:url},env),/MVP_TEST_DATABASE_DENIED/);
 assert.throws(()=>testScopedOptions({datasources:{db:{url:target.replace('chundian_test','chundian_dev')}}},env),/MVP_TEST_DATABASE_DENIED/);
 assert.throws(()=>testScopedOptions(undefined,{...env,TEST_DATABASE_URL:target+'?schema=public'}),/MVP_TEST_DATABASE_DENIED/);
});
test('ordinary application construction is unchanged outside test processes',()=>{
 const options={datasourceUrl:'postgresql://synthetic:synthetic@example.invalid/app'};assert.equal(testScopedOptions(options,{NODE_ENV:'production'}),options);
});
test('unguarded new Db is rejected before Prisma can connect, including a plain node --test process',()=>{
 const previous=process.env.MVP_TEST_GUARD;delete process.env.MVP_TEST_GUARD;
 try{assert.throws(()=>new Db({datasourceUrl:target}),/MVP_TEST_GUARD_REQUIRED/);}finally{if(previous===undefined)delete process.env.MVP_TEST_GUARD;else process.env.MVP_TEST_GUARD=previous;}
});
