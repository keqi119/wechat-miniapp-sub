import test from 'node:test';
import assert from 'node:assert/strict';
import {addonCatalog,customerAddonCatalog,resolveAddonQuote} from '../src/addon-products/catalog';
import {versionHash} from '../src/addon-products/policy';
import {AddonProductsService} from '../src/addon-products/service';
import {requireAddonCustomer} from '../src/addon-products/customer';
const at=new Date('2026-11-05T01:00:00Z');
function fixture(){
 const order:any={id:'order',customerId:'customer',status:'ACTIVE',currentAssignmentId:'assignment',finalPlanSnapshot:{months:12}};
 const account:any={id:'account',orderId:'order',customerId:'customer',startedOn:new Date('2026-10-15'),returnedOn:null,packStatus:'ACTIVE'};
 const period:any={id:'period',accountId:'account',orderId:'order',sequence:1,serviceStageId:null,startDate:new Date('2026-10-15'),endDate:new Date('2026-11-15'),effectiveEndDate:new Date('2026-11-15'),status:'OPEN'};
 const assignment:any={id:'assignment',orderId:'order',customerId:'customer',startAt:new Date('2026-10-15T01:00:00Z'),endAt:null,vehicle:{modelDefinitionId:'model'}};
 const models=[{id:'model',brand:'蔚来',name:'ET5'},{id:'target',brand:'乐道',name:'L60'}];
 const version:any={id:'version',productId:'product',kind:'MILEAGE_PACK',name:'当前月包',version:2,status:'PUBLISHED',scopePrices:[{id:'scope',scopes:[{brand:'蔚来',allModels:true,modelDefinitionIds:[]}],prices:[{km:1000,amount:100000},{km:1500,amount:140000},{km:2000,amount:180000}]}]};version.sourceHash=versionHash(version);
 let stageRows:any[]=[],physical:any=null;
 const tx:any={$queryRaw:async()=>[],usageAccount:{findUnique:async()=>account},vehicleReceiptEvent:{findFirst:async()=>physical},orderServiceStage:{findMany:async()=>stageRows},vehicleAssignment:{findFirst:async()=>assignment},modelDefinition:{findUnique:async({where}:any)=>models.find(m=>m.id===where.id),findMany:async()=>models},usagePeriod:{findMany:async()=>[period]},addonProductVersion:{findMany:async()=>[version],findUnique:async()=>version},order:{findFirst:async({where}:any)=>where.customerId===order.customerId?order:null}};
 return{tx,order,account,period,assignment,version,models,setStages:(v:any[])=>{stageRows=v;},setPhysical:(v:any)=>{physical=v;}};
}
test('monthly quote freezes true assignment and billing-month boundary with precise version',async()=>{
 const f=fixture(),v=await addonCatalog(f.tx,f.order,'MILEAGE_PACK',at);assert.equal(v.products[0].quotes.length,3);assert.equal(v.context.periodId,'period');assert.equal(v.context.endDate,'2026-11-15');assert.equal(v.context.expiresAt,'2026-11-14T16:00:00.000Z');assert.equal(v.context.assignmentId,'assignment');
 const p=v.products[0],q=p.quotes[0],input={productId:p.productId,versionId:p.versionId,sourceHash:p.sourceHash,quoteId:q.quoteId,periodId:'period',termsVersion:v.terms.version,termsHash:v.terms.hash,accepted:true};
 assert.equal((await resolveAddonQuote(f.tx,f.order,'MILEAGE_PACK',input,at)).quote.amount,100000);
 await assert.rejects(resolveAddonQuote(f.tx,f.order,'MILEAGE_PACK',{...input,periodId:'future'},at));await assert.rejects(resolveAddonQuote(f.tx,f.order,'MILEAGE_PACK',{...input,versionId:'old'},at));await assert.rejects(resolveAddonQuote(f.tx,f.order,'MILEAGE_PACK',{...input,accepted:false},at));
});
test('not active, returned, future service stage and physical receipt never authorize new purchase',async()=>{
 for(const mode of ['CLOSED','RETURNED','FUTURE','RECEIPT','ASSIGNMENT']){const f=fixture();if(mode==='CLOSED')f.order.status='AWAITING_HANDOVER';if(mode==='RETURNED')f.account.returnedOn=at;if(mode==='FUTURE')f.setStages([{orderId:'order',customerId:'customer',kind:'RENEWAL',status:'PREPARED',startDate:new Date('2026-10-15'),endDate:new Date('2027-10-15')}]);if(mode==='RECEIPT')f.setPhysical({id:'receipt'});if(mode==='ASSIGNMENT')f.assignment.customerId='other';await assert.rejects(addonCatalog(f.tx,f.order,'MILEAGE_PACK',at),mode);}
 const f=fixture();await assert.rejects(customerAddonCatalog(f.tx,'order','other','MILEAGE_PACK',at));
});
test('selected target model prices swap catalog while current model cannot substitute',async()=>{
 const f=fixture();f.version.kind='SWAP_CREDIT';f.version.scopePrices=[{id:'swap',scopes:[{brand:'乐道',allModels:false,modelDefinitionIds:['target']}],prices:[{quantity:1,amount:50000}]}];f.version.sourceHash=versionHash(f.version);
 assert.equal((await addonCatalog(f.tx,f.order,'SWAP_CREDIT',at)).products.length,0);
 assert.equal((await addonCatalog(f.tx,f.order,'SWAP_CREDIT',at,'model')).products.length,0);
 const v=await addonCatalog(f.tx,f.order,'SWAP_CREDIT',at,'target');assert.equal(v.products[0].quotes[0].amount,50000);assert.equal(v.context.targetModelDefinitionId,'target');
 const p=v.products[0],resolved=await resolveAddonQuote(f.tx,f.order,'SWAP_CREDIT',{productId:p.productId,versionId:p.versionId,sourceHash:p.sourceHash,quoteId:p.quotes[0].quoteId,targetModelDefinitionId:'target',termsVersion:v.terms.version,termsHash:v.terms.hash,accepted:true},at);assert.equal(resolved.orderId,'order');assert.equal(resolved.customerId,'customer');
});
test('pricing RBAC and revoked customer session are rechecked inside transaction',async()=>{
 for(const role of ['FINANCE','SUPPORT','FIELD']){const actor={id:'staff',role,authVersion:1};await assert.rejects(new AddonProductsService().list({adminUser:{findUnique:async()=>({...actor,active:true})}} as any,actor,{}));}
 await assert.rejects(requireAddonCustomer({customerSession:{findUnique:async()=>null}},'customer','session'));
 await assert.rejects(requireAddonCustomer({customerSession:{findUnique:async()=>({customerId:'other',expiresAt:new Date('2030-01-01')})}},'customer','session'));
});
