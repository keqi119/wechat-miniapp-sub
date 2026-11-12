import type {BusinessField,BusinessValues} from './domain-commands';
export type TerminationContext={originalContract:{archiveId:string;versionId:string;version:number;name:string;number:string;signedOn:string;businessSnapshotHash:string}|null;vehicle?:{id:string;vin:string;identification:string}|null;relevantTerms:{earlyTerminationRule:string;depositRefundRule:string};delivery:{state:'UNKNOWN'|'NOT_DELIVERED'|'RETURNED'|'AWAITING_RETURN';deliveryId?:string;deliveredAt?:string;returnId?:string;returnedAt?:string;returnPlace?:string;readingKm?:number;source?:'PHYSICAL_RECEIPT'|'RETURN_HANDOVER'};funds:{receivedAmount:number;refundedAmount:number;netReceivedAmount:number;depositReceivedAmount:number;depositRefundedAmount:number};blockers:{code:string;message:string}[]};
export const terminationReasonLabels={CUSTOMER_REQUEST:'客户申请',PROVIDER_BREACH:'出租方或平台违约',MUTUAL_AGREEMENT:'各方协商一致',OTHER:'其他'};
export const terminationViolationLabels={NOT_APPLICABLE:'不适用',NONE:'无待处理违章',SETTLED:'已处理',PENDING:'待处理'};
const noDelivery='车辆未交付，无还车或还车查验事实，无需办理还车查验。';
const text=(key:string,label:string):BusinessField=>({key,label,kind:'textarea',required:true});
export function terminationFields(context:TerminationContext):BusinessField[]{return[
 {key:'reasonType',label:'终止原因类别',kind:'select',required:true,choices:Object.entries(terminationReasonLabels).map(([value,label])=>({value,label}))},
 {key:'effectiveAt',label:'终止生效时间（北京时间）',kind:'datetime-local',required:true},text('reason','具体终止原因'),
 ...(context.delivery.state==='AWAITING_RETURN'?[{key:'plannedReturnAt',label:'计划交回时间（北京时间）',kind:'datetime-local' as const,required:true},{key:'returnPlace',label:'计划交回地点',required:true}]:[]),
 ...(context.delivery.state==='NOT_DELIVERED'?[]:[{...text('conditionSummary','车况确认依据与待办'),hint:context.delivery.state==='UNKNOWN'?'交付及收车事实待核实，请说明核查安排，不填写未经确认的已交付、未交付或已还车结论。':context.delivery.state==='AWAITING_RETURN'?'尚无实际收车记录，请说明交回时的查验安排，不将计划表述为已查验。':'以显示的实际收车/还车记录为依据，注明仍待处理的车况事项。'}]),
 {key:'violationStatus',label:'违章处理状态',kind:'select',required:true,choices:Object.entries(terminationViolationLabels).map(([value,label])=>({value,label}))},
 {...text('violationSummary','违章处理说明与期限'),hint:'无事项请填写“无”或“不适用”；待处理时须写明安排及具体日期或几日内完成。'},
 {key:'additionalPaymentAmount',label:'客户应补款（元）',kind:'money',required:true,hint:'按双方确认金额填写；无应补款请明确填0。'},
 {key:'additionalPaymentDueOn',label:'付款期限（有应补款时必填）',kind:'date'},
 {key:'refundAmount',label:'应退客户款项（元）',kind:'money',required:true,hint:'为本次终止约定的应退金额，不会据此直接发起退款。'},
 {key:'refundDueOn',label:'退款期限（有应退款时必填）',kind:'date'},
 {key:'retainedDepositAmount',label:'暂保留押金（元）',kind:'money',required:true},
 {...text('retainedDepositHandling','保留押金处理安排与期限'),hint:'不保留请填写“无”；保留时须写明用途、处理安排及具体期限。'},
 text('settlementBasis','结算依据'),text('unresolvedMatters','尚未解决事项（无请填写“无”）'),
 ];}
