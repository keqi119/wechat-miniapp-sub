import {ensure} from '../common/errors';
import {AsyncLocalStorage} from 'node:async_hooks';

/** Only a new plan reads configuration. Existing records always use their frozen mode. */
export function newOrderContractMode(env:NodeJS.ProcessEnv=process.env):'OFFLINE'|'ESIGN'|'ELECTRONIC'{
 if(env.NEW_ORDER_CONTRACT_MODE==='ELECTRONIC')return 'ELECTRONIC';
 return env.NEW_ORDER_CONTRACT_MODE==='ESIGN'?'ESIGN':'OFFLINE';
}

export function assertPaperSigningAllowed(){
 ensure(newOrderContractMode()!=='ELECTRONIC',409,'PAPER_SIGNING_DISABLED','已切换电子合同，请在合同与协议中办理；原纸质档案仅供查阅');
}
export interface NewEsignContext {
 contractMode?:string|null;
 executionMode?:string|null;
 env?:NodeJS.ProcessEnv;
}
/** A legacy feature flag cannot enable a new external signing operation. */
export function assertNewEsignAllowed(context:NewEsignContext={}):void{
 const env=context.env??process.env;
 ensure(context.contractMode!=='ELECTRONIC'&&context.executionMode!=='ELECTRONIC',409,'ELECTRONIC_WORKSPACE_REQUIRED','请从当前三方电子合同入口办理');
 ensure(env.ESIGN_NEW_REQUESTS_ENABLED==='true'&&newOrderContractMode(env)!=='OFFLINE'&&context.contractMode!=='OFFLINE'&&context.executionMode!=='OFFLINE',403,'ESIGN_INITIATION_DISABLED','本版采用线下签署，新电子签及用印办理已关闭');
}

// A server closure rechecks the exact persisted task/account at every dispatch.
// This is never a client flag and never authorizes a legacy controller entry.
const boundElectronicOperation=new AsyncLocalStorage<()=>Promise<void>>();
export function runBoundElectronicOperation<T>(revalidate:()=>Promise<void>,operation:()=>Promise<T>){return boundElectronicOperation.run(revalidate,operation);}
export async function assertNewProviderOperation(){
 const current=boundElectronicOperation.getStore();
 if(!current){assertNewEsignAllowed();return;}
 ensure(process.env.ESIGN_NEW_REQUESTS_ENABLED==='true',403,'ESIGN_INITIATION_DISABLED','新电子签办理已关闭');
 await current();
}

/** Enterprise identity/seal onboarding is not legacy per-document issuance. */
export function assertEnterpriseOnboardingAllowed(context:NewEsignContext={}):void{
 const env=context.env??process.env;
 ensure(env.ESIGN_NEW_REQUESTS_ENABLED==='true'&&newOrderContractMode(env)!=='OFFLINE',403,'ESIGN_INITIATION_DISABLED','企业实名及新授权办理尚未开放');
}
