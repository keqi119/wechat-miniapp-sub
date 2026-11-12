import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InsuranceRenewalScheduler,startInsuranceRenewalScheduler} from '../src/insurance/renewal-scheduler';

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function clock(){
 let callback=()=>{},cancelled=0,unref=0,interval=0;
 const timer={unref(){unref++;}} as unknown as NodeJS.Timeout;
 return {options:{schedule(run:()=>void,ms:number){callback=run;interval=ms;return timer;},cancel(value:NodeJS.Timeout){assert.equal(value,timer);cancelled++;}},tick(){callback();},state:()=>({cancelled,unref,interval})};
}
function renewalDb(){
 const keys=new Set<string>();let transactions=0,reads=0;
 const tx={insurancePolicyVersion:{findMany:async()=>{reads++;return[{id:'version',policyId:'policy',version:1,status:'APPROVED',changeKind:'ORIGINAL',effectiveAt:new Date('2026-01-01'),endAt:new Date('2026-11-01T16:00:00Z'),vehicleIds:['vehicle']}];}},insuranceRenewalReminder:{createMany:async({data,skipDuplicates}:any)=>{assert.equal(skipDuplicates,true);let count=0;for(const item of data){const key=`${item.vehicleId}:${item.policyVersionId}:${item.thresholdDays}`;if(!keys.has(key)){keys.add(key);count++;}}return{count};}}};
 return {db:{serial:async(operation:any)=>{transactions++;return operation(tx);}} as any,keys,counts:()=>({transactions,reads})};
}

test('automatic startup and hourly scans create only durable 30/7/0-day reminders and survive restart without duplicates',async()=>{
 const f=renewalDb(),timer=clock();let now=new Date('2026-10-03T00:00:00+08:00');
 const stop=startInsuranceRenewalScheduler(f.db,{...timer.options,now:()=>now});await flush();
 assert.deepEqual([...f.keys],['vehicle:version:30']);assert.equal(timer.state().interval,3600000);assert.equal(timer.state().unref,1);
 now=new Date('2026-10-26T00:00:00+08:00');timer.tick();await flush();assert.equal(f.keys.size,2);
 now=new Date('2026-11-02T00:00:00+08:00');timer.tick();await flush();assert.equal(f.keys.size,3);
 await stop();const restarted=clock(),stopAgain=startInsuranceRenewalScheduler(f.db,{...restarted.options,now:()=>now});await flush();assert.equal(f.keys.size,3);await stopAgain();
 assert.equal(f.counts().transactions,4);assert.equal(f.counts().reads,4);
});

test('slow scans never overlap, shutdown waits for the current scan and ignores queued ticks',async()=>{
 let finish!:()=>void,started=0;const blocked=new Promise<void>(resolve=>{finish=resolve;}),timer=clock();
 const db:any={serial:async()=>{started++;await blocked;}};
 const stop=startInsuranceRenewalScheduler(db,timer.options);await flush();timer.tick();timer.tick();await flush();assert.equal(started,1);
 let stopped=false;const stopping=stop().then(()=>{stopped=true;});await flush();assert.equal(stopped,false);timer.tick();assert.equal(timer.state().cancelled,1);
 finish();await stopping;timer.tick();await flush();assert.equal(started,1);await stop();assert.equal(timer.state().cancelled,1);
});

test('a failed scan reports a fixed message without error details and retries next tick',async()=>{
 let runs=0;const logs:unknown[][]=[],timer=clock(),db:any={serial:async()=>{runs++;if(runs===1)throw new Error('postgresql://secret@old-host/private customer-name');return 0;}};
 const stop=startInsuranceRenewalScheduler(db,{...timer.options,reportError:(...args:unknown[])=>{logs.push(args);}});await flush();
 assert.deepEqual(logs,[['保单续保待办扫描失败，将在下次扫描重试。']]);timer.tick();await flush();assert.equal(runs,2);await stop();
});

test('Nest shutdown hook stops the scheduler and repeated start does not duplicate timers',async()=>{
 const f=renewalDb(),timer=clock(),service=new InsuranceRenewalScheduler(f.db);
 service.start(timer.options);service.start(timer.options);await flush();assert.equal(timer.state().unref,1);
 await service.onModuleDestroy();timer.tick();await flush();assert.equal(timer.state().cancelled,1);assert.equal(f.counts().transactions,1);
});

test('shutdown before the startup microtask never reconnects the database',async()=>{
 const f=renewalDb(),timer=clock(),stop=startInsuranceRenewalScheduler(f.db,timer.options);
 await stop();await flush();assert.equal(f.counts().transactions,0);assert.equal(timer.state().cancelled,1);
});
