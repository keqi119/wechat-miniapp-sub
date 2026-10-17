import {ensure} from '../common/errors';
import {hash} from '../common/data';
export function followupTemplateType(order:any,kind:string){
 const owner=order.finalPlanSnapshot?.lessorSnapshot;
 return kind==='VEHICLE_CHANGE'?(owner?'owner-vehicle-change':'vehicle-change-amendment'):(owner?'owner-delivery-delay':'delivery-delay-amendment');
}
export async function verifySwapOwner(tx:any,order:any,vehicleId:string,expected?:any){
 const lessor=order.finalPlanSnapshot?.lessorSnapshot;if(!lessor)return null;
 const binding=await tx.ownerVehicle.findUnique({where:{vehicleId}}),evidence=binding?.evidenceFileId?await tx.storedFile.findUnique({where:{id:binding.evidenceFileId}}):null;
 ensure(binding?.ownerId===lessor.ownerId&&binding.status==='APPROVED'&&binding.reviewedAt&&binding.reviewedBy&&evidence?.purpose==='evidence',409,'OWNER_SWAP_BINDING','换车补充协议仅限同一实际出租方已审核的车辆；更换出租方须另行安排新合同和客户同意');
 const pin={ownerId:binding.ownerId,vehicleId,bindingId:binding.id,revision:binding.revision,evidenceHash:evidence.sha256};
 if(expected)ensure(hash(pin)===hash(expected),409,'OWNER_SWAP_BINDING','目标车辆归属或审核材料已变化，请重新报价确认');return pin;
}
