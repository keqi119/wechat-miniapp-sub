import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdminController} from '../src/operations/admin';
test('MVP compatibility plans and granted entitlement rows cannot bypass versioned commands',async()=>{
 const old=process.env.MVP_V2_ENABLED;process.env.MVP_V2_ENABLED='true';let writes=0;
 const db:any={serial:async()=>{writes++;return{};}};const service=new AdminController(db),request={admin:{id:'a',role:'ADMIN'}};
 try{for(const resource of ['plans','entitlements']){await assert.rejects(service.create(resource,resource==='plans'?{vehicleId:'v',name:'p',months:12,monthlyFeeAmount:100,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'e',benefits:[],conditions:'c'}:{orderId:'o',title:'b',description:'d'},request),(e:any)=>e.getResponse?.().error?.code==='ACTION_REQUIRED');await assert.rejects(service.patch(resource,'i',{},request),(e:any)=>e.getResponse?.().error?.code==='ACTION_REQUIRED');}await assert.rejects(Promise.resolve().then(()=>service.activate('p',request)),(e:any)=>e.getResponse?.().error?.code==='ACTION_REQUIRED');assert.equal(writes,0);}finally{if(old===undefined)delete process.env.MVP_V2_ENABLED;else process.env.MVP_V2_ENABLED=old;}
});
