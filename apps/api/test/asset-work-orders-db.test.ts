import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {canonicalHash} from '../src/customers/types';
import {requireVehicleUnrestricted} from '../src/vehicles/operational-restrictions';
const car=(title:string)=>({title,brand:'合成',model:'EV',year:2026,city:'上海',mileageKm:100,status:'PUBLISHED' as const});
const input=(vehicle:any,extra:any={})=>({...command(),vehicleId:vehicle.id,vehicleRevision:vehicle.revision,kind:'REPAIR',priority:'NORMAL',title:'实际维修合成测试',description:'仅本机合成实际处理记录',occurredAt:'2026-10-30T10:00:00+08:00',sourceServiceRequestId:null,relatedWorkOrderId:null,costConfirmationRequired:true,noCostReason:null,accident:null,...extra});

test('work-order HTTP operations preserve exact-key replay, append-only events, private evidence and current-role isolation',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();try{
  await h.start();const vehicle=await h.db.vehicle.create({data:car('运营工单 '+h.prefix)}),before={bills:await h.db.bill.count(),payments:await h.db.payment.count(),costs:await h.db.assetCostEntry.count()},body=input(vehicle);
  const same=await Promise.all([h.raw('/admin/asset-work-orders',body),h.raw('/admin/asset-work-orders',body)]);assert.deepEqual(same.map(result=>result.status),[201,201]);assert.deepEqual(same[0].data,same[1].data);let row=same[0].data,path='/admin/asset-work-orders/'+row.id;
  assert.equal(await h.db.assetWorkOrderEvent.count({where:{workOrderId:row.id}}),1);assert.equal(await h.db.auditLog.count({where:{resourceType:'asset-work-orders',resourceId:row.id,action:'WORK_ORDER_CREATE'}}),1);
  await h.reject('/admin/asset-work-orders',{...body,title:'改同键'},h.maker,'IDEMPOTENCY_CONFLICT');await h.reject('/admin/asset-work-orders',{...input(vehicle),title:'nul\0'},h.maker,'VALIDATION');
  await h.reject('/admin/asset-work-orders',input(vehicle),h.finance,'FORBIDDEN');for(const who of [h.support,h.field])await h.reject(path,undefined,who,'FORBIDDEN');assert.equal((await h.get(path,h.finance)).id,row.id);
  const options=await h.get('/admin/asset-work-orders/assignee-options?keyword='+h.maker.id);assert.equal(options.total,1);assert.deepEqual(Object.keys(options.items[0]).sort(),['id','name','role']);
  const file=await h.post(path+'/files',h.form(command(row.revision),'work-order-evidence'));row=await h.get(path);assert.equal(row.revision,file.revision);assert.equal(row.eventSequence,1);assert.equal(row.files[0].id,file.id);assert.equal(JSON.stringify(row).includes('storagePath'),false);await h.assertPdf(path+'/files/'+file.id,h.finance);
  const edits=await Promise.all(['一','二'].map(title=>h.raw(path,{...command(row.revision),title:'版本竞争'+title},h.maker,'PATCH')));assert.deepEqual(edits.map(result=>result.status).sort(),[200,409]);assert.equal(edits.find(result=>result.status===409)!.data.error.code,'REVISION_CONFLICT');row=await h.get(path);
  await h.reject(path+'/assign',{...command(row.revision),assigneeId:h.finance.id,providerName:'维修单位',contact:'已核对联系方式',scheduledAt:null,reason:'错误岗位'},h.maker,'ASSIGNEE_INVALID');
  row=await h.post(path+'/assign',{...command(row.revision),assigneeId:h.maker.id,providerName:'实际维修单位',contact:'已核对联系方式',scheduledAt:null,reason:'明确指派'});
  row=await h.post(path+'/start',{...command(row.revision),reason:'开始维修'});const submitted=await h.post(path+'/submit-acceptance',{...command(row.revision),solution:'修复完成待验收',fileIds:[file.id]});row=submitted;
  row=await h.post(path+'/accept',{...command(row.revision),reason:'核对维修事实和凭据',fileIds:[file.id]});assert.equal(row.status,'PENDING_COST_CONFIRMATION');const acceptedId=row.acceptedEventId;
  const event=await h.db.assetWorkOrderEvent.findUniqueOrThrow({where:{id:acceptedId}});assert.equal(event.action,'ACCEPT');assert.equal(event.workOrderId,row.id);assert.equal(event.afterRevision,row.acceptedRevision);assert.equal(event.sourceHash,canonicalHash(event.detailSnapshot));
  row=await h.post(path+'/return-for-work',{...command(row.revision),reason:'补充处理要求'});assert.equal(row.acceptedEventId,acceptedId);assert.equal(row.status,'IN_PROGRESS');assert.equal((await h.db.assetWorkOrderEvent.findUniqueOrThrow({where:{id:acceptedId}})).sourceHash,event.sourceHash);
  const events=await h.db.assetWorkOrderEvent.findMany({where:{workOrderId:row.id},orderBy:{sequence:'asc'}});assert.deepEqual(events.map(item=>item.sequence),Array.from({length:events.length},(_,index)=>index+1));assert.equal(events[1].beforeRevision,file.revision);
  assert.equal((await h.raw(path+'/close',{...command(row.revision),reason:'不存在运营关单'})).status,404);
  const list=await h.get('/admin/asset-work-orders?vehicleId='+vehicle.id);assert.equal(list.total,1);assert.equal(list.items[0].id,row.id);assert.equal((await h.raw('/admin/asset-work-orders?page=100000&pageSize=100')).status,400);
  const noCsrf={...h.maker,headers:{...h.maker.headers}};delete noCsrf.headers['X-CSRF-Token'];await h.reject(path+'/notes',{...command(row.revision),note:'无CSRF'},noCsrf);
  await h.db.adminUser.update({where:{id:h.maker.id},data:{authVersion:{increment:1}}});await h.reject('/admin/asset-work-orders',body,h.maker);
  assert.equal(await h.db.bill.count(),before.bills);assert.equal(await h.db.payment.count(),before.payments);assert.equal(await h.db.assetCostEntry.count(),before.costs);assert.equal(h.externalCalls+h.identityCalls+h.esignCalls+h.payment.providerCalls,0);
 }finally{await h.close();}
});

