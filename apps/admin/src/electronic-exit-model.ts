export type ExitKind='cancellation04'|'termination';
export type ExitRead={orderId:string;orderRevision:number;sourceHash:string|null;canPropose:boolean;blockers:Array<{message?:string;code?:string}>;case:Record<string,any>|null;[key:string]:any};
export function businessInstant(value:unknown){const s=String(value||'');if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s)))return s;if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(s)){const at=s+(s.length===16?':00':'')+'+08:00';if(Number.isFinite(Date.parse(at)))return at;}throw Error('请填写完整的北京时间');}
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function exitRead(value:any,orderId:string):ExitRead{
 if(!value||value.orderId!==orderId||!Number.isSafeInteger(value.orderRevision)||value.orderRevision<0||!(value.sourceHash===null||sha(value.sourceHash))||typeof value.canPropose!=='boolean'||!Array.isArray(value.blockers))throw Error('本单协议来源尚未完整核对');
 const c=value.case;if(c&&(!(typeof c.id==='string'&&c.id)||!Number.isSafeInteger(c.revision)||c.revision<1||!sha(c.proposalHash)||typeof c.state!=='string'))throw Error('协议方案版本不完整');
 if(c?.netRefundAmount!==undefined&&(!Number.isSafeInteger(c.netRefundAmount)||c.netRefundAmount<0))throw Error('退款金额尚未核实');
 return value;
}
export function exitCanPropose(v:ExitRead){return v.canPropose&&!!v.sourceHash&&!v.blockers.length&&(!v.case||v.case.state==='REJECTED');}
export function exitProposal(kind:ExitKind,v:ExitRead,raw:Record<string,unknown>):Record<string,unknown>{
 if(!exitCanPropose(v))throw Error('请核对本单现有协议及办理条件');
 const base={revision:v.orderRevision,sourceHash:v.sourceHash,reason:raw.reason};
 if(kind==='cancellation04')return{...base,responsibility:raw.responsibility,neverDeliveredEvidenceFileIds:raw.neverDeliveredEvidenceFileIds,costs:raw.costs||[]};
 const at=businessInstant(raw.plannedReturnAt);
 return{...base,reasonKind:raw.reasonKind,plannedReturnAt:at,returnPlace:raw.returnPlace,evidenceFileIds:raw.evidenceFileIds};
}
export function exitReview(v:ExitRead,raw:Record<string,unknown>){if(v.case?.state!=='PROPOSED')throw Error('此版本不在待复核状态');return{revision:v.case.revision,decision:raw.decision,note:raw.note};}
export const exitState=(v:string)=>({PROPOSED:'待运营复核',VERIFIED:'待客户确认方案',CONFIRMED:'待电子签署',EFFECTIVE:'协议已生效，待归档及后续办理',ARCHIVED:'已归档',REJECTED:'已退回',DEPENDENCIES_RELEASED:'已释放后续安排',AMOUNT_CONFIRMED:'结算金额已确认'} as Record<string,string>)[v]||'处理中';
