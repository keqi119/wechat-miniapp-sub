import {api,ApiError,type Session} from './core.ts';

type Command={phase:string;readonly hasPending:boolean;dispose:()=>void};
export type PendingIntent<C extends Command,V>={key:string;command:C;snapshot?:V;busy:boolean;completed:boolean;resultId?:string;error?:unknown;session:Session;signature:string;listeners:Set<()=>void>};
const intents=new Map<string,PendingIntent<Command,unknown>>();
let owner:Session|null=null,signature='',routeEpoch=0;
const grants=(session:Session|null)=>session?JSON.stringify([session.user.id,session.user.role,[...session.user.permissions].sort(),[...session.user.partnerCapabilities||[]].sort()]):'';
function clear(){const entries=[...intents.values()];intents.clear();for(const entry of entries){entry.command.dispose();entry.snapshot=undefined;entry.error=undefined;entry.resultId=undefined;entry.completed=false;entry.busy=false;for(const listener of entry.listeners)listener();}}
export function synchronizePendingSession(){const current=api.session,currentGrants=grants(current);if(owner!==current||signature!==currentGrants){owner=current;signature=currentGrants;clear();}}
if(typeof window!=='undefined'){
 window.addEventListener('admin-session-change',()=>{owner=api.session;signature=grants(owner);clear();});
 // Observation only: navigation is never intercepted or cancelled.
 for(const event of ['hashchange','process-location'])window.addEventListener(event,()=>{routeEpoch++;synchronizePendingSession();});
}
export function sessionPendingIntent<C extends Command,V>(key:string,create:()=>C):PendingIntent<C,V>{synchronizePendingSession();if(!owner)throw new ApiError('请先登录后台',401,'UNAUTHENTICATED');const existing=intents.get(key);if(existing)return existing as PendingIntent<C,V>;const entry:PendingIntent<C,V>={key,command:create(),busy:false,completed:false,session:owner,signature,listeners:new Set()};intents.set(key,entry as PendingIntent<Command,unknown>);return entry;}
export function pendingIntentCurrent(entry:PendingIntent<Command,unknown>){synchronizePendingSession();return owner===entry.session&&signature===entry.signature&&intents.get(entry.key)===entry;}
export function subscribePendingIntent(entry:PendingIntent<Command,unknown>,listener:()=>void){entry.listeners.add(listener);return()=>{entry.listeners.delete(listener);};}
function notify(entry:PendingIntent<Command,unknown>){for(const listener of entry.listeners)listener();}
export function releasePendingIntent(entry:PendingIntent<Command,unknown>){queueMicrotask(()=>{synchronizePendingSession();if(intents.get(entry.key)===entry&&!entry.listeners.size&&!entry.busy&&!entry.command.hasPending){intents.delete(entry.key);entry.command.dispose();entry.snapshot=undefined;entry.error=undefined;entry.resultId=undefined;}});}
export function resetPendingIntent<C extends Command,V>(entry:PendingIntent<C,V>,create:()=>C){if(!pendingIntentCurrent(entry)||entry.busy||entry.command.hasPending)return;entry.command.dispose();entry.command=create();entry.snapshot=undefined;entry.error=undefined;entry.completed=false;entry.resultId=undefined;notify(entry);}
export function intentUiLease(entry:PendingIntent<Command,unknown>,mounted:()=>boolean){const epoch=routeEpoch,hash=typeof window==='undefined'?'':window.location.hash;return()=>pendingIntentCurrent(entry)&&mounted()&&epoch===routeEpoch&&(typeof window==='undefined'||window.location.hash===hash);}
export async function runPendingIntent<C extends Command,V>(entry:PendingIntent<C,V>,snapshot:V,operation:()=>Promise<void>){
 if(!pendingIntentCurrent(entry))throw new ApiError('登录或权限已变化，请重新进入当前业务',0,'SESSION_CHANGED');
 if(entry.busy||entry.completed)return;
 if(!entry.command.hasPending)entry.snapshot=snapshot;
 entry.busy=true;entry.error=undefined;notify(entry);
 try{await operation();if(pendingIntentCurrent(entry))entry.completed=true;}
 catch(error){if(pendingIntentCurrent(entry)){entry.error=error;if(error instanceof ApiError&&[401,403].includes(error.status)){clear();}}throw error;}
 finally{if(pendingIntentCurrent(entry)){entry.busy=false;notify(entry);}}
}