test('maintenance acceptance and explicit restriction release preserve vehicle mileage; restriction versus locked allocation has only one winner',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();try{
  await h.start();const vehicle=await h.db.vehicle.create({data:car('保养与限制 '+h.prefix)});let row=await h.post('/admin/asset-work-orders',input(vehicle,{kind:'MAINTENANCE',costConfirmationRequired:false,noCostReason:'厂家保修'})),path='/admin/asset-work-orders/'+row.id;
  const file=await h.post(path+'/files',h.form(command(row.revision),'maintenance-proof'));row=await h.get(path);
  row=await h.post(path+'/restrictions',{...command(row.revision),vehicleRevision:0,scopes:['ALLOCATION','DELIVERY'],reason:'保养完成待明确恢复',fileIds:[file.id]});const restriction=row.restrictions[0];
  await assert.rejects(h.db.serial(tx=>requireVehicleUnrestricted(tx,vehicle.id,'ALLOCATION')),(error:any)=>error.getResponse().error.code==='VEHICLE_ALLOCATION_RESTRICTED');
  await assert.rejects(h.db.serial(tx=>requireVehicleUnrestricted(tx,vehicle.id,'DELIVERY')),(error:any)=>error.getResponse().error.code==='VEHICLE_DELIVERY_RESTRICTED');
  row=await h.post(path+'/start',{...command(row.revision),reason:'开始保养'});const completion={completedOn:'2026-10-30',mileageKm:200,nextDueDate:'2027-04-30',nextDueMileageKm:10000,scheduleRevision:0,reason:'按明确保养规则'};
  row=await h.post(path+'/submit-acceptance',{...command(row.revision),solution:'保养已完成',fileIds:[file.id],maintenance:completion});assert.equal(await h.db.vehicleMaintenanceSchedule.count({where:{vehicleId:vehicle.id}}),0);
  await h.post('/admin/vehicle-maintenance/'+vehicle.id,{...command(),vehicleRevision:1,nextDueDate:'2027-05-01',nextDueMileageKm:null,reason:'同期明确调整'},h.maker,'PATCH');
  await h.reject(path+'/accept',{...command(row.revision),reason:'不可覆盖新提醒',fileIds:[file.id]},h.maker,'REVISION_CONFLICT');
  row=await h.post(path+'/return-for-work',{...command(row.revision),reason:'重新确认提醒'});row=await h.post(path+'/submit-acceptance',{...command(row.revision),solution:'已重核保养规则',fileIds:[file.id],maintenance:{...completion,scheduleRevision:1}});row=await h.post(path+'/accept',{...command(row.revision),reason:'核验保养完成',fileIds:[file.id]});assert.equal(row.status,'CLOSED');
  const schedule=await h.get('/admin/vehicle-maintenance/'+vehicle.id);assert.equal(schedule.lastCompletedOn,'2026-10-30');assert.equal(schedule.lastMileageKm,200);assert.equal(schedule.sourceWorkOrderId,row.id);assert.equal((await h.db.vehicle.findUniqueOrThrow({where:{id:vehicle.id}})).mileageKm,100);await h.reject('/admin/vehicle-maintenance/'+vehicle.id,undefined,h.finance,'FORBIDDEN');
  await h.reject(path+'/files',h.form(command(row.revision),'late-upload'),h.maker,'ASSET_SOURCE_CLOSED');row=await h.post(path+'/restrictions/'+restriction.id+'/release',{...command(row.revision),vehicleRevision:1,restrictionRevision:restriction.revision,reason:'明确解除原限制',fileIds:[file.id]});assert.equal(row.status,'CLOSED');assert.equal(row.restrictions[0].status,'RELEASED');assert.deepEqual(row.restrictions[0].evidenceFileIds,[file.id]);await h.db.serial(tx=>requireVehicleUnrestricted(tx,vehicle.id,'DELIVERY'));
  // Controlled competing mutation uses the same real Vehicle lock and production
  // allocation helper; this tests serialization, not a fabricated new order flow.
  const raceVehicle=await h.db.vehicle.create({data:car('占车竞争 '+h.prefix)});let race=await h.post('/admin/asset-work-orders',input(raceVehicle));const racePath='/admin/asset-work-orders/'+race.id,raceFile=await h.post(racePath+'/files',h.form(command(race.revision),'race-proof'));race=await h.get(racePath);
  const allocation=h.db.serial(async tx=>{await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${raceVehicle.id} FOR UPDATE`;await requireVehicleUnrestricted(tx,raceVehicle.id,'ALLOCATION');return tx.vehicle.update({where:{id:raceVehicle.id},data:{reservedOrderId:'synthetic-reservation-'+randomUUID(),revision:{increment:1}}});});
  const [allocated,restricted]=await Promise.allSettled([allocation,h.raw(racePath+'/restrictions',{...command(race.revision),vehicleRevision:0,scopes:['ALLOCATION'],reason:'实际处理阻断',fileIds:[raceFile.id]})]);assert.equal(restricted.status,'fulfilled');const result=(restricted as PromiseFulfilledResult<any>).value;
  if(allocated.status==='fulfilled'){assert.equal(result.status,409);assert.equal(result.data.error.code,'REVISION_CONFLICT');assert.equal(await h.db.vehicleOperationalRestriction.count({where:{vehicleId:raceVehicle.id,status:'ACTIVE'}}),0);}else{assert.equal(result.status,201);assert.equal(allocated.reason.getResponse().error.code,'VEHICLE_ALLOCATION_RESTRICTED');assert.equal((await h.db.vehicle.findUniqueOrThrow({where:{id:raceVehicle.id}})).reservedOrderId,null);}
  assert.equal(h.externalCalls+h.identityCalls+h.esignCalls+h.payment.providerCalls,0);
 }finally{await h.close();}
});

test('service source HTTP accepts only the actual vehicle assignment interval and complete same-person delivery/return facts',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();try{
  await h.start();const customer=await h.customer('work-order-source'),initial=await h.db.vehicle.create({data:car('初始车 '+h.prefix)}),actual=await h.db.vehicle.create({data:car('换后实际车 '+h.prefix)});
  // Controlled historical fixture: immutable business facts only, no signing or payment call.
  const plan=await h.db.subscriptionPlan.create({data:{vehicleId:initial.id,name:'合成历史计划',months:1,monthlyFeeAmount:10000,mileagePerMonthKm:2000,excessMileagePriceAmount:100,energyDescription:'自付',benefits:[],conditions:''}});
  const application=await h.db.application.create({data:{customerId:customer.id,vehicleId:initial.id,subscriptionPlanId:plan.id,profile:{},consents:[],idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}});
  const order=await h.db.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:initial.id,status:'ACTIVE',contractMode:'OFFLINE',finalPlanSnapshot:{synthetic:true},confirmedMileageKm:100}});
  const swapAt=new Date('2026-10-01T00:00:00Z'),initialAt=new Date('2026-09-01T00:00:00Z');
  const change=await h.db.orderChange.create({data:{orderId:order.id,customerId:customer.id,kind:'VEHICLE_CHANGE',status:'APPLIED',targetVehicleId:actual.id,actualCompletedAt:swapAt,priorTermsHash:'a'.repeat(64),priorTerms:{synthetic:true},originalContractId:'synthetic-historical-contract',reason:'实际换车历史',createdBy:h.maker.id,idempotencyKey:randomUUID(),requestHash:'b'.repeat(64)}});
  const old=await h.db.vehicleAssignment.create({data:{orderId:order.id,customerId:customer.id,vehicleId:initial.id,startAt:initialAt,startReadingKm:10,endAt:swapAt,endReadingKm:60,status:'CLOSED'}});
  const handoverBase={orderId:order.id,customerId:customer.id,status:'COMPLETED',executionMode:'OFFLINE',fileIds:[],checklist:{synthetic:true},manifestHash:'a'.repeat(64)};
  const initialDelivery=await h.db.handover.create({data:{...handoverBase,vehicleId:initial.id,assignmentId:old.id,type:'DELIVERY',actualAt:initialAt,readingKm:10}});
  const swapReturn=await h.db.handover.create({data:{...handoverBase,vehicleId:initial.id,assignmentId:old.id,changeId:change.id,type:'SWAP_RETURN',actualAt:swapAt,readingKm:60}});
  await h.db.vehicleAssignment.update({where:{id:old.id},data:{deliveryHandoverId:initialDelivery.id,returnHandoverId:swapReturn.id}});
  const assignment=await h.db.vehicleAssignment.create({data:{orderId:order.id,customerId:customer.id,vehicleId:actual.id,changeId:change.id,startAt:swapAt,startReadingKm:100,status:'ACTIVE'}});
  const delivery=await h.db.handover.create({data:{...handoverBase,vehicleId:actual.id,assignmentId:assignment.id,changeId:change.id,type:'SWAP_DELIVERY',actualAt:assignment.startAt,readingKm:100}});await h.db.vehicleAssignment.update({where:{id:assignment.id},data:{deliveryHandoverId:delivery.id}});
  await h.db.orderChange.update({where:{id:change.id},data:{returnHandoverId:swapReturn.id,deliveryHandoverId:delivery.id}});
  const source=await h.db.serviceRequest.create({data:{orderId:order.id,customerId:customer.id,type:'ACCIDENT',location:'实际车辆现场',description:'客户来源线索',mobile:'synthetic-mobile',fileIds:[],idempotencyKey:randomUUID(),requestHash:'b'.repeat(64)}});
  const binding=async(vehicleId:string,eventAt='2026-10-30T10:00:00+08:00')=>{const detail=await h.get('/admin/asset-work-orders/service-source-options/'+source.id+'?'+new URLSearchParams({vehicleId,eventAt}));return{sourceServiceRequestId:source.id,sourceServiceRequestRevision:detail.revision,sourceServiceRequestHash:detail.sourceHash};};
  const currentBinding=await binding(actual.id),body=input(actual,currentBinding),made=await h.post('/admin/asset-work-orders',body);assert.equal(made.sourceServiceSnapshot.assignmentId,assignment.id);assert.equal(made.sourceServiceSnapshot.vehicleId,actual.id);assert.equal((await h.db.serviceRequest.findUniqueOrThrow({where:{id:source.id}})).status,'SUBMITTED');
  const beforeSwap=await h.post('/admin/asset-work-orders',input(initial,{...await binding(initial.id,'2026-09-15T00:00:00Z'),occurredAt:'2026-09-15T00:00:00Z'}));assert.equal(beforeSwap.sourceServiceSnapshot.assignmentId,old.id);assert.equal(beforeSwap.sourceServiceSnapshot.returnHandoverId,swapReturn.id);
  await h.reject('/admin/asset-work-orders',input(initial,{...currentBinding,occurredAt:swapAt.toISOString()}),h.maker,'SERVICE_SOURCE_UNVERIFIED');
  assert.equal((await h.post('/admin/asset-work-orders',input(actual,{...await binding(actual.id,swapAt.toISOString()),occurredAt:swapAt.toISOString()}))).sourceServiceSnapshot.deliveryHandoverId,delivery.id);
  await h.db.orderChange.update({where:{id:change.id},data:{deliveryHandoverId:'wrong-handover'}});await h.reject('/admin/asset-work-orders',{...body,...command()},h.maker,'SERVICE_SOURCE_UNVERIFIED');await h.db.orderChange.update({where:{id:change.id},data:{deliveryHandoverId:delivery.id}});
  await h.reject('/admin/asset-work-orders',input(initial,currentBinding),h.maker,'SERVICE_SOURCE_UNVERIFIED');
  const end=new Date('2026-10-30T03:00:00Z');await h.db.vehicleAssignment.update({where:{id:assignment.id},data:{status:'CLOSED',endAt:end,endReadingKm:200}});await h.reject('/admin/asset-work-orders',{...body,...command()},h.maker,'SERVICE_SOURCE_UNVERIFIED');
  const returned=await h.db.handover.create({data:{orderId:order.id,customerId:customer.id,vehicleId:actual.id,assignmentId:assignment.id,type:'RETURN',status:'COMPLETED',actualAt:end,readingKm:200,executionMode:'OFFLINE',fileIds:[],checklist:{synthetic:true},manifestHash:'c'.repeat(64)}});await h.db.vehicleAssignment.update({where:{id:assignment.id},data:{returnHandoverId:returned.id}});
  assert.equal((await h.post('/admin/asset-work-orders',{...body,...await binding(actual.id),...command()})).sourceServiceSnapshot.returnHandoverId,returned.id);await h.reject('/admin/asset-work-orders',{...body,...command(),occurredAt:end.toISOString()},h.maker,'SERVICE_SOURCE_UNVERIFIED');
  await h.db.handover.update({where:{id:returned.id},data:{customerId:'wrong-customer'}});await h.reject('/admin/asset-work-orders',{...body,...command()},h.maker,'SERVICE_SOURCE_UNVERIFIED');assert.equal((await h.post('/admin/asset-work-orders',input(actual))).sourceServiceSnapshot,null);
  assert.equal(h.externalCalls+h.identityCalls+h.esignCalls+h.payment.providerCalls,0);
 }finally{await h.close();}
});
