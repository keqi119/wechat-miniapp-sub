import {useEffect,useState} from 'react';
import {api} from './core';
import {useBaasLease} from './baas-session';
import {readBaasPayerOptions,type BaasPayerOption} from './baas-business-model';
import type {AssetVehicle,BaasRegistrationReadiness} from './asset-model';
export type BaasRegistrationContext={vehicle:AssetVehicle;registeredOwnerName:string|null;defaultLesseeName:string|null;currentPayer:BaasPayerOption|null;payerRecommendations:BaasPayerOption[];readiness?:BaasRegistrationReadiness|null};

export function useBaasRegistrationContext(vehicleId:string,contractId?:string){
 const [context,setContext]=useState<BaasRegistrationContext>(),[owners,setOwners]=useState<BaasPayerOption[]>([]),[contextFailed,setContextFailed]=useState(false),[ownersFailed,setOwnersFailed]=useState(false),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0),lease=useBaasLease();
 useEffect(()=>{
  setContext(undefined);setOwners([]);setContextFailed(false);setOwnersFailed(false);if(!vehicleId)return;
  const controller=new AbortController(),current=()=>!controller.signal.aborted&&lease.current(),params=new URLSearchParams({vehicleId});if(contractId)params.set('contractId',contractId);setLoading(true);
  const readContext=api.request<BaasRegistrationContext>('/admin/baas-contracts/registration-context?'+params,{permission:'baas-contracts.read',signal:controller.signal}).then(value=>{if(!current())return;if(value.vehicle?.id!==vehicleId||!Array.isArray(value.payerRecommendations)||value.registeredOwnerName!==null&&typeof value.registeredOwnerName!=='string')throw Error('登记参照与当前车辆不一致');setContext(value);}).catch(()=>{if(current())setContextFailed(true);});
  const readOwners=readBaasPayerOptions(path=>api.request(path,{permission:'baas-contracts.read',signal:controller.signal})).then(value=>{if(current())setOwners(value);}).catch(()=>{if(current())setOwnersFailed(true);});
  void Promise.all([readContext,readOwners]).finally(()=>{if(current())setLoading(false);});return()=>controller.abort();
 },[vehicleId,contractId,attempt]);
 return {context:context?.vehicle.id===vehicleId?context:undefined,owners,contextFailed,ownersFailed,loading,retry:()=>setAttempt(value=>value+1)};
}
