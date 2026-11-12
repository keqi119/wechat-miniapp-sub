import {ensure} from '../common/errors';
import {requireCurrentVirtualScope} from './scope';

/** Persisted account binding only; no request-controlled policy or ambient global override. */
export async function virtualActorScope(tx:any,customerId:string,options:{ownerId?:string;current?:boolean}={}){
 const ownerId=options.ownerId;
 const scope=await tx.virtualAcceptanceScope.findFirst({where:ownerId?{OR:[{ownerId,ownerActorCustomerId:customerId},{platformId:ownerId,platformActorCustomerId:customerId}]}:{OR:[{customerId},{ownerActorCustomerId:customerId},{platformActorCustomerId:customerId}]},include:{vehicle:true}});
 if(!scope)return null;
 ensure(scope.vehicle,409,'VIRTUAL_SCOPE_REQUIRED','指定验收车辆缺失');
 if(options.current!==false)await requireCurrentVirtualScope(tx,{vehicleId:scope.vehicle.id,action:'ACTOR'});
 return scope;
}
export async function requireVirtualEnterpriseOrDefault(tx:any,customerId:string,ownerId:string){
 const policy=await import('../offline-documents/mode');
 if(policy.newOrderContractMode()==='ELECTRONIC'){policy.assertEnterpriseOnboardingAllowed();return null;}
 const scope=await virtualActorScope(tx,customerId,{ownerId});
 if(scope)ensure(process.env.ESIGN_NEW_REQUESTS_ENABLED==='true',403,'ESIGN_INITIATION_DISABLED','新电子签及企业实名尚未开放');
 else (await import('../offline-documents/mode')).assertEnterpriseOnboardingAllowed();
 return scope;
}
