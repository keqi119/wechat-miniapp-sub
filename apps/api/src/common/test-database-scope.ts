import type {Prisma} from '@prisma/client';

/** Fail before Prisma construction if a test accidentally uses the application's default database. */
export function testScopedOptions(options:Prisma.PrismaClientOptions|undefined,env:NodeJS.ProcessEnv=process.env){
 if(env.NODE_ENV!=='test'&&!env.NODE_TEST_CONTEXT&&!env.MVP_TEST_GUARD)return options;
 if(env.MVP_TEST_GUARD!=='local-project-v1')throw new Error('MVP_TEST_GUARD_REQUIRED: run database tests through scripts/run-mvp-api-tests.mjs');
 const configured=options?.datasourceUrl??options?.datasources?.db?.url??env.DATABASE_URL;
 const allowed=(raw:unknown)=>{try{const u=new URL(String(raw));return ['postgres:','postgresql:'].includes(u.protocol)&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&u.port==='55432'&&u.pathname==='/chundian_test'&&!u.hash&&[...u.searchParams].every(([k,v])=>k==='schema'&&v==='public');}catch{return false;}};
 if(!allowed(configured)||!allowed(env.TEST_DATABASE_URL)||configured!==env.TEST_DATABASE_URL)throw new Error('MVP_TEST_DATABASE_DENIED: test database must match the guarded local project target');
 return options;
}
