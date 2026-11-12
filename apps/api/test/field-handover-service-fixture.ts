import {FieldHandoverService} from '../src/field-handover/service';
export function fieldServiceFixture(){
 const manager={id:'manager',role:'ADMIN',authVersion:0,active:true,name:'运营'},field={id:'field',role:'FIELD',authVersion:0,active:true,name:'现场'};
 const order:any={id:'order',customerId:'customer',vehicleId:'car',currentAssignmentId:null,effectiveTermsVersionId:null,contractMode:'ESIGN',status:'AWAITING_HANDOVER',confirmedMileageKm:100,revision:0,finalPlanSnapshot:{commercialTerms:{vehicleIdentification:'车辆身份',handoverArrangement:'现场核对'}}};
 const data:any={adminUser:[manager,field],order:[order],vehicle:[{id:'car',title:'原车辆',plateNumber:'沪测',mileageKm:100,reservedOrderId:'order',status:'RESERVED'}],orderTermsVersion:[],orderChange:[],delayQuote:[],vehicleAssignment:[],handover:[],fieldHandoverTask:[],storedFile:[],auditLog:[],notification:[],documentArchive:[],vehicleReturnReceipt:[]};
 const calls:string[]=[];let serial=0;
 function matches(row:any,where:any):boolean{return !where||Object.entries(where).every(([key,value]:any)=>{
  if(key==='OR')return value.some((part:any)=>matches(row,part));if(key==='AND')return value.every((part:any)=>matches(row,part));
  if(key==='change')return matches(data.orderChange.find((c:any)=>c.id===row.changeId),value);
  if(value&&typeof value==='object'&&!Array.isArray(value)){if('notIn' in value)return !value.notIn.includes(row[key]);if('in' in value)return value.in.includes(row[key]);if('not' in value)return row[key]!==value.not;if('contains' in value)return String(row[key]).includes(value.contains);}
  return row?.[key]===value;
 });}
 function projected(model:string,row:any,args:any){if(!row)return null;if(model==='fieldHandoverTask'&&args.include)return{...row,assignee:data.adminUser.find((u:any)=>u.id===row.assigneeId),order:{...order,vehicle:data.vehicle.find((v:any)=>v.id===order.vehicleId),customer:{name:'客户'}}};return row;}
 const tx:any={vehicleInspectionFile:{count:async()=>0},electronicFileQuarantine:{count:async()=>0},$queryRaw:async(strings:any,...values:any[])=>{calls.push('lock:'+strings.join('?')+':'+values.join(','));return[];},$executeRaw:async()=>0,vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},vehicleReceiptEvent:{findFirst:async()=>null},vehicleOperationalRestriction:{count:async()=>0},usageSegment:{aggregate:async()=>({_max:{endReadingKm:0}})},usagePeriod:{aggregate:async()=>({_max:{endReadingKm:0}})}};
 for(const model of Object.keys(data))tx[model]={
  findUnique:async(args:any)=>{calls.push('read:'+model);return projected(model,data[model].find((r:any)=>matches(r,args.where)),args);},
  findUniqueOrThrow:async(args:any)=>{calls.push('read:'+model);const row=projected(model,data[model].find((r:any)=>matches(r,args.where)),args);if(!row)throw Error('Missing '+model);return row;},
  findFirst:async(args:any={})=>projected(model,data[model].find((r:any)=>matches(r,args.where)),args),
  findMany:async(args:any={})=>data[model].filter((r:any)=>matches(r,args.where)).slice(args.skip||0,args.take===undefined?undefined:(args.skip||0)+args.take).map((r:any)=>projected(model,r,args)),
  count:async(args:any={})=>data[model].filter((r:any)=>matches(r,args.where)).length,
  create:async(args:any)=>{calls.push('write:'+model);const row={id:model+'-'+ ++serial,...(model==='fieldHandoverTask'?{status:'ASSIGNED',version:0,materialGeneration:0,draft:{},currentHandoverId:null,lastPublishKey:null,lastPublishVersion:null}:{}),...(model==='handover'?{status:'DRAFT',revision:1,changeId:null,signatureStatus:'DRAFT'}:{}),...args.data};data[model].push(row);return row;},
  update:async(args:any)=>{calls.push('write:'+model);const row=data[model].find((r:any)=>matches(r,args.where));if(!row)throw Error('Missing '+model);for(const [k,v]of Object.entries(args.data))row[k]=v&&typeof v==='object'&&'increment'in v?row[k]+(v as any).increment:v;return row;},
  updateMany:async(args:any)=>{const rows=data[model].filter((r:any)=>matches(r,args.where));for(const row of rows)await tx[model].update({where:{id:row.id},data:args.data});return{count:rows.length};}
 };
 const db:any={serial:async(fn:any)=>fn(tx),...tx},service=new FieldHandoverService(db);
 function task(extra:any={}){const row:any={id:'task-'+ ++serial,orderId:order.id,type:'DELIVERY',batchKey:'DELIVERY:INITIAL',changeId:null,quoteId:null,termsVersionId:null,vehicleId:'car',vehicleAssignmentId:null,assigneeId:field.id,status:'ASSIGNED',version:0,materialGeneration:0,draft:{},currentHandoverId:null,note:'',createdBy:manager.id,updatedBy:manager.id,...extra};data.fieldHandoverTask.push(row);return row;}
 function swap(returned=false){
  order.status='ACTIVE';order.currentAssignmentId='assignment';data.vehicle[0].status='IN_USE';
  const when=new Date('2026-10-01T00:00:00Z'),delivery={id:'delivery',orderId:order.id,customerId:order.customerId,vehicleId:'car',assignmentId:'assignment',changeId:null,type:'DELIVERY',status:'COMPLETED',actualAt:when,readingKm:100};
  const a:any={id:'assignment',orderId:order.id,customerId:order.customerId,vehicleId:'car',changeId:null,status:'ACTIVE',startAt:when,startReadingKm:100,endAt:null,endReadingKm:null,deliveryHandoverId:delivery.id,returnHandoverId:null};
  const c:any={id:'change',orderId:order.id,customerId:order.customerId,kind:'VEHICLE_CHANGE',status:'AWAITING_FINANCE',activeQuoteId:'quote',targetVehicleId:'target',returnHandoverId:null,deliveryHandoverId:null};
  const q:any={id:'quote',changeId:c.id,revision:1,status:'CONFIRMED',contract:{status:'DRAFT'},snapshot:{originalAssignmentId:a.id,targetVehicleId:'target',plannedReturnAt:new Date().toISOString(),plannedDeliveryAt:new Date().toISOString()}};
  data.handover.push(delivery);data.vehicleAssignment.push(a);data.orderChange.push(c);data.delayQuote.push(q);data.vehicle.push({id:'target',title:'目标车辆',mileageKm:50,status:'PUBLISHED'});
  if(returned){const at=new Date('2026-10-02T00:00:00Z'),h={id:'returned',orderId:order.id,customerId:order.customerId,vehicleId:'car',assignmentId:a.id,changeId:c.id,type:'SWAP_RETURN',status:'COMPLETED',actualAt:at,readingKm:90000};data.handover.push(h);Object.assign(a,{status:'CLOSED',endAt:at,endReadingKm:90000,returnHandoverId:h.id});Object.assign(c,{status:'SWAP_RETURNED',returnHandoverId:h.id});order.currentAssignmentId=null;order.confirmedMileageKm=90000;data.vehicle[0].mileageKm=90000;}
  return{change:c,quote:q,assignment:a};
 }
 return{manager,field,order,data,tx,db,service,calls,task,swap};
}
