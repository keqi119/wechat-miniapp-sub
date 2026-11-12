import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/common/data';
import {usageRules} from '../src/usage/policy';
import {agreementFixture} from './offline-change-agreement-fixture';
async function helper(){const m:any=await import('../src/order-service-stages/initial');assert.equal(typeof m.prepareInitialServiceStageSnapshot,'function');return m;}
function fixture(){
 const f=agreementFixture(),policy={...usageRules,documentId:'old-usage',documentVersion:1,content:'原冻结规则',hash:hash('原冻结规则')};
 Object.assign(f.initial,{monthlyFeeAmount:10000,depositAmount:20000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,usagePolicyVersion:'USAGE_V1',usagePolicy:policy});Object.assign(f.initial.lessorSnapshot,{name:'原出租方'});Object.assign(f.order,{status:'ACTIVE',revision:3,applicationId:'application',vehicleId:'current-car',currentAssignmentId:'current-assignment'});
 const account={id:'account',orderId:'order',customerId:'customer',startedOn:new Date('2026-10-01'),returnedOn:null,policyVersion:'USAGE_V1',pricingSnapshot:null};
 const assignment={id:'initial-assignment',orderId:'order',customerId:'customer',vehicleId:'vehicle',changeId:null,deliveryHandoverId:'initial-delivery',startAt:new Date('2026-10-01T03:00:00Z'),status:'CLOSED'};
 const delivery={id:'initial-delivery',orderId:'order',customerId:'customer',vehicleId:'vehicle',assignmentId:assignment.id,type:'DELIVERY',changeId:null,status:'COMPLETED',actualAt:assignment.startAt,completedAt:new Date('2026-10-01T04:00:00Z')};
 const dates=['2026-10-01','2026-11-01','2026-12-01','2027-01-01'];const periods=dates.slice(0,3).map((s,n)=>({id:'p-'+n,orderId:'order',accountId:'account',sequence:n+1,startDate:new Date(s),endDate:new Date(dates[n+1]),status:'SETTLED',pricingSnapshot:null,usedKm:900}));
 const bills=periods.map(p=>({id:'b-'+p.id,orderId:'order',customerId:'customer',type:'SUBSCRIPTION',sequence:p.sequence,amount:10000,dueDate:p.startDate,status:'PAID'}));const stages:any[]=[];let writes=0;
 Object.assign(f.tx,{application:{findUnique:async()=>({id:'application',customerId:'customer',vehicleId:'vehicle',subscriptionPlanId:'old-plan'})},orderServiceStage:{findMany:async()=>stages,create:async({data}:any)=>{writes++;stages.push(data);return data;}},usageAccount:{findUnique:async()=>account},vehicleAssignment:{findMany:async()=>[assignment],findUnique:async()=>assignment},handover:{findUnique:async()=>delivery},usagePeriod:{findMany:async()=>periods},bill:{findMany:async()=>bills},archiveVersion:{findUnique:async()=>f.rental.versions[0]}});f.tx.order.updateMany=async({where}:any)=>{if(where.revision!==f.order.revision)return{count:0};f.order.revision++;return{count:1};};
 return{...f,account,assignment,delivery,periods,bills,stages,get writes(){return writes;}};
}
test('pure INITIAL candidate is deterministic and keeps original car, exact bill facts and actual paper source',async()=>{
 const m=await helper(),f=fixture(),before=JSON.stringify({initial:f.initial,account:f.account,periods:f.periods,bills:f.bills,assignment:f.assignment});
 const s=await m.prepareInitialServiceStageSnapshot(f.tx,f.order),again=await m.prepareInitialServiceStageSnapshot(f.tx,f.order);assert.deepEqual(s,again);assert.equal(s.identity.serviceStageId,'initial:order');assert.equal(s.identity.vehicleId,'vehicle');assert.equal(s.identity.assignmentId,'initial-assignment');assert.equal(f.order.vehicleId,'current-car');assert.equal(s.source.agreement.originalArchiveHash,f.rental.versions[0].fileManifestHash);assert.equal(s.source.agreement.originalContractId,'original');assert.deepEqual(s.billingSchedule.map((r:any)=>[r.sequence,r.amount,r.dueDate]),f.bills.map(b=>[b.sequence,b.amount,b.dueDate.toISOString().slice(0,10)]));assert.equal(f.writes,0);assert.equal(JSON.stringify({initial:f.initial,account:f.account,periods:f.periods,bills:f.bills,assignment:f.assignment}),before);
});
test('only explicit create materializes that candidate and subsequent pure reads reuse the immutable row',async()=>{
 const m=await helper(),f=fixture(),s=await m.prepareInitialServiceStageSnapshot(f.tx,f.order);const row=await m.createInitialServiceStage(f.tx,{orderId:'order',expectedOrderRevision:3,snapshot:s});assert.equal(f.writes,1);assert.equal(row.id,s.identity.serviceStageId);assert.deepEqual(await m.prepareInitialServiceStageSnapshot(f.tx,f.order),s);assert.equal(f.writes,1);
});
test('candidate rejects missing, duplicate, cross-order and non-flat original facts without writes or current-product guesses',async()=>{
 const m=await helper();for(const change of [(f:any)=>f.periods.pop(),(f:any)=>f.bills.pop(),(f:any)=>f.bills[0].amount++,(f:any)=>f.bills[0].customerId='foreign',(f:any)=>f.delivery.completedAt=null,(f:any)=>f.assignment.changeId='swap',(f:any)=>f.rental.versions[0].status='INVALIDATED',(f:any)=>f.initial.monthlyAmounts=[10000,20000,10000]]){const f=fixture();change(f);await assert.rejects(m.prepareInitialServiceStageSnapshot(f.tx,f.order),change.toString());assert.equal(f.writes,0);}
});
