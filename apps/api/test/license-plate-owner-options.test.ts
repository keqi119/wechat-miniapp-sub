import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PATH_METADATA} from '@nestjs/common/constants';
import {LicensePlatesController} from '../src/license-plates/controller';
import {LicensePlatesService} from '../src/license-plates/service';
import * as inputs from '../src/license-plates/types';
import {plateFixture,actor,errorCode} from './license-plates-fixture';

const fields=['id','name','revision','status','subjectType'];
const service=new LicensePlatesService() as any;
function ownersFixture(){
 const f=plateFixture(),calls:{kind:string;args:any}[]=[],owners=Array.from({length:612},(_,index)=>({id:'owner-'+String(index).padStart(4,'0'),name:'Fleet '+String(index).padStart(4,'0'),subjectType:index%2?'INDIVIDUAL':'ENTERPRISE',status:index>=610?'SUSPENDED':index%2?'DRAFT':'ACTIVE',revision:index,contact:'must-not-leak',phone:'must-not-leak',identityNumber:'must-not-leak',bankAccount:'must-not-leak',archive:{private:true}}));
 const matches=(row:any,where:any)=>row.status!==where.status.not&&(!where.OR||where.OR.some((part:any)=>Object.entries(part).every(([key,filter]:any)=>String(row[key]).toLowerCase().includes(filter.contains.toLowerCase()))));
 f.tx.vehicleOwner.findMany=async(args:any)=>{calls.push({kind:'list',args:structuredClone(args)});const selected=owners.filter(row=>matches(row,args.where)).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));return selected.slice(args.skip,args.skip+args.take);};
 f.tx.vehicleOwner.count=async(args:any)=>{calls.push({kind:'count',args:structuredClone(args)});return owners.filter(row=>matches(row,args.where)).length;};
 f.tx.vehicleOwner.findUnique=async(args:any)=>{calls.push({kind:'detail',args:structuredClone(args)});return owners.find(row=>row.id===args.where.id)||null;};
 return{...f,calls,owners};
}

test('owner option query is strict and bounds pagination before ORM offsets',()=>{
 const schema=(inputs as any).plateOwnerOptionsInput;assert.ok(schema,'dedicated owner query schema must exist');
 assert.deepEqual(schema.parse({}),{page:1,pageSize:20});assert.deepEqual(schema.parse({page:'31',pageSize:'20',keyword:' Fleet '}),{page:31,pageSize:20,keyword:'Fleet'});
 for(const query of [{page:'0'},{page:'1.5'},{pageSize:'101'},{page:'2147483647',pageSize:'100'},{keyword:'x'.repeat(101)},{keyword:'a\nb'},{status:'SUSPENDED'},{include:'bankAccount'}])assert.equal(schema.safeParse(query).success,false,JSON.stringify(query));
});

test('dedicated owner options page past 500 with one authorized filter, stable ordering and minimal fields',async()=>{
 const f=ownersFixture(),result=await service.ownerOptions(f.tx,actor,{page:'31',pageSize:'20',keyword:' fLEet '});
 assert.equal(result.total,610);assert.equal(result.page,31);assert.equal(result.pageSize,20);assert.equal(result.items.length,10);assert.equal(result.items[0].id,'owner-0600');assert.equal(result.items[9].revision,609);
 for(const item of result.items){assert.deepEqual(Object.keys(item).sort(),fields);assert.notEqual(item.status,'SUSPENDED');}
 const list=f.calls.find(call=>call.kind==='list')!.args,count=f.calls.find(call=>call.kind==='count')!.args;assert.deepEqual(list.where,count.where);assert.equal(list.where.status.not,'SUSPENDED');assert.deepEqual(list.orderBy,[{name:'asc'},{id:'asc'}]);assert.equal(list.skip,600);assert.equal(list.take,20);assert.deepEqual(Object.keys(list.select).sort(),fields);assert(f.calls.every(call=>['list','count'].includes(call.kind)));assert.equal(f.writes.length,0);
 const byId=await service.ownerOptions(f.tx,actor,{keyword:'OWNER-0609'});assert.equal(byId.total,1);assert.equal(byId.items[0].id,'owner-0609');
});

test('owner option detail returns current revision and suspended status without private partner fields',async()=>{
 const f=ownersFixture(),first=await service.ownerOption(f.tx,actor,'owner-0001');assert.equal(first.revision,1);assert.deepEqual(Object.keys(first).sort(),fields);
 f.owners[1].revision=99;f.owners[1].status='SUSPENDED';const current=await service.ownerOption(f.tx,actor,'owner-0001');assert.equal(current.revision,99);assert.equal(current.status,'SUSPENDED');assert.deepEqual(Object.keys(current).sort(),fields);
 await assert.rejects(service.ownerOption(f.tx,actor,'missing-owner'),errorCode('NOT_FOUND'));assert.equal(f.writes.length,0);
 assert(f.calls.every(call=>call.kind==='detail'&&Object.keys(call.args.select).sort().join()===fields.join()));
});

test('both reads verify current allowed staff before parsing or querying owner data',async()=>{
 for(const role of ['FINANCE','SUPPORT','FIELD','CUSTOMER']){
  const f=ownersFixture(),denied={id:'denied',role,authVersion:1};f.seed('adminUser',{...denied,active:true});
  await assert.rejects(service.ownerOptions(f.tx,denied,{}),errorCode('FORBIDDEN'));await assert.rejects(service.ownerOption(f.tx,denied,'owner-0001'),errorCode('FORBIDDEN'));assert.equal(f.calls.length,0);
 }
 for(const change of [{active:false},{role:'FINANCE'},{authVersion:2}]){
  const f=ownersFixture();Object.assign(f.rows('adminUser')[0],change);await assert.rejects(service.ownerOptions(f.tx,actor,{include:'private'}),errorCode('STAFF_SESSION_CHANGED'));await assert.rejects(service.ownerOption(f.tx,actor,''),errorCode('STAFF_SESSION_CHANGED'));assert.equal(f.calls.length,0);
 }
 const f=ownersFixture(),admin={id:'admin',role:'ADMIN',authVersion:1};f.seed('adminUser',{...admin,active:true});assert.equal((await service.ownerOptions(f.tx,admin,{})).total,610);
 await assert.rejects(service.ownerOptions(f.tx,actor,{include:'private'}));await assert.rejects(service.ownerOption(f.tx,actor,''));
});

test('owner option routes precede dynamic plate detail and use the existing serial read boundary',async()=>{
 const prototype=LicensePlatesController.prototype as any,names=Object.getOwnPropertyNames(prototype),ownerList=names.findIndex(name=>Reflect.getMetadata(PATH_METADATA,prototype[name])==='owner-options'),ownerDetail=names.findIndex(name=>Reflect.getMetadata(PATH_METADATA,prototype[name])==='owner-options/:ownerId'),plateDetail=names.findIndex(name=>Reflect.getMetadata(PATH_METADATA,prototype[name])===':id');
 assert(ownerList>=0&&ownerDetail>=0&&ownerList<plateDetail&&ownerDetail<plateDetail);assert.equal(Reflect.getMetadata(PATH_METADATA,LicensePlatesController),'admin/license-plates');
 const f=ownersFixture();let serialCalls=0;const controller=new LicensePlatesController({serial:async(fn:any)=>{serialCalls++;return fn(f.tx);}} as any) as any;
 assert.equal((await controller.ownerOptions({page:'31',pageSize:'20'},{admin:actor})).items.length,10);assert.equal((await controller.ownerOption('owner-0001',{admin:actor})).revision,1);assert.equal(serialCalls,2);assert.equal(f.writes.length,0);
});
