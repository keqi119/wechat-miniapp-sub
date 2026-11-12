export type PlatformAuthority={id:string;scope:{version:number};status:string;scopeHash:string;revision:number;enabled:boolean;pausedAt:string|null;signedAt:string|null;scopeReviewStatus:string;document?:{signedAvailable:boolean};lastErrorCode?:string|null};
export function platformAuthorityState(a:PlatformAuthority){
 if(a.status==='REVOKED')return{label:'已取消授权',canResume:false,canContinue:false,canRevoke:false};
 if(['SUPERSEDED','INVALIDATED'].includes(a.status))return{label:'授权已失效',canResume:false,canContinue:false,canRevoke:false};
 if(a.status==='REVOKING')return{label:'取消授权处理中',canResume:false,canContinue:false,canRevoke:true};
 if(a.pausedAt)return{label:'自动签已暂停',canResume:a.status==='AUTHORIZED'&&a.scopeReviewStatus==='VERIFIED',canContinue:false,canRevoke:true};
 if(a.status==='AUTHORIZED')return{label:a.enabled?'已授权':a.scopeReviewStatus==='PENDING'?'授权范围待核验':'授权待核验',canResume:false,canContinue:false,canRevoke:true};
 return{label:a.status==='UNKNOWN'?'授权状态待核对':'待完成授权',canResume:false,canContinue:!a.document?.signedAvailable&&a.status==='PENDING',canRevoke:true};
}
export function canRequestPlatformAuthority(records:PlatformAuthority[]){return!records.some(r=>r.scope?.version===3&&!['REVOKED','SUPERSEDED','INVALIDATED'].includes(r.status));}
