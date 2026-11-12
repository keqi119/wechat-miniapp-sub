import {canonicalHash} from '../customers/types';
import {ensure} from '../common/errors';
import {validateListingSource} from '../products/snapshot';
import {catalogAppDisplay} from '../catalog/app-display';
import {catalogVehicleInclude,catalogVehicleViews,presentCatalogVehicle,presentCatalogPlan,catalogVehicleReport} from '../catalog/catalog';
import {publicBasicCondition} from '../vehicles/basic-condition-snapshot';
import {publicInspectionViews} from '../vehicle-inspections/service';

/** Authorized admin preview. Draft rendering never relaxes the public catalog gates. */
export async function goodsAppPreview(tx:any,row:any,at=new Date()){
 const vehicle=await tx.vehicle.findUnique({where:{id:row.vehicleId},include:catalogVehicleInclude});
 ensure(vehicle?.id===row.vehicleId,404,'NOT_FOUND','车辆不存在');
 const product=validateListingSource(row,row.productVersion,vehicle,row.subscriptionPlan);
 const plan={...row.subscriptionPlan,listing:row,productVersion:row.productVersion};
 const appDisplay=await catalogAppDisplay(tx,plan,vehicle,at);
 let projection:any,selectedPlan:any;
 if(appDisplay.visible){
  projection=await catalogVehicleViews(tx,vehicle,at);selectedPlan=projection.plans.find((p:any)=>p.listingId===row.id);
  ensure(selectedPlan,409,'GOODS_SOURCE_MISMATCH','当前商品未出现在公开投影中，请刷新后核对');
 }else{
  const source={...product,listingId:row.id,listingRevision:row.revision,sourceHash:canonicalHash({listingId:row.id,listingRevision:row.revision,vehicleId:row.vehicleId,subscriptionPlanId:plan.id,product})};
  selectedPlan={...presentCatalogPlan(plan,source,false),inspections:await publicInspectionViews(tx,row,vehicle.id)};
  projection={vehicle:presentCatalogVehicle(vehicle,false,[product.monthlyFeeAmount],publicBasicCondition(row.basicConditionSnapshot,vehicle.id)),plans:[selectedPlan]};
 }
 return{listingId:row.id,listingRevision:row.revision,vehicleId:vehicle.id,vehicleRevision:vehicle.revision,mode:appDisplay.visible?'LIVE':'DRAFT_PREVIEW',appDisplay,...projection,selectedPlan,report:catalogVehicleReport(vehicle,projection.vehicle),materials:{title:vehicle.title,description:vehicle.description,conditionDisclosure:vehicle.conditionDisclosure}};
}
