export type GoodsAppDisplay={visible:boolean;available:boolean;state:'VISIBLE_AVAILABLE'|'VISIBLE_UNAVAILABLE'|'NOT_VISIBLE';reasons:{code:string;message:string}[];checkedAt:string};
export function goodsAppDisplayView(value:unknown):{label:string;tone:'success'|'warning'|'neutral';reasons:string[];checkedAt?:string}{
 const unknown={label:'App 展示待核对',tone:'neutral' as const,reasons:['请刷新，核对 App 实际展示状态。']};
 if(!value||typeof value!=='object')return unknown;
 const state=value as Partial<GoodsAppDisplay>;
 if(typeof state.visible!=='boolean'||typeof state.available!=='boolean'||typeof state.checkedAt!=='string'||!Number.isFinite(Date.parse(state.checkedAt))||!Array.isArray(state.reasons)||state.reasons.length>30||state.reasons.some(r=>!r||typeof r.code!=='string'||typeof r.message!=='string'||r.message.length>1000))return unknown;
 const expected=state.visible?(state.available?'VISIBLE_AVAILABLE':'VISIBLE_UNAVAILABLE'):'NOT_VISIBLE';
 if(state.available&&!state.visible||state.state!==expected)return unknown;
 return{label:state.visible?(state.available?'App 可查看、可申请':'App 可查看，暂不可申请'):'App 未展示',tone:state.available?'success':state.visible?'warning':'neutral',reasons:state.reasons.map(r=>r.message),checkedAt:state.checkedAt};
}
