import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BillAutoPublicationScheduler,startBillAutoPublicationScheduler} from '../src/billing/auto-publication-scheduler';

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function timer(){let callback=()=>{},cancelled=0,interval=0,unrefs=0;const handle={unref(){unrefs++;}} as unknown as NodeJS.Timeout;return{options:{schedule(run:()=>void,ms:number){callback=run;interval=ms;return handle;},cancel(value:NodeJS.Timeout){assert.equal(value,handle);cancelled++;}},tick(){callback();},state:()=>({cancelled,interval,unrefs})};}
function emptyDb(){let reads=0;return{db:{bill:{findMany:async()=>{reads++;return[];}},serial:async()=>{throw new Error('no candidate');}} as any,reads:()=>reads};}

test('only the exact true switch starts startup and minute scans',async()=>{
 for(const enabled of [undefined,'false','TRUE','1']){const f=emptyDb(),t=timer(),stop=startBillAutoPublicationScheduler(f.db,{...t.options,env:{BILL_AUTO_PUBLISH_ENABLED:enabled}});await flush();t.tick();await flush();assert.equal(f.reads(),0);assert.equal(t.state().unrefs,0);await stop();}
 const f=emptyDb(),t=timer(),stop=startBillAutoPublicationScheduler(f.db,{...t.options,env:{BILL_AUTO_PUBLISH_ENABLED:'true'}});await flush();assert.equal(f.reads(),1);assert.equal(t.state().interval,60000);t.tick();await flush();assert.equal(f.reads(),2);await stop();
});

test('slow scans cannot overlap and shutdown awaits the current scan then ignores queued ticks',async()=>{
 let finish!:()=>void,reads=0;const blocked=new Promise<any[]>(resolve=>{finish=()=>resolve([]);}),t=timer(),db:any={bill:{findMany:()=>{reads++;return blocked;}}};
 const stop=startBillAutoPublicationScheduler(db,{...t.options,env:{BILL_AUTO_PUBLISH_ENABLED:'true'}});await flush();t.tick();t.tick();await flush();assert.equal(reads,1);
 let stopped=false;const stopping=stop().then(()=>{stopped=true;});await flush();assert.equal(stopped,false);finish();await stopping;t.tick();await flush();assert.equal(reads,1);assert.equal(t.state().cancelled,1);
});

test('shutdown drains the current query without starting publication of the returned backlog',async()=>{
 let finish!:(rows:any[])=>void,publications=0;const waiting=new Promise<any[]>(resolve=>{finish=resolve;}),t=timer(),reports:any[]=[];
 const db:any={bill:{findMany:()=>waiting},serial:async()=>{publications++;return{published:true};}};
 const stop=startBillAutoPublicationScheduler(db,{...t.options,env:{BILL_AUTO_PUBLISH_ENABLED:'true'},reportScan:report=>reports.push(report)});await flush();
 const stopped=stop();finish([{id:'backlog-bill'}]);await stopped;assert.equal(publications,0);assert.equal(reports.length,1);assert.equal(reports[0].stopped,true);assert.equal(reports[0].scanned,0);
});

test('completed scans report allowlisted counts and their exact controlled start and finish instants',async()=>{
 const f=emptyDb(),t=timer(),reports:any[]=[];let clockReads=0;
 const stop=startBillAutoPublicationScheduler(f.db,{...t.options,env:{BILL_AUTO_PUBLISH_ENABLED:'true'},now:()=>new Date(clockReads++===0?'2026-10-29T01:00:00Z':'2026-10-29T01:00:01Z'),reportScan:report=>reports.push(report)});
 await flush();await stop();assert.deepEqual(reports,[{scanned:0,published:0,blocked:0,failed:0,startedAt:'2026-10-29T01:00:00.000Z',finishedAt:'2026-10-29T01:00:01.000Z',stopped:false}]);
});

test('partial failure emits a fixed scan prefix and counts without bill IDs or exception data',async()=>{
 const output:string[]=[],errors:string[]=[],original=console.info,t=timer();let attempts=0;
 const db:any={bill:{findMany:async()=>[{id:'private-customer-bill-a'},{id:'private-customer-bill-b'}]},serial:async()=>{if(++attempts===1)throw new Error('postgresql://secret@private-host/customer');return{published:true};}};
 console.info=(message:any)=>{output.push(String(message));};
 const stop=startBillAutoPublicationScheduler(db,{...t.options,env:{BILL_AUTO_PUBLISH_ENABLED:'true'},now:()=>new Date('2026-10-29T01:00:00Z'),reportError:message=>errors.push(message)});
 try{await flush();await stop();assert.equal(output.length,1);assert.ok(output[0].startsWith('BILL_AUTO_PUBLICATION_SCAN '));const report=JSON.parse(output[0].slice('BILL_AUTO_PUBLICATION_SCAN '.length));assert.deepEqual(report,{scanned:2,published:1,blocked:0,failed:1,startedAt:'2026-10-29T01:00:00.000Z',finishedAt:'2026-10-29T01:00:00.000Z',stopped:false});assert.equal(errors.length,1);assert.ok(!JSON.stringify([...output,...errors]).includes('private'));assert.ok(!JSON.stringify([...output,...errors]).includes('secret'));}
 finally{await stop();console.info=original;}
});

test('failed scans log no raw database or customer data and recover at the next minute',async()=>{
 let reads=0;const logs:string[]=[],t=timer(),db:any={bill:{findMany:async()=>{if(++reads===1)throw new Error('postgresql://secret@old-host/customer');return[];}}};
 const stop=startBillAutoPublicationScheduler(db,{...t.options,env:{BILL_AUTO_PUBLISH_ENABLED:'true'},reportError:message=>logs.push(message)});await flush();assert.equal(logs.length,1);assert.ok(!logs[0].includes('secret'));assert.ok(!logs[0].includes('customer'));t.tick();await flush();assert.equal(reads,2);await stop();
});

test('Nest repeated start uses one timer and shutdown before the startup microtask avoids database reads',async()=>{
 const f=emptyDb(),t=timer(),service=new BillAutoPublicationScheduler(f.db);service.start({...t.options,env:{BILL_AUTO_PUBLISH_ENABLED:'true'}});service.start({...t.options,env:{BILL_AUTO_PUBLISH_ENABLED:'true'}});await service.onModuleDestroy();await flush();assert.equal(f.reads(),0);assert.equal(t.state().unrefs,1);assert.equal(t.state().cancelled,1);
});
