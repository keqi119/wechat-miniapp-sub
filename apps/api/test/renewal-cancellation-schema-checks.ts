import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

/** Schema integrity only: synthetic sources do not represent approved cancellations. */
export async function verifyRenewalCancellationSchema(db:any){
 const columns=await db.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='OrderRenewalCancellation'`;
 assert.ok(columns.some((v:any)=>v.column_name==='sourceHash'),'missing OrderRenewalCancellation structure');
 const stamp=new Date('2026-10-01'),staff=await db.adminUser.create({data:{username:'cancel-schema-'+randomUUID(),name:'合成运营',role:'OPERATIONS',passwordHash:'synthetic-not-login'}});
 const customer=await db.customer.create({data:{mobile:'cancel-schema-'+randomUUID()}}),foreignCustomer=await db.customer.create({data:{mobile:'cancel-foreign-'+randomUUID()}});
 const vehicle=await db.vehicle.create({data:{brand:'合成',model:'结构测试',title:'取消结构车辆',year:2026,city:'测试',mileageKm:0}});
 const owner=await db.vehicleOwner.create({data:{name:'取消结构出租方',address:'合成地址',createdBy:staff.id}}),otherOwner=await db.vehicleOwner.create({data:{name:'其他结构出租方',address:'合成地址',createdBy:staff.id}});
 const product=await db.product.create({data:{name:'结构测试',createdBy:staff.id}}),version=await db.productVersion.create({data:{productId:product.id,version:1,name:'合成十二期',months:12,monthlyFeeAmount:20000,mileagePerMonthKm:2000,excessMileagePriceAmount:100,energyDescription:'自付',conditions:'结构测试',vehicleIds:[vehicle.id],modelDefinitionIds:[],createdBy:staff.id}});
 const plan=await db.subscriptionPlan.create({data:{vehicleId:vehicle.id,productVersionId:version.id,name:'合成十二期',months:12,monthlyFeeAmount:20000,mileagePerMonthKm:2000,excessMileagePriceAmount:100,energyDescription:'自付',benefits:[],conditions:'结构测试'}}),listing=await db.vehicleListing.create({data:{vehicleId:vehicle.id,productVersionId:version.id,subscriptionPlanId:plan.id,productSourceHash:'a'.repeat(64),snapshot:{synthetic:true},createdBy:staff.id}});
 const orderFor=async(customerId=customer.id)=>{const a=await db.application.create({data:{customerId,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:[],idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}});return db.order.create({data:{applicationId:a.id,customerId,vehicleId:vehicle.id,finalPlanSnapshot:{original:'unchanged'},confirmedMileageKm:0}});};
 const order=await orderFor(),other=await orderFor(),foreign=await orderFor(foreignCustomer.id);
 const changeFor=(o:any)=>db.orderChange.create({data:{orderId:o.id,customerId:o.customerId,kind:'SUBSCRIPTION_EXTENSION',status:'CANCELLED',originalContractId:'synthetic',priorTermsHash:'a'.repeat(64),priorTerms:{},reason:'仅结构测试',createdBy:staff.id,idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}});
 const change=await changeFor(order),otherChange=await changeFor(other),extraChange=await changeFor(order);
 const quoteFor=(c:any)=>db.delayQuote.create({data:{changeId:c.id,revision:1,status:'CONFIRMED',confirmedAt:stamp,commercialHash:'b'.repeat(64),snapshot:{synthetic:true},fundsSnapshot:[],createdBy:staff.id}});
 const quote=await quoteFor(change),otherQuote=await quoteFor(otherChange),extraQuote=await quoteFor(extraChange);
 const archiveFor=async(data:any)=>{const a=await db.documentArchive.create({data:{createdBy:staff.id,...data}});const v=await db.archiveVersion.create({data:{archiveId:a.id,version:1,status:'ARCHIVED',templateId:'synthetic-template',templateVersion:1,businessSnapshotHash:'b'.repeat(64),partiesSnapshot:[],requiredSigners:[],scopeSnapshot:{}}});return{a,v};};
 const original=await archiveFor({kind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:quote.id,quoteId:quote.id,orderId:order.id,ownerId:owner.id});
 const assignment=await db.vehicleAssignment.create({data:{orderId:order.id,customerId:customer.id,vehicleId:vehicle.id,startAt:stamp,startReadingKm:0}});
 const initial=await db.orderServiceStage.create({data:{orderId:order.id,customerId:customer.id,sequence:1,kind:'INITIAL',status:'ACTIVE',vehicleId:vehicle.id,assignmentId:assignment.id,startDate:stamp,endDate:new Date('2027-10-01'),months:12,firstPeriodSequence:1,lastPeriodSequence:12,snapshot:{synthetic:true},snapshotHash:'a'.repeat(64),activatedAt:stamp}});
 const stage=await db.orderServiceStage.create({data:{orderId:order.id,customerId:customer.id,sequence:2,kind:'RENEWAL',status:'PREPARED',previousStageId:initial.id,changeId:change.id,quoteId:quote.id,approvedArchiveVersionId:original.v.id,ownerId:owner.id,vehicleId:vehicle.id,assignmentId:assignment.id,listingId:listing.id,productVersionId:version.id,subscriptionPlanId:plan.id,startDate:new Date('2027-10-01'),endDate:new Date('2028-10-01'),months:12,firstPeriodSequence:13,lastPeriodSequence:24,snapshot:{synthetic:true},snapshotHash:'b'.repeat(64),createdBy:staff.id}});
 const base={orderId:order.id,customerId:customer.id,ownerId:owner.id,changeId:change.id,quoteId:quote.id,serviceStageId:stage.id,sourceSnapshot:{synthetic:true},sourceHash:'c'.repeat(64),reason:'双方明确撤销未来续期',createdBy:staff.id};
 const check=(e:any)=>e.code==='P2004'||e.meta?.code==='23514'||/23514/.test(String(e.message)),fk=(e:any)=>e.code==='P2003';
 for(const patch of [{revision:-1},{sourceSnapshot:[]},{sourceHash:'invalid'},{reason:' '},{status:'UNKNOWN'},{signatureState:'INVALID'},{signatureState:'UNSIGNED'},{status:'COMPLETED'},{completedAt:stamp},{approvedArchiveVersionId:original.v.id}])await assert.rejects(db.orderRenewalCancellation.create({data:{...base,...patch}}),check);
 for(const patch of [{orderId:other.id},{customerId:foreignCustomer.id},{changeId:otherChange.id},{quoteId:otherQuote.id},{ownerId:otherOwner.id},{serviceStageId:initial.id}])await assert.rejects(db.orderRenewalCancellation.create({data:{...base,...patch}}),fk);
 const cancellation=await db.orderRenewalCancellation.create({data:base});
 await assert.rejects(db.orderRenewalCancellation.create({data:base}),(e:any)=>e.code==='P2002');
 // Confirmation can be cancelled before finance creates a stage; no fake stage is required.
 const noStage=await db.orderRenewalCancellation.create({data:{...base,changeId:extraChange.id,quoteId:extraQuote.id,serviceStageId:null}});assert.equal(noStage.serviceStageId,null);
 const cancellationArchive={kind:'RENEWAL_CANCELLATION',subjectType:'ORDER_RENEWAL_CANCELLATION',subjectId:cancellation.id,renewalCancellationId:cancellation.id,orderId:order.id,ownerId:owner.id};
 for(const patch of [{renewalCancellationId:null},{kind:'TERMINATION'},{subjectType:'ORDER'},{subjectId:randomUUID()},{orderId:null},{ownerId:null},{quoteId:quote.id},{handoverId:'wrong'}])await assert.rejects(db.documentArchive.create({data:{...cancellationArchive,...patch,createdBy:staff.id}}),check);
 for(const patch of [{orderId:other.id},{ownerId:otherOwner.id}])await assert.rejects(db.documentArchive.create({data:{...cancellationArchive,...patch,createdBy:staff.id}}),fk);
 const paper=await archiveFor(cancellationArchive);
 const signed={signatureState:'SIGNED',signatureVerifiedBy:staff.id,signatureVerifiedAt:stamp,signatureEvidenceFileIds:['synthetic-private-evidence'],signatureNote:'核实已签原续期'};
 await db.orderRenewalCancellation.update({where:{id:cancellation.id},data:signed});
 await assert.rejects(db.orderRenewalCancellation.update({where:{id:cancellation.id},data:{terminationArchiveId:paper.a.id,approvedArchiveVersionId:original.v.id,terminationArchiveHash:'e'.repeat(64)}}),fk);
 await assert.rejects(db.orderRenewalCancellation.update({where:{id:cancellation.id},data:{terminationArchiveId:original.a.id,approvedArchiveVersionId:original.v.id,terminationArchiveHash:'e'.repeat(64)}}),fk);
 await db.orderRenewalCancellation.update({where:{id:cancellation.id},data:{terminationArchiveId:paper.a.id,approvedArchiveVersionId:paper.v.id,terminationArchiveHash:'e'.repeat(64)}});
 const billFor=(o:any,stageId:string|null=null)=>db.bill.create({data:{orderId:o.id,customerId:o.customerId,serviceStageId:stageId,type:'SUBSCRIPTION',sequence:13,amount:20000,status:'PAID',paidAmount:20000,dueDate:new Date('2027-10-01')}});
 const bill=await billFor(order,stage.id),otherBill=await billFor(other),foreignBill=await billFor(foreign);
 const paymentFor=(b:any)=>db.payment.create({data:{billId:b.id,customerId:b.customerId,amount:b.amount,status:'SUCCEEDED',providerTransactionId:'synthetic-'+randomUUID(),idempotencyKey:randomUUID()}});
 const payment=await paymentFor(bill),otherPayment=await paymentFor(otherBill),foreignPayment=await paymentFor(foreignBill);
 const oldRefund=await db.refund.create({data:{paymentId:otherPayment.id,customerId:customer.id,amount:100,reason:'旧退款保持原结构',requestedBy:staff.id}});
 const refund={paymentId:payment.id,customerId:customer.id,amount:20000,reason:'结构退款关联',requestedBy:staff.id,renewalCancellationId:cancellation.id,renewalCancellationOrderId:order.id,renewalCancellationStageId:stage.id,renewalCancellationBillId:bill.id};
 const refundFields=['renewalCancellationId','renewalCancellationOrderId','renewalCancellationStageId','renewalCancellationBillId'];
 for(let mask=1;mask<15;mask++){const partial={...refund};refundFields.forEach((field,index)=>{if(mask&(1<<index))(partial as any)[field]=null;});await assert.rejects(db.refund.create({data:partial}),check);}
 for(const field of refundFields)await assert.rejects(db.refund.create({data:{...refund,[field]:'  '}}),check);
 for(const patch of [{paymentId:otherPayment.id},{paymentId:foreignPayment.id},{renewalCancellationOrderId:other.id},{renewalCancellationStageId:initial.id},{renewalCancellationBillId:otherBill.id},{renewalCancellationId:noStage.id},{customerId:foreignCustomer.id}])await assert.rejects(db.refund.create({data:{...refund,...patch}}),fk);
 await db.refund.create({data:refund});
 await assert.rejects(db.orderRenewalCancellation.delete({where:{id:cancellation.id}}),fk);
 const completion={status:'COMPLETED',completedAt:stamp,completedBy:staff.id,completionSnapshot:{synthetic:'verified-only-for-schema'},completionHash:'d'.repeat(64)};
 for(const field of ['completedAt','completedBy','completionSnapshot','completionHash'])await assert.rejects(db.orderRenewalCancellation.update({where:{id:cancellation.id},data:{...completion,[field]:null}}),check);
 for(const data of [{terminationArchiveHash:null},{terminationArchiveHash:'bad'},{approvedArchiveVersionId:null},{signatureState:'UNKNOWN'},{signatureNote:' '},{signatureEvidenceFileIds:[]},{signatureEvidenceFileIds:[' ']}])await assert.rejects(db.orderRenewalCancellation.update({where:{id:cancellation.id},data}),check);
 await db.orderRenewalCancellation.update({where:{id:cancellation.id},data:completion});
 await assert.rejects(db.orderRenewalCancellation.update({where:{id:noStage.id},data:completion}),check);
 await db.orderRenewalCancellation.update({where:{id:noStage.id},data:{...signed,signatureState:'UNSIGNED',signatureNote:'明确核实未签且无签字上传历史',...completion}});
 assert.deepEqual((await db.order.findUniqueOrThrow({where:{id:order.id}})).finalPlanSnapshot,{original:'unchanged'});
 assert.equal((await db.delayQuote.findUniqueOrThrow({where:{id:quote.id}})).status,'CONFIRMED');
 assert.equal((await db.orderServiceStage.findUniqueOrThrow({where:{id:stage.id}})).status,'PREPARED','structure test never performs business cancellation');
 assert.equal((await db.refund.findUniqueOrThrow({where:{id:oldRefund.id}})).renewalCancellationId,null);
 assert.equal((await db.documentArchive.findUniqueOrThrow({where:{id:original.a.id}})).quoteId,quote.id);
 return{cancellation,noStage,staff,stamp};
}
