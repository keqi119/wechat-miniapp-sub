import {randomUUID} from 'node:crypto';
import {HttpException} from '@nestjs/common';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit} from '../common/data';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {listBaasFileRecords,requireAssetFiles} from '../files/asset-files';
import {assetCommand} from '../asset-costs/command';
import {baasTerms,generateCostPlans,loadCostSource,previewCostPlans,requireBaasCompleteTerms} from '../asset-costs/source';
import {dateOnly,storedDate} from '../asset-costs/types';
import {readBaasPaymentSummaries} from './payment-summary';
import {assetVehicleSelect,assetVehicleView} from '../vehicle-assets/service';
import {baasContextInput,baasPayerOptionsInput,baasCreateInput,baasGenerateInput,baasListInput,baasOptionsInput,baasMetadataFields,baasMetadataInput,baasMissingFields,financialMissingFields,baasPatchInput,baasPreviewInput,baasTransitionInput,type BaasTransition} from './types';
import {baasValidity,shanghaiDate,type BaasValidityGroup} from './validity';
import {actualBaasContractNumber,readBaasRegistration,registrationCache,requireBaasRegistration} from './registration';
import {readPartnerRegistrationCandidates} from '../vehicles/partner-registration';

export function baasView(row:any,vehicle?:any,today=shanghaiDate(new Date())){const terms=baasTerms(row);return{id:row.id,vehicleId:row.vehicleId,revision:row.revision,status:row.status,...terms,supplierOrderNumber:row.supplierOrderNumber??null,batteryBrand:row.batteryBrand??null,lesseeName:row.lesseeName??null,lesseeCreditCode:row.lesseeCreditCode??null,payerOwnerId:row.payerOwnerId??null,actualContractNumber:actualBaasContractNumber(row),missingFields:baasMissingFields(terms),financialMissingFields:financialMissingFields(terms),firstCostPeriod:row.firstCostPeriod??null,termsHash:row.termsHash,activatedAt:row.activatedAt??null,suspendedAt:row.suspendedAt??null,terminatedAt:row.terminatedAt??null,archivedAt:row.archivedAt??null,createdAt:row.createdAt,updatedAt:row.updatedAt,...baasValidity(row,today),...(vehicle?{vehicle:assetVehicleView(vehicle)}:{})};}
const storedTerms=(terms:any)=>({...terms,effectiveFrom:terms.effectiveFrom===null?null:storedDate(terms.effectiveFrom),effectiveTo:terms.effectiveTo===null?null:storedDate(terms.effectiveTo)});
const metadata=(input:any,create=false)=>baasMetadataInput.parse(Object.fromEntries(Object.keys(baasMetadataFields).filter(field=>create||Object.hasOwn(input,field)).map(field=>[field,input[field]??null])));
const commandPrevious=(id:string|null|undefined)=>id==null||id===''||id==='无'?null:id;
function filterWhere(input:any){
 const where:any={...(input.vehicleId?{vehicleId:input.vehicleId}:{}),...(input.status?{status:input.status}:{})},vehicle:any={};
 const match=(field:string)=>input[field+'Exact']!==undefined?{equals:input[field+'Exact']}:input[field]!==undefined?{contains:input[field],mode:'insensitive'}:undefined;
 for(const field of ['provider','lesseeName']){const value=match(field);if(value)where[field]=value;}
 for(const field of ['brand','model']){const value=match(field);if(value)vehicle[field]=value;}
 if(input.keyword)vehicle.OR=[{vin:{contains:input.keyword,mode:'insensitive'}},{plateNumber:{contains:input.keyword,mode:'insensitive'}}];
 if(Object.keys(vehicle).length)where.vehicle={is:vehicle};return where;
}
export class BaasService{
 constructor(private readonly clock:()=>Date=()=>new Date()){}
 private async read(tx:any,id:string){const row=await tx.vehicleBaasContract.findUnique({where:{id}});ensure(row,404,'NOT_FOUND','BAAS 合同不存在');return row;}
 private async previous(tx:any,vehicleId:string,previousId:string|null,currentId?:string){
  if(!previousId)return;const previous=await tx.vehicleBaasContract.findUnique({where:{id:previousId}});
  if(!previous||previous.id===currentId||previous.vehicleId!==vehicleId||!previous.activatedAt||previous.status==='DRAFT')throw new HttpException({error:{code:'BAAS_PREVIOUS_CONTRACT',field:'previousContractId',message:'承接合同不存在或不符合条件，请选择同车曾启用的其他合同，或选择无承接合同'}},409);
 }
 private async payer(tx:any,payerId:string|null|undefined){if(payerId==null)return;const row=await tx.vehicleOwner.findUnique({where:{id:payerId}});if(!row||row.status==='SUSPENDED')throw new HttpException({error:{code:'BAAS_PAYER_INVALID',field:'payerOwnerId',message:'代付人不存在或已停用，请从系统合作商主数据中选择'}},409);}
 async list(tx:any,actor:StaffActor,query:unknown){
  await requireCurrentStaff(tx,actor,'baas-contracts',false);const input=baasListInput.parse(query),today=shanghaiDate(this.clock()),cache=registrationCache();
  const rows=await tx.vehicleBaasContract.findMany({where:filterWhere(input),include:{vehicle:{select:assetVehicleSelect}},orderBy:[{createdAt:'desc'},{id:'asc'}]});
  const projected=await Promise.all(rows.map(async(row:any)=>{const registration=await readBaasRegistration(tx,row,actor,cache);return{row,registration,validity:baasValidity(row,today,registration.readiness.ready)};}));
  const groups:BaasValidityGroup[]=['CURRENT','EXPIRED','OTHER'],groupCounts=Object.fromEntries(groups.map(group=>[group,projected.filter(item=>item.validity.validityGroup===group).length])),filtered=input.group?projected.filter(item=>item.validity.validityGroup===input.group):projected,total=filtered.length,page=filtered.slice((input.page-1)*input.pageSize,input.page*input.pageSize),summaries=await readBaasPaymentSummaries(tx,page.map(item=>item.row));
  const items=await Promise.all(page.map(async({row,registration,validity}:any)=>({...baasView(row,row.vehicle,today),...validity,registrationReadiness:registration.readiness,currentPayer:registration.payer,...summaries.get(row.id),files:await listBaasFileRecords(tx,actor,row.id)})));return{items,total,page:input.page,pageSize:input.pageSize,serverDate:today,groupCounts};
 }
 async payerOptions(tx:any,actor:StaffActor,raw:unknown){await requireCurrentStaff(tx,actor,'baas-contracts',false);const input=baasPayerOptionsInput.parse(raw),where={status:{not:'SUSPENDED'},...(input.keyword?{name:{contains:input.keyword,mode:'insensitive'}}:{})},[items,total]=await Promise.all([tx.vehicleOwner.findMany({where,select:{id:true,name:true},orderBy:[{name:'asc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize}),tx.vehicleOwner.count({where})]);return{items,total,page:input.page,pageSize:input.pageSize};}
 async registrationContext(tx:any,actor:StaffActor,raw:unknown){
  await requireCurrentStaff(tx,actor,'baas-contracts');const input=baasContextInput.parse(raw),[vehicle,profile]=await Promise.all([tx.vehicle.findUnique({where:{id:input.vehicleId}}),tx.vehicleAssetProfile.findUnique({where:{vehicleId:input.vehicleId}})]);ensure(vehicle,404,'NOT_FOUND','车辆不存在');
  const row=input.contractId?await this.read(tx,input.contractId):null;ensure(!row||row.vehicleId===input.vehicleId,404,'NOT_FOUND','BaaS合同不属于此车辆');const registration=row?await readBaasRegistration(tx,row,actor):null;
  const [simple,legacy,candidates]=await Promise.all([tx.partnerAgreementVehicle.findUnique({where:{vehicleId:input.vehicleId}}),tx.ownerVehicle.findUnique({where:{vehicleId:input.vehicleId}}),readPartnerRegistrationCandidates(tx,[input.vehicleId])]);
  const recommendations=new Map<string,{id:string;name:string}>((candidates.get(input.vehicleId)||[]).map(row=>[row.id,row]));
  for(const ownerId of new Set<string>([simple?.ownerId,legacy?.ownerId].filter((id):id is string=>typeof id==='string'))){const owner=await tx.vehicleOwner.findUnique({where:{id:ownerId}});if(owner&&owner.status!=='SUSPENDED')recommendations.set(owner.id,{id:owner.id,name:owner.name});}
  return{vehicle:assetVehicleView(vehicle),vehicleRevision:vehicle.revision,assetRevision:profile?.revision??0,registeredOwnerName:profile?.registeredOwnerName??null,defaultLesseeName:profile?.registeredOwnerName??null,actualContractNumber:registration?.actualContractNumber??null,currentPayer:registration?.payer??null,payerRecommendations:[...recommendations.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id)),readiness:registration?.readiness??null};
 }
 async filterOptions(tx:any,actor:StaffActor,raw:unknown){
  await requireCurrentStaff(tx,actor,'baas-contracts',false);const input=baasOptionsInput.parse(raw),rows=await tx.vehicleBaasContract.findMany({where:input.vehicleId?{vehicleId:input.vehicleId}:{},select:{provider:true,lesseeName:true,vehicle:{select:{brand:true,model:true}}}});
  const distinct=(values:any[])=>[...new Set<string>(values.filter(value=>typeof value==='string'&&value.trim().length>0))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const models=new Map<string,{brand:string;model:string}>();
  for(const row of rows){const v=row.vehicle;if(!v||!v.brand?.trim()||!v.model?.trim())continue;if(input.brandExact!==undefined?v.brand!==input.brandExact:input.brand!==undefined&&!v.brand.toLocaleLowerCase().includes(input.brand.toLocaleLowerCase()))continue;models.set(JSON.stringify([v.brand,v.model]),{brand:v.brand,model:v.model});}
  return{providers:distinct(rows.map((r:any)=>r.provider)),brands:distinct(rows.map((r:any)=>r.vehicle?.brand)),models:[...models.values()].sort((a,b)=>a.brand.localeCompare(b.brand,'zh-CN')||a.model.localeCompare(b.model,'zh-CN')),lessees:distinct(rows.map((r:any)=>r.lesseeName))};
 }
 async detail(tx:any,actor:StaffActor,id:string){
  const current=await requireCurrentStaff(tx,actor,'baas-contracts',false),row=await this.read(tx,id),vehicle=await tx.vehicle.findUnique({where:{id:row.vehicleId},select:assetVehicleSelect});
  const profile=current.role==='FINANCE'?null:await tx.vehicleAssetProfile.findUnique({where:{vehicleId:row.vehicleId},select:{registeredOwnerName:true}});
  const history=await tx.vehicleBaasContractRevision.findMany({where:{contractId:id},orderBy:{fromRevision:'desc'},select:{id:true,fromRevision:true,toRevision:true,termsHash:true,firstCostPeriod:true,createdBy:true,changeReason:true,createdAt:true}});
  const logs=await tx.auditLog.findMany({where:{resourceType:'baas-contracts',resourceId:id,action:'UPDATE_BAAS'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:20,select:{id:true,actorId:true,createdAt:true,data:true}});
  const recentChanges=logs.map((log:any)=>({id:log.id,createdBy:log.actorId,createdAt:log.createdAt,revision:log.data?.revision??null,changeReason:log.data?.changeReason??null,termsChanged:log.data?.previousTermsHash!==log.data?.termsHash,metadataFields:log.data?.metadataFields??[]}));
  const registration=await readBaasRegistration(tx,row,actor),today=shanghaiDate(this.clock());return{...baasView(row,vehicle,today),...baasValidity(row,today,registration.readiness.ready),registrationReadiness:registration.readiness,currentPayer:registration.payer,...(vehicle?{vehicle:{...assetVehicleView(vehicle),...(current.role==='FINANCE'?{}:{registeredOwnerName:profile?.registeredOwnerName??null})}}:{}),lessorCollectionAccountInfo:row.lessorCollectionAccountInfo??null,history,recentChanges,files:await listBaasFileRecords(tx,actor,id)};
 }
 async create(tx:any,actor:StaffActor,raw:unknown){
  const input=baasCreateInput.parse(raw);return assetCommand(tx,actor,'baas-contracts','NEW','CREATE_BAAS',input,[input.vehicleId],[],async()=>{
   const vehicle=await tx.vehicle.findUnique({where:{id:input.vehicleId},select:assetVehicleSelect}),asset=await tx.vehicleAssetProfile.findUnique({where:{vehicleId:input.vehicleId}});ensure(vehicle,404,'NOT_FOUND','车辆不存在');ensure(vehicle.revision===input.vehicleRevision&&(asset?.revision??0)===input.assetRevision,409,'REVISION_CONFLICT','车辆或资产资料已变化，请刷新');
   const previousContractId=commandPrevious(input.previousContractId);await this.previous(tx,input.vehicleId,previousContractId);await this.payer(tx,input.payerOwnerId);const terms=baasTerms({...input,billingCycle:input.billingCycle===undefined?'MONTHLY':input.billingCycle,contractNumber:input.contractNumber??'BAAS-'+randomUUID(),previousContractId}),newMetadata=metadata({...input,...(input.lesseeName===undefined?{lesseeName:asset?.registeredOwnerName??null}:{})},true),row=await tx.vehicleBaasContract.create({data:{vehicleId:input.vehicleId,...storedTerms(terms),...newMetadata,termsHash:canonicalHash(terms),createdBy:actor.id,updatedBy:actor.id}});await audit(tx,actor.id,'CREATE_BAAS','baas-contracts',row.id,{vehicleId:input.vehicleId,termsHash:row.termsHash,metadataFields:Object.keys(metadata(input)),metadataHash:canonicalHash(newMetadata)});return baasView(row,vehicle,shanghaiDate(this.clock()));
  });
 }
 async update(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=baasPatchInput.parse(raw);await requireCurrentStaff(tx,actor,'baas-contracts');const before=await this.read(tx,id);
  return assetCommand(tx,actor,'baas-contracts',id,'UPDATE_BAAS',input,[before.vehicleId],[{table:'VehicleBaasContract',id}],async()=>{
   const row=await this.read(tx,id);ensure(row.revision===input.revision,409,'REVISION_CONFLICT','合同已更新，请刷新');ensure(row.status==='DRAFT'||input.changeReason,400,'BAAS_CHANGE_REASON_REQUIRED','修改非草稿合同须填写修改说明');
   const {revision,idempotencyKey,changeReason,...changes}=input;if(Object.hasOwn(changes,'previousContractId'))changes.previousContractId=commandPrevious(changes.previousContractId);if(Object.hasOwn(changes,'payerOwnerId'))await this.payer(tx,changes.payerOwnerId);
   const previousTerms=baasTerms(row),terms=baasTerms({...previousTerms,...changes}),termsHash=canonicalHash(terms);ensure(canonicalHash(previousTerms)===row.termsHash,409,'COST_SOURCE_MISMATCH','原合同条款摘要不一致');if(row.activatedAt||['ACTIVE','SUSPENDED','TERMINATED'].includes(row.status))requireBaasCompleteTerms(terms);await this.previous(tx,row.vehicleId,terms.previousContractId,id);
   const metadataChanges=metadata(changes),previousMetadata=metadata(row,true),nextMetadata={...previousMetadata,...metadataChanges};
   if(termsHash!==row.termsHash){const latest=await tx.vehicleBaasContractRevision.findFirst({where:{contractId:id},orderBy:{toRevision:'desc'}}),fromRevision=latest?latest.toRevision+1:0;ensure(fromRevision<=row.revision,409,'COST_SOURCE_MISMATCH','合同条款历史区间不一致');await tx.vehicleBaasContractRevision.create({data:{contractId:id,vehicleId:row.vehicleId,fromRevision,toRevision:row.revision,termsHash:row.termsHash,termsSnapshot:previousTerms,firstCostPeriod:row.firstCostPeriod??null,createdBy:actor.id,changeReason:changeReason??'草稿资料修正'}});}
   const changed=await tx.vehicleBaasContract.updateMany({where:{id,revision,status:row.status},data:{...storedTerms(terms),...metadataChanges,termsHash,revision:{increment:1},updatedBy:actor.id}});ensure(changed.count===1,409,'REVISION_CONFLICT','合同已更新，请刷新');await audit(tx,actor.id,'UPDATE_BAAS','baas-contracts',id,{revision:revision+1,changeReason:changeReason??null,previousTermsHash:row.termsHash,termsHash,termsBefore:previousTerms,termsAfter:terms,metadataFields:Object.keys(metadataChanges),metadataBefore:previousMetadata,metadataAfter:nextMetadata,previousMetadataHash:canonicalHash(previousMetadata),metadataHash:canonicalHash(nextMetadata)});return this.detail(tx,actor,id);
  });
 }
 async transition(tx:any,actor:StaffActor,id:string,action:BaasTransition,raw:unknown){
  const input=baasTransitionInput.parse(raw);await requireCurrentStaff(tx,actor,'baas-contracts');const before=await this.read(tx,id);
  return assetCommand(tx,actor,'baas-contracts',id,'BAAS_'+action.toUpperCase(),input,[before.vehicleId],[{table:'VehicleBaasContract',id}],async()=>{
   const row=await this.read(tx,id);ensure(row.revision===input.revision,409,'REVISION_CONFLICT','合同已更新，请刷新');const allowed={activate:['DRAFT','ARCHIVED'],suspend:['ACTIVE'],resume:['SUSPENDED'],terminate:['ACTIVE','SUSPENDED'],archive:['DRAFT','TERMINATED']}[action];ensure(allowed?.includes(row.status)&&!(action==='activate'&&row.status==='ARCHIVED'&&row.activatedAt),409,'BAAS_STATE','当前合同状态不能执行此动作');
   if(action!=='activate'&&action!=='resume'&&(row.activatedAt||['ACTIVE','SUSPENDED','TERMINATED'].includes(row.status)))requireBaasCompleteTerms(baasTerms(row));
   const data:any={revision:{increment:1},updatedBy:actor.id};
   if(action==='activate'||action==='resume'){
    const registration=await readBaasRegistration(tx,row,actor);requireBaasRegistration(registration);const source=await loadCostSource(tx,{sourceKind:'BAAS',baasContractId:id}),today=shanghaiDate(this.clock()),asset=await tx.vehicleAssetProfile.findUnique({where:{vehicleId:row.vehicleId}});ensure(source.terms.effectiveFrom<=today&&(!source.terms.effectiveTo||source.terms.effectiveTo>=today),409,'BAAS_OUTSIDE_EFFECTIVE_DATES','合同须在上海当日有效期内才能启用或恢复');ensure(asset?.batteryOwnership==='BAAS',409,'BAAS_BATTERY_REQUIRED','须先登记车辆电池归属为 BAAS');
    ensure(!await tx.vehicleBaasContract.count({where:{vehicleId:row.vehicleId,status:'ACTIVE',id:{not:id}}}),409,'BAAS_ACTIVE_CONFLICT','该车辆已有有效 BAAS 合同');
    const files=await requireAssetFiles(tx,actor,{kind:'BAAS',resourceId:id,required:true});ensure(files.length>0&&source.termsHash===row.termsHash,409,'BAAS_EVIDENCE_REQUIRED','请核对真实合同及附件');data.status='ACTIVE';data.activatedAt=row.activatedAt??this.clock();data.registrationSnapshot={vehicleId:row.vehicleId,vin:registration.vehicle.vin,actualContractNumber:registration.actualContractNumber,lesseeName:row.lesseeName,registeredOwnerName:registration.profile.registeredOwnerName,provider:row.provider,effectiveFrom:source.terms.effectiveFrom,rentalAmount:row.rentalAmount,paymentDayOfMonth:row.paymentDayOfMonth,payerOwnerId:row.payerOwnerId,payerName:registration.payer!.name,files,verifiedBy:actor.id,verifiedAt:this.clock().toISOString()};
   }else if(action==='suspend'){data.status='SUSPENDED';data.suspendedAt=this.clock();}else if(action==='terminate'){data.status='TERMINATED';data.terminatedAt=this.clock();}else{data.status='ARCHIVED';data.archivedAt=this.clock();}
   const {registrationSnapshot,...storedData}=data;const changed=await tx.vehicleBaasContract.updateMany({where:{id,revision:input.revision,status:row.status},data:storedData});ensure(changed.count===1,409,'REVISION_CONFLICT','合同已更新，请刷新');await audit(tx,actor.id,'BAAS_'+action.toUpperCase(),'baas-contracts',id,{before:row.status,after:data.status,revision:input.revision+1,reason:input.reason,...(registrationSnapshot?{registrationSnapshot}:{})});return this.detail(tx,actor,id);
  });
 }
 async preview(tx:any,actor:StaffActor,id:string,raw:unknown){await requireCurrentStaff(tx,actor,'baas-contracts',false);const input=baasPreviewInput.parse(raw),source=await loadCostSource(tx,{sourceKind:'BAAS',baasContractId:id});return{contractId:id,...await previewCostPlans(tx,source,{sourceKind:'BAAS',...input})};}
 async generate(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=baasGenerateInput.parse(raw);await requireCurrentStaff(tx,actor,'baas-contracts');const before=await this.read(tx,id);
  return assetCommand(tx,actor,'baas-contracts',id,'GENERATE_BAAS_PLANS',input,[before.vehicleId],[{table:'VehicleBaasContract',id}],async()=>{
   const source=await loadCostSource(tx,{sourceKind:'BAAS',baasContractId:id});ensure(source.revision===input.revision,409,'REVISION_CONFLICT','合同已更新，请重新预览');await requireAssetFiles(tx,actor,{kind:'BAAS',resourceId:id,required:true});
   const generated=await generateCostPlans(tx,source,{sourceKind:'BAAS',fromPeriod:input.fromPeriod,toPeriod:input.toPeriod},input.previewHash,input.acknowledgedWarningIds,actor.id);
   if(generated.created.length||!source.record.firstCostPeriod){const changed=await tx.vehicleBaasContract.updateMany({where:{id,revision:input.revision,status:source.status},data:{firstCostPeriod:source.record.firstCostPeriod??input.fromPeriod,revision:{increment:1},updatedBy:actor.id}});ensure(changed.count===1,409,'REVISION_CONFLICT','合同已更新，请重新预览');}
   const current=await this.read(tx,id);await audit(tx,actor.id,'GENERATE_BAAS_PLANS','baas-contracts',id,{revision:current.revision,previewHash:input.previewHash,fromPeriod:input.fromPeriod,toPeriod:input.toPeriod,acknowledgedWarningIds:input.acknowledgedWarningIds,createdPlanIds:generated.created.map(row=>row.id),existingPlanIds:generated.existing.map(row=>row.id),totalCreatedAmount:generated.totalCreatedAmount});return{contractId:id,revision:current.revision,...generated};
  });
 }
}
