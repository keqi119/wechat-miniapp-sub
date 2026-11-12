import {offlineSwapFixture} from './offline-swap-quotes-fixture';
import {hash} from '../src/common/data';
import {canonicalHash} from '../src/customers/types';
import {versionSnapshot,listedProductSnapshot} from '../src/products/snapshot';
import {usageRules} from '../src/usage/policy';
import {freezeUsagePricing} from '../src/usage/pricing';
import {freezeSwapPolicy} from '../src/swap-purchases/policy';
import {stagePeriods} from '../src/order-service-stages/source';
import {offlineChangeScope} from '../src/order-changes/agreement-facts';

export const renewalOps={id:'ops',role:'OPERATIONS',authVersion:1};
export const renewalFinance={id:'finance',role:'FINANCE',authVersion:1};
export const renewalNow=new Date('2026-10-31T02:00:00Z');
export function renewalFixture(){
 const f=offlineSwapFixture(),tx:any=f.tx,commands:any[]=[],stages:any[]=[],staff=new Map([['ops',{...renewalOps,active:true}],['finance',{...renewalFinance,active:true}]]);
 f.changes.length=0;f.quotes.length=0;f.contracts.splice(1);f.terms.length=0;
 Object.assign(f.vehicle,{reservedOrderId:f.order.id,holdId:null,modelDefinitionId:'model'});Object.assign(f.owner,{subjectType:'ENTERPRISE'});
 Object.assign(f.initial.lessorSnapshot,{subjectType:'ENTERPRISE',platformLegalEntityName:'上海宁达信息科技有限公司'});
 Object.assign(f.initial,{months:12,vehicleId:f.vehicle.id,energyDescription:'充换电费用由客户自付',conditions:'原冻结条件',mileagePerMonthKm:1500,excessMileagePriceAmount:150,usagePolicyVersion:'USAGE_V1',usagePolicy:{...usageRules,documentId:'old-usage',documentVersion:1,content:'原冻结里程条款',hash:hash('原冻结里程条款')}});
 // The original product remains its real frozen version; the new listed product has independent rules.
 Object.assign((f.initial as any).productSnapshot,{months:12,mileagePerMonthKm:1500,excessMileagePriceAmount:150,vehicleIds:['vehicle'],conditions:'原冻结条件'});
 Object.assign(f.account,{revision:2,policyVersion:'USAGE_V1',pricingSnapshot:null});f.handovers[0].completedAt=f.handovers[0].actualAt;
 const product=f.plan.productVersion;Object.assign(product,{vehicleIds:['vehicle'],months:12,mileagePerMonthKm:2400,excessMileagePriceAmount:230,swapPolicy:{version:2,period:'TERM',includedCount:0,extraFeeAmount:32100}});
 Object.assign(f.plan,{vehicleId:'vehicle',vehicle:f.vehicle});Object.assign(f.plan.listing,{vehicleId:'vehicle',snapshot:versionSnapshot(product),productSourceHash:canonicalHash(versionSnapshot(product))});
 Object.assign(f.agreementVersion,{vehicleIds:['vehicle'],validUntil:'2030-12-31'});tx.partnerAgreementVehicle.findUnique=async()=>({vehicleId:'vehicle',ownerId:f.owner.id,agreementId:f.agreement.id,agreementVersionId:f.agreementVersion.id,revision:1});
 const usageDoc={id:'new-usage',type:'usage-policy-v2',version:2,status:'PUBLISHED',confirmedBy:'legal',confirmedAt:renewalNow,content:'每月 {{baseAllowanceKm}} 公里，超额每公里 {{excessPriceYuan}} 元。'};
 const oldLegal=tx.legalDocument.findFirst;tx.legalDocument.findFirst=async(args:any)=>args.where.type==='usage-policy-v2'?usageDoc:oldLegal(args);
 f.legal.content='{{customerName}} 与 {{lessorName}} 原合同 {{originalContractNo}}。\n{{changeFacts}}\n{{periodSchedule}}\n{{financialSchedule}}';
 const oldFind=tx.legalDocument.findUnique;tx.legalDocument.findUnique=async(args:any)=>args.where.id===usageDoc.id?usageDoc:oldFind(args);
 const rows=stagePeriods(f.initial.startDate,12,1,10000),snapshot:any={version:1,kind:'INITIAL',identity:{serviceStageId:'initial:order',orderId:f.order.id,customerId:f.order.customerId,sequence:1,previousStageId:null,vehicleId:'vehicle',assignmentId:f.assignment.id,ownerId:'owner'},period:{startDate:rows[0].startDate,endDate:rows.at(-1)!.endDate,months:12,firstPeriodSequence:1,lastPeriodSequence:12},termsSnapshot:f.initial,usagePricing:freezeUsagePricing(f.initial),swapPolicy:freezeSwapPolicy(f.order),billingSchedule:rows,source:{originalTermsHash:canonicalHash(f.initial),product:null,agreement:{originalContractId:f.original.id,originalArchiveVersionId:f.rental.versions[0].id,originalArchiveHash:f.rental.versions[0].fileManifestHash,priorTermsVersionId:null,priorTermsHash:hash(f.initial),changeId:null,quoteId:null,quoteRevision:null,commercialHash:f.initial.commercialHash,approvedArchiveVersionId:null,approvedArchiveHash:null,document:null}}};
 for(const b of f.bills)b.customerId=f.customer.id;
 for(const row of rows.slice(f.bills.length))f.bills.push({id:'bill-'+row.sequence,orderId:f.order.id,customerId:f.customer.id,type:'SUBSCRIPTION',sequence:row.sequence,dueDate:new Date(row.dueDate),amount:row.amount,paidAmount:0,status:'PENDING',payments:[]});
 tx.vehicleInspectionFile={count:async()=>0};
 tx.storedFile.count=async()=>0;
 tx.application={findUnique:async()=>({id:f.order.applicationId,customerId:f.customer.id,vehicleId:f.vehicle.id,subscriptionPlanId:'original-plan'})};
 tx.archiveVersion={findUnique:async({where}:any)=>f.archives.flatMap(a=>a.versions).find(v=>v.id===where.id)??null};
 const stage={id:snapshot.identity.serviceStageId,...snapshot.identity,...snapshot.period,startDate:new Date(snapshot.period.startDate),endDate:new Date(snapshot.period.endDate),kind:'INITIAL',status:'ACTIVE',revision:0,termsVersionId:null,priorTermsVersionId:null,changeId:null,quoteId:null,approvedArchiveVersionId:null,activatedAt:f.handovers[0].completedAt,endedAt:null,snapshot,snapshotHash:canonicalHash(snapshot)};stages.push(stage);
 const update=(items:any[],where:any,data:any)=>{const row=items.find(r=>r.id===where.id);if(!row)throw Error('fixture missing '+where.id);for(const[k,v]of Object.entries(data))row[k]=v&&typeof v==='object'&&'increment'in v?(row[k]??0)+(v as any).increment:v;f.writes.push({table:'updated',id:row.id,data});return row;};
 tx.adminUser.findUnique=async({where}:any)=>staff.get(where.id)??null;
 tx.$executeRaw=async(strings:TemplateStringsArray,...values:any[])=>{f.locks.push(strings.join('?')+values.join(','));return 1;};
 tx.archiveCommand={...tx.archiveCommand,findUnique:async({where}:any)=>commands.find(c=>Object.entries(where.actorId_resourceId_action_key).every(([k,v])=>c[k]===v))??null,create:async({data}:any)=>{commands.push(data);return data;}};
 tx.order.updateMany=async({where,data}:any)=>{if(where.revision!==f.order.revision)return{count:0};update([f.order],where,data);return{count:1};};
 tx.orderServiceStage={findMany:async()=>stages,findUnique:async({where}:any)=>stages.find(s=>s.id===where.id)??null,aggregate:async()=>({_max:{lastPeriodSequence:12,sequence:1}}),create:async({data}:any)=>{stages.push(data);f.writes.push({table:'stage',data});return data;}};
 tx.orderRenewalCancellation={findFirst:async()=>null};
 tx.usagePeriod.findMany=async()=>rows.map(r=>({id:'period-'+r.sequence,...r,orderId:f.order.id,accountId:f.account.id,startDate:new Date(r.startDate),endDate:new Date(r.endDate),pricingSnapshot:null}));tx.usagePeriod.aggregate=async()=>({_max:{sequence:12}});
 tx.bill.aggregate=async()=>({_max:{sequence:12}});tx.serviceObligation.aggregate=async()=>({_max:{sequence:0}});
 tx.orderChange.findUnique=async({where}:any)=>where.id?f.changes.find(c=>c.id===where.id)??null:f.changes.find(c=>c.orderId===where.orderId_idempotencyKey.orderId&&c.idempotencyKey===where.orderId_idempotencyKey.idempotencyKey)??null;
 tx.orderChange.findMany=async({where}:any={})=>f.changes.filter(c=>(!where?.orderId||c.orderId===where.orderId)&&(!where?.id?.not||c.id!==where.id.not)&&(!where?.status?.notIn||!where.status.notIn.includes(c.status)));
 tx.orderChange.create=async({data}:any)=>{const row={id:'renewal-'+f.changes.length,revision:0,status:'DRAFT',createdAt:renewalNow,...data};f.changes.push(row);f.writes.push({table:'change',data});return row;};
 tx.orderChange.updateMany=async({where,data}:any)=>{const row=f.changes.find(c=>c.id===where.id&&c.revision===where.revision);if(!row)return{count:0};update(f.changes,where,data);return{count:1};};
 tx.delayQuote.aggregate=async({where}:any)=>({_max:{revision:Math.max(0,...f.quotes.filter(q=>q.changeId===where.changeId).map(q=>q.revision))}});
 tx.delayQuote.findMany=async({where}:any)=>f.quotes.filter(q=>q.changeId===where.changeId);
 tx.delayQuote.create=async({data}:any)=>{const row={id:'renewal-quote-'+f.quotes.length,status:'DRAFT',confirmedAt:null,financePreparedAt:null,approvedArchiveVersionId:null,...data};f.quotes.push(row);f.writes.push({table:'quote',data});return row;};
 tx.vehicleListing.findMany=async({skip=0,take=20}:any)=>[{...f.plan.listing,subscriptionPlan:f.plan}].slice(skip,skip+take);tx.vehicleListing.count=async()=>1;
 tx.productVersion={findUnique:async()=>product};tx.coverageRequirement={findMany:async()=>[{scopeType:'MODEL',versions:[{id:'coverage-req',items:[{code:'THIRD_PARTY',label:'三者',description:'真实责任要求',minAmount:100}]}]}]};
 tx.insurancePolicy={findMany:async()=>[{versions:[{id:'policy-version',policyId:'policy',version:1,status:'APPROVED',changeKind:'ORIGINAL',effectiveAt:new Date('2026-01-01'),startAt:new Date('2026-01-01'),endAt:new Date('2030-01-01'),vehicleIds:['vehicle'],fileIds:['insurance-file'],coverageItems:[{code:'THIRD_PARTY',label:'三者',amount:100,deductible:'约定免赔',terms:'明确保险责任'}],requirementVersionIds:['coverage-req'],reviewChecks:[{vehicleId:'vehicle',requirementVersionId:'coverage-req',itemCode:'THIRD_PARTY',fileId:'insurance-file',confirmed:true,note:'已核验真实范围'}]}]}]};
 return{...f,tx,product,usageDoc,commands,stages,stage,staff,db:{...tx,serial:async(fn:any)=>fn(tx)}};
}
export function renewalPreviewInput(f:ReturnType<typeof renewalFixture>){const p=listedProductSnapshot(f.plan);return{listingId:p.listingId,listingRevision:p.listingRevision,productVersionId:p.productVersionId,listingSourceHash:p.sourceHash,orderRevision:f.order.revision,accountRevision:(f.account as any).revision,reason:'按实际同车商品续期',expiresAt:'2027-09-30T15:59:59Z',settlementExplanation:'新增各期独立应收，押金维持原额',cancellationTerms:'按双方正式补充协议及真实收退款核清'};}
/** An actual prior swap chain: INITIAL keeps the original car; current terms and assignment identify its replacement. */
export function renewalAfterSwapFixture(){
 const f=renewalFixture();f.archives.splice(1);const applied=f.addChange(true),at=new Date('2026-10-20T02:00:00Z');
 Object.assign(applied.change,{kind:'VEHICLE_CHANGE',targetVehicleId:f.target.id,returnHandoverId:'prior-swap-return',deliveryHandoverId:'prior-swap-delivery'});
 applied.quote.snapshot.originalAssignmentId=f.assignment.id;
 const currentAssignment={id:'replacement-assignment',orderId:f.order.id,customerId:f.customer.id,vehicleId:f.target.id,vehicle:f.target,changeId:applied.change.id,status:'ACTIVE',startAt:at,startReadingKm:200,endAt:null,returnHandoverId:null,deliveryHandoverId:'prior-swap-delivery'};
 Object.assign(f.assignment,{status:'CLOSED',endAt:at,endReadingKm:300,returnHandoverId:'prior-swap-return'});
 f.handovers.push({id:'prior-swap-return',orderId:f.order.id,customerId:f.customer.id,changeId:applied.change.id,vehicleId:f.vehicle.id,assignmentId:f.assignment.id,type:'SWAP_RETURN',executionMode:'OFFLINE',status:'COMPLETED',actualAt:at,completedAt:at,readingKm:300},{id:'prior-swap-delivery',orderId:f.order.id,customerId:f.customer.id,changeId:applied.change.id,vehicleId:f.target.id,assignmentId:currentAssignment.id,type:'SWAP_DELIVERY',executionMode:'OFFLINE',status:'COMPLETED',actualAt:at,completedAt:at,readingKm:200});
 Object.assign(f.order,{vehicleId:f.target.id,currentAssignmentId:currentAssignment.id});Object.assign(f.target,{status:'IN_USE',reservedOrderId:f.order.id,modelDefinitionId:'model'});
 Object.assign(f.product,{vehicleIds:[f.target.id]});Object.assign(f.plan,{vehicleId:f.target.id,vehicle:f.target});Object.assign(f.plan.listing,{vehicleId:f.target.id,snapshot:versionSnapshot(f.product),productSourceHash:canonicalHash(versionSnapshot(f.product))});
 const oldProduct={...listedProductSnapshot(f.plan),monthlyFeeAmount:15000,productVersionId:'prior-swap-version'};
 applied.terms!.snapshot={...structuredClone(f.initial),commercialHash:applied.quote.commercialHash,amendmentContractId:applied.contract.id,quoteId:applied.quote.id,vehicleId:f.target.id,monthlyFeeAmount:15000,currentVehicleProductSnapshot:oldProduct,lessorSnapshot:{...structuredClone(f.initial.lessorSnapshot),vehicleId:f.target.id}};
 applied.version.scopeSnapshot=offlineChangeScope(applied.change,applied.quote,applied.contract);
 f.tx.vehicleAssignment.findUnique=async({where}:any)=>where.id===currentAssignment.id?currentAssignment:where.id===f.assignment.id?f.assignment:null;f.tx.vehicleAssignment.findFirst=async()=>currentAssignment;f.tx.vehicleAssignment.findMany=async()=>[f.assignment,currentAssignment];
 Object.assign(f.agreementVersion,{vehicleIds:[f.target.id]});f.tx.partnerAgreementVehicle.findUnique=async()=>({vehicleId:f.target.id,ownerId:f.owner.id,agreementId:f.agreement.id,agreementVersionId:f.agreementVersion.id,revision:1});
 const policies=f.tx.insurancePolicy.findMany;f.tx.insurancePolicy.findMany=async()=>{const rows=await policies();for(const row of rows)for(const v of row.versions){v.vehicleIds=[f.target.id];for(const check of v.reviewChecks)check.vehicleId=f.target.id;}return rows;};
 return{...f,applied,currentAssignment};
}