const dateLocal=(value:unknown)=>{const time=Date.parse(String(value||''));return Number.isFinite(time)?new Date(time+8*60*60*1000).toISOString().slice(0,16):'';};
export function terminationInitial(details:Record<string,unknown>|null|undefined,context:TerminationContext):BusinessValues{
 const result:BusinessValues={};for(const f of terminationFields(context)){const value=details?.[f.key];result[f.key]=f.kind==='money'?typeof value==='number'?(value/100).toFixed(2):'':f.kind==='datetime-local'?dateLocal(value):typeof value==='string'?value:'';}return result;
}
const deadline=(value:string)=>/\d{4}[-年/]\d{1,2}[-月/]\d{1,2}|(?:\d+|[一二三四五六七八九十]+)\s*(?:个)?(?:工作日|天|日|周|个月)(?:内|前|后)/.test(value);
export function terminationDetailsBody(raw:Record<string,unknown>,context:TerminationContext):Record<string,any>{
 if(!context?.delivery||!['UNKNOWN','NOT_DELIVERED','RETURNED','AWAITING_RETURN'].includes(context.delivery.state))throw Error('交付及收车资料尚未完整读取，请刷新。');
 const out:Record<string,any>={};
 for(const key of ['reasonType','reason','effectiveAt','violationStatus','violationSummary','retainedDepositHandling','settlementBasis','unresolvedMatters']){const value=typeof raw[key]==='string'?raw[key].trim():'';if(!value)throw Error(`请填写${terminationFields(context).find(f=>f.key===key)?.label||key}`);if(value.length>3000)throw Error('终止说明每项最多3000字');out[key]=value;}
 if(!(out.reasonType in terminationReasonLabels)||!(out.violationStatus in terminationViolationLabels))throw Error('请选择有效的终止原因及违章处理状态');
 if(!Number.isFinite(Date.parse(out.effectiveAt)))throw Error('请填写有效的终止生效时间');
 for(const key of ['additionalPaymentAmount','refundAmount','retainedDepositAmount']){const amount=raw[key];if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<0||amount>2147483647)throw Error('请填写有效金额，最多两位小数且不能为负数');out[key]=amount;}
 for(const key of ['additionalPaymentDueOn','refundDueOn'])if(raw[key]){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(raw[key])))throw Error('请选择有效日期');out[key]=raw[key];}
 if(out.additionalPaymentAmount>0&&!out.additionalPaymentDueOn)throw Error('应补款不为零时，请填写付款期限');
 if(out.refundAmount>0&&!out.refundDueOn)throw Error('应退款不为零时，请填写退款期限');
 if(out.retainedDepositAmount>0&&!deadline(out.retainedDepositHandling))throw Error('保留款须填写具体处理安排和期限（日期或几日内）');
 if(out.violationStatus==='PENDING'&&!deadline(out.violationSummary))throw Error('待处理违章须填写具体安排和期限（日期或几日内）');
 out.conditionSummary=context.delivery.state==='NOT_DELIVERED'?noDelivery:String(raw.conditionSummary||'').trim();if(!out.conditionSummary)throw Error('请填写车况确认依据与待办');
 if(context.delivery.state==='AWAITING_RETURN'){if(!raw.plannedReturnAt||!Number.isFinite(Date.parse(String(raw.plannedReturnAt)))||!String(raw.returnPlace||'').trim())throw Error('请填写计划交回时间和地点；计划不代表实际收车');out.plannedReturnAt=raw.plannedReturnAt;out.returnPlace=String(raw.returnPlace).trim();}
 return out;
}
export function terminationReadiness(details:unknown,context:TerminationContext|null|undefined):string{
 if(!context)return '原合同及交付资料尚未完整读取，请刷新。';
 if(context.blockers?.length)return context.blockers.map(x=>x.message).join('；');
 if(context.delivery.state==='UNKNOWN')return '车辆交付及收车事实待核实，请核对原始交接记录后再生成。';
 if(!context.originalContract)return '请先补齐原已签合同资料。';
 if(!details||typeof details!=='object')return '请先填写并保存本次终止安排。';
 try{terminationDetailsBody(details as Record<string,unknown>,context);return '';}catch(e){return e instanceof Error?e.message:'请补齐终止安排。';}
}
