import {offlineDelayFixture} from './offline-delivery-delay-fixture';
import {hash} from '../src/common/data';
import {canonicalHash} from '../src/customers/types';
import {listedProductSnapshot,versionSnapshot} from '../src/products/snapshot';
import {termSwapFixture} from './term-swap-fixture';

export const swapOps={id:'ops',role:'OPERATIONS',authVersion:1};
export function offlineSwapFixture(){
 const f=offlineDelayFixture(),tx=f.tx,store=termSwapFixture(),locks:string[]=[],holds:any[]=[],credits=store.credits,reservations=store.reservations,ledger=store.ledger;
 tx.storedFile.count=async()=>0;tx.vehicleInspectionFile={count:async()=>0};tx.electronicFileQuarantine={count:async()=>0};
 const vehicle:any={id:'vehicle',title:'原车',vin:'ORIGINAL',plateNumber:null,status:'IN_USE',revision:1},target:any={id:'target',title:'换入车',vin:'TARGET',plateNumber:null,status:'PUBLISHED',revision:1,reservedOrderId:null,holdId:null};
 const assignment:any={id:'assignment',orderId:'order',customerId:'customer',vehicleId:'vehicle',vehicle,startAt:new Date('2026-10-01T00:00:00+08:00'),startReadingKm:100,status:'ACTIVE',endAt:null,deliveryHandoverId:'delivery'};
 const handovers:any[]=[{id:'delivery',orderId:'order',customerId:'customer',vehicleId:'vehicle',assignmentId:'assignment',type:'DELIVERY',executionMode:'OFFLINE',status:'COMPLETED',actualAt:assignment.startAt,readingKm:100}];
 const account={id:'usage',orderId:'order',customerId:'customer',startedOn:new Date('2026-10-01'),returnedOn:null,packKm:1200};
 const product:any={id:'target-version',productId:'target-product',version:2,configurationVersion:2,status:'PUBLISHED',name:'明确升级产品',months:12,baseFeeAmount:20000,mileageMonthlyFeeAmount:0,monthlyFeeAmount:20000,mileagePerMonthKm:2400,excessMileagePriceAmount:230,swapPolicy:{version:2,period:'TERM',includedCount:99,extraFeeAmount:99000},energyDescription:'充换电费用由客户自付',conditions:'明确条件',vehicleIds:['target'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]};
 const productSnapshot=versionSnapshot(product),plan:any={id:'target-plan',vehicleId:'target',productVersionId:product.id,vehicle:target,productVersion:product,active:true,listing:{id:'target-listing',revision:2,vehicleId:'target',subscriptionPlanId:'target-plan',productVersionId:product.id,status:'PUBLISHED',visible:true,source:'EXPLICIT',snapshot:productSnapshot,productSourceHash:canonicalHash(productSnapshot)}};
 Object.assign(f.initial,{productSnapshot:{...structuredClone(productSnapshot),productId:'original-product',productVersionId:'original-version',monthlyFeeAmount:10000,baseFeeAmount:10000,swapPolicy:{version:2,period:'TERM',includedCount:2,extraFeeAmount:50000}}});
 Object.assign(f.order,{status:'ACTIVE',currentAssignmentId:assignment.id});Object.assign(f.change,{kind:'VEHICLE_CHANGE',status:'DRAFT',activeQuoteId:null,priorTerms:structuredClone(f.initial),priorTermsHash:hash(f.initial),requestHash:null});
 f.quotes.length=0;
 tx.orderServiceStage={findMany:async()=>[]};tx.orderChange.findMany=async(args:any)=>{const rows=f.changes,w=args?.where;return rows.filter((c:any)=>(!w?.kind||c.kind===w.kind)&&(!w?.status?.notIn||!w.status.notIn.includes(c.status)));};
 const owner:any={id:'owner',name:'原出租方',status:'ACTIVE',subjectType:'ENTERPRISE',creditCode:'credit',address:'地址',contactPhone:'13800000001',revision:1};
 const agreement:any={id:'simple-agreement',ownerId:'owner',status:'ACTIVE',currentVersionId:'simple-version'},version:any={id:'simple-version',agreementId:agreement.id,ownerId:'owner',status:'ACTIVE',vehicleIds:['target'],fileIds:['simple-file'],partnerRateBps:8000,contentHash:hash('simple'),title:'目标车辆完整租期合作',validFrom:'2026-01-01',validUntil:'2027-12-31'};
 f.files.push({id:'simple-file',adminId:'ops',customerId:null,purpose:'contract',mimeType:'application/pdf',sha256:hash('simple-file')});
 tx.$queryRaw=async(strings:TemplateStringsArray,...values:any[])=>{locks.push(strings.join('?')+values.join(','));return[];};
 tx.order.findFirst=async({where}:any)=>where.id===f.order.id&&(!where.customerId||where.customerId===f.order.customerId)?f.order:null;
 tx.vehicle={findUnique:async({where}:any)=>where.id==='vehicle'?vehicle:where.id==='target'?target:null,update:async({where,data}:any)=>{const row=where.id==='vehicle'?vehicle:target;Object.assign(row,data);f.writes.push({table:'vehicle',data});return row;},updateMany:async({where,data}:any)=>{if(target.id===where.id&&(!where.holdId||target.holdId===where.holdId)){Object.assign(target,data);f.writes.push({table:'vehicle',data});return{count:1};}return{count:0};}};
 tx.vehicleListing={findUnique:async({where}:any)=>where.id===plan.listing.id?plan.listing:null};tx.subscriptionPlan={findUnique:async({where}:any)=>where.id===plan.id?plan:null};
 tx.vehicleAssignment={count:async()=>1,findFirst:async()=>assignment,findUnique:async()=>assignment,findMany:async()=>[assignment]};
 tx.handover.findUnique=async({where}:any)=>handovers.find(h=>h.id===where.id)||null;
 tx.usageAccount={findUnique:async()=>account,findUniqueOrThrow:async()=>account};tx.usagePeriod={count:async()=>0,findFirstOrThrow:async()=>({endDate:new Date('2027-01-01')})};
 tx.vehicleOperationalRestriction={count:async()=>0};tx.payment={findMany:async()=>[]};
 tx.partnerAgreementVehicle={findUnique:async()=>({vehicleId:'target',ownerId:owner.id,agreementId:agreement.id,agreementVersionId:version.id,revision:1})};tx.partnerAgreement={findUnique:async()=>agreement};tx.partnerAgreementVersion={findUnique:async()=>version};tx.vehicleOwner={findUnique:async()=>owner};
 const oldLegal=tx.legalDocument.findFirst;tx.legalDocument.findFirst=async(args:any)=>['OFFLINE_RENTAL','owner-data-sharing'].includes(args.where.type)?{id:args.where.type,type:args.where.type,version:1,status:'PUBLISHED',confirmedBy:'reviewer',confirmedAt:new Date(),content:'实际主体 {{lessorName}}'}:oldLegal(args);
 tx.vehicleHold={findUnique:async({where}:any)=>holds.find(h=>h.id===where.id)||null,findMany:async({where}:any)=>holds.filter(h=>h.changeId===where.changeId&&h.status===where.status),create:async({data}:any)=>{const h={id:'hold-'+holds.length,status:'HELD',...data};holds.push(h);f.writes.push({table:'hold',data});return h;},update:async({where,data}:any)=>{const h=holds.find(h=>h.id===where.id);Object.assign(h,data);f.writes.push({table:'hold',data});return h;}};
 tx.swapCredit=store.tx.swapCredit;tx.swapReservation=store.tx.swapReservation;tx.swapLedger=store.tx.swapLedger;
 tx.swapCreditPurchase={findMany:async()=>[],findFirst:async()=>null,count:async()=>0};
 tx.delayQuote.create=async({data}:any)=>{const q={id:'swap-quote-'+f.quotes.length,status:'DRAFT',...data};f.quotes.push(q);f.writes.push({table:'quote',data});return q;};
 return{...f,tx,locks,holds,credits,reservations,ledger,vehicle,target,assignment,handovers,account,plan,owner,agreement,agreementVersion:version,db:{...tx,serial:async(fn:any)=>fn(tx)}};
}
export function swapV2Input(f:ReturnType<typeof offlineSwapFixture>){const p=listedProductSnapshot(f.plan);return{pricingVersion:2,revision:f.change.revision,idempotencyKey:'swap-v2-quote-key',targetListingId:p.listingId,targetListingRevision:p.listingRevision,targetSourceHash:p.sourceHash,plannedReturnAt:'2026-11-01T09:00:00+08:00',plannedDeliveryAt:'2026-11-01T10:00:00+08:00',depositAmount:0,depositBasis:'押金不变',insuranceResponsibility:'按原合同责任',downtimeArrangement:'当天无车期间明确安排',settlementExplanation:'差价按原服务月计收',handoverArrangement:'分别核对归还与交付',cancellationTerms:'按原合同办理',reason:'客户升级用车',expiresAt:'2099-12-31T00:00:00Z',externalCompensationRequired:false};}
