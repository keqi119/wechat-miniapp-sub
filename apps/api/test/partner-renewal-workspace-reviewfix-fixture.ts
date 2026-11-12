import assert from 'node:assert/strict';
import {offlineDelayFixture} from './offline-delivery-delay-fixture';
import {prepareFinance,applyDelay} from '../src/order-changes/finance';
import {hash} from '../src/common/data';
import {usageRules} from '../src/usage/policy';
import {lessorIdentityHash} from '../src/owner-signing/lessor';
import {offlineChangeScope} from '../src/order-changes/agreement-facts';

/** Real delay preparation/application and paper-chain validation, then explicit synthetic delivered facts. No Db/provider. */
export async function partnerDelayedLegacyFixture(){
 const f=offlineDelayFixture(true),{tx}=f;
 const template='每月 {{baseAllowanceKm}} 公里，超额 {{excessPriceYuan}} 元',content='每月 1500 公里，超额 1.50 元';
 Object.assign(f.initial,{usagePolicyVersion:'USAGE_V2',mileagePerMonthKm:1500,excessMileagePriceAmount:150,usagePolicy:{...usageRules,policyVersion:'USAGE_V2',documentId:'usage-doc',documentVersion:1,templateContent:template,templateHash:hash(template),content,hash:hash(content)},productSnapshot:{configurationVersion:2,productId:'original-product',productVersionId:'original-version',version:1,name:'原期产品',swapPolicy:{version:2,period:'TERM',includedCount:2,extraFeeAmount:50000}}});
 (f.initial.lessorSnapshot as any).sharingNotice={id:'sharing',version:1,contentHash:hash('sharing')};
 (f.initial as any).ownerDataConsent={ownerId:'owner',customerId:f.customer.id,acceptedAt:'2026-10-01T00:00:00Z',lessorHash:lessorIdentityHash(f.initial.lessorSnapshot),notice:{contentHash:hash('sharing')}};
 f.change.priorTerms=structuredClone(f.initial);f.change.priorTermsHash=hash(f.initial);f.version.scopeSnapshot=offlineChangeScope(f.change,f.quote,f.contract);
 await prepareFinance(tx,f.change,{id:'finance',role:'FINANCE',authVersion:1});await applyDelay(tx,f.change);
 assert.equal(f.terms[0].snapshot.startDate,f.quote.snapshot.newStartDate);assert.equal(f.initial.startDate,'2026-10-01');
 Object.assign(f.order,{status:'ACTIVE',currentAssignmentId:'delivered-assignment'});
 const assignment:any={id:'delivered-assignment',orderId:f.order.id,customerId:f.customer.id,vehicleId:'vehicle',status:'ACTIVE',startAt:new Date('2026-11-01T00:00:00+08:00'),endAt:null};
 const cars:any[]=[{id:'vehicle',title:'原车辆',plateNumber:'沪A测试'}],stages:any[]=[];
 const session:any={id:'partner-session',mode:'PARTNER_READONLY',mobileHash:'viewer',expiresAt:new Date('2099-01-01'),scopeSnapshot:[{accessId:'access',ownerId:'owner',accessVersion:1}]};
 tx.partnerPortalSession={findUnique:async()=>session};tx.partnerPortalAccess={findMany:async()=>[{id:'access',ownerId:'owner',mobileHash:'viewer',status:'ENABLED',accessVersion:1,reviewedBy:'reviewer',reviewedAt:new Date('2026-10-01')}]};
 tx.order.findMany=async()=>[f.order];tx.order.count=async()=>1;
 tx.contract.findMany=async({where}:any)=>f.contracts.filter(c=>c.orderId===where.orderId&&(!where.customerId||c.customerId===where.customerId)&&(!where.kind?.in||where.kind.in.includes(c.kind)));
 tx.orderChange.findMany=async()=>f.changes;tx.delayQuote.findMany=async({where}:any)=>f.quotes.filter(q=>q.changeId===where.changeId);
 tx.orderServiceStage={findMany:async()=>stages};tx.orderTermsVersion.findUnique=async({where}:any)=>f.terms.find(t=>t.id===where.id)??null;
 tx.vehicleAssignment.findUnique=async({where}:any)=>where.id===assignment.id?assignment:null;
 tx.vehicle={findUnique:async({where}:any)=>cars.find(c=>c.id===where.id)??null};
 const freezeReads=()=>{
  const before=JSON.stringify({order:f.order,terms:f.terms,changes:f.changes,quotes:f.quotes,archives:f.archives,stages,assignment});const writes=f.writes.length;
  for(const delegate of Object.values(tx) as any[])if(delegate&&typeof delegate==='object')for(const method of ['create','createMany','update','updateMany','upsert','delete','deleteMany'])if(typeof delegate[method]==='function')delegate[method]=async()=>assert.fail('GET attempted '+method);
  return()=>{assert.equal(JSON.stringify({order:f.order,terms:f.terms,changes:f.changes,quotes:f.quotes,archives:f.archives,stages,assignment}),before);assert.equal(f.writes.length,writes);};
 };
 return{...f,session,assignment,cars,stages,freezeReads};
}
