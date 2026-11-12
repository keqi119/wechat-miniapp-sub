export type Candidate={kind:string;resourceId:string;revision?:number;sourceRevision?:number;businessHash?:string};
export function preparePayload(row:Candidate,idempotencyKey:string){
 if(!row.kind||!row.resourceId||!Number.isSafeInteger(row.revision))throw new Error('当前业务版本未读取，请刷新');
 return {kind:row.kind,resourceId:row.resourceId,revision:row.revision,idempotencyKey};
}
export function taskCommands(row:{revision?:number;status?:string;stopStatus?:string|null;evidenceReviewStatus?:string|null;nextAction?:{kind:string;mode?:string}},operator:boolean):string[]{
 if(!operator||!Number.isSafeInteger(row.revision))return [];
 if(row.stopStatus||row.evidenceReviewStatus==='ORIGINAL_CERTIFICATE_REQUIRED')return ['sync'];
 if(['ARCHIVED','RETIRED','WITHDRAWN','DECLINED','EXPIRED'].includes(row.status||''))return [];
 return [...(row.nextAction?.kind==='UPLOAD'?['start']:[]),'sync','withdraw'];
}
export function taskSelectionHref(hash:string,id:string){const [route,query='']=hash.split('?');const q=new URLSearchParams(query);q.set('view','contracts');q.set('task',id);return route+'?'+q.toString();}
export const documentNames:Record<string,string>={SUBSCRIPTION:'01 主订阅合同',COOPERATION:'02 合作协议',COOPERATION_GRANT:'02 独立用印授权',VEHICLE_SWAP:'03 换车补充协议',PRE_DELIVERY_CANCELLATION:'04 交付前取消协议',RENEWAL:'05 续期协议',EARLY_TERMINATION:'06 协商终止协议'};
export function currentPreparationMatches(task:{kind:string;frozenSources?:{context?:{resourceId?:string;revision?:number}|null}},rows:(Candidate&{canPrepare:boolean})[]):boolean{
 const context=task.frozenSources?.context;
 return !!context&&Number.isSafeInteger(context.revision)&&rows.some(row=>row.kind===task.kind&&row.resourceId===context.resourceId&&row.sourceRevision===context.revision&&row.canPrepare);
}
