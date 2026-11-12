import {date} from './core';
import {Command,Facts,type Row} from './domain-ui';
import {ProseText} from './prose-text';
import {terminationDetailsBody,terminationFields,terminationInitial,terminationReadiness,terminationReasonLabels,terminationViolationLabels,type TerminationContext} from './termination-details-model';

export function TerminationDetailsForm({archive,version,editable,disabled,reload}:{archive:Row;version:Row;editable:boolean;disabled:boolean;reload:()=>Promise<void>}){
 const context=archive.terminationContext as TerminationContext|undefined,details=version.scopeSnapshot?.terminationDetails as Record<string,any>|undefined;
 if(!context)return <p className="order-read-warning">原合同及交付资料尚未完整读取，请刷新后填写终止安排。</p>;
 const restart=!!version.sourceFileId&&version.printConfirmed===true,printed=version.sourceFileId?version.scopeSnapshot?.terminationPrintSnapshot:undefined,issue=terminationReadiness(details,context);
 return <section className="termination-details" aria-label="本次终止安排">
  {printed?.context?<><section aria-label="生成时资料"><h4>生成时资料</h4><p className="muted">生成时间：{date(printed.capturedAt)}。以下资料对应本版生成文件。</p><TerminationContextFacts context={printed.context}/></section><details className="termination-reference"><summary>查看当前资料（不改变已生成协议）</summary><section aria-label="当前资料"><h4>当前资料</h4><p className="muted">原合同、车辆或交接事实变化后，需要重新生成。已提交审核的版本须先退回，再建立补正；已审核通过的版本可直接建立补正。</p><TerminationContextFacts context={context}/></section></details></>:<section aria-label="当前资料"><h4>当前资料</h4>{version.sourceFileId?<p className="order-read-warning">本版生成时资料未完整读取，以下为当前资料，不能代替已生成文件；请重新生成并核对。</p>:null}<TerminationContextFacts context={context}/></section>}
  {details?<><h4>已保存的终止安排</h4><Facts items={[["终止原因",terminationReasonLabels[details.reasonType as keyof typeof terminationReasonLabels]],["终止生效时间",date(details.effectiveAt)],["客户应补款",details.additionalPaymentAmount,'money'],["应退客户款项",details.refundAmount,'money'],["暂保留押金",details.retainedDepositAmount,'money'],["违章处理",terminationViolationLabels[details.violationStatus as keyof typeof terminationViolationLabels]]]}/><details className="termination-reference"><summary>查看全部已保存安排</summary><Facts items={[["具体原因",details.reason],["付款期限",details.additionalPaymentDueOn],["退款期限",details.refundDueOn],["违章安排",details.violationSummary],["保留押金安排",details.retainedDepositHandling],["结算依据",details.settlementBasis],["尚未解决事项",details.unresolvedMatters],["车况确认依据与待办",details.conditionSummary],["计划交回时间",details.plannedReturnAt?date(details.plannedReturnAt):undefined],["计划交回地点",details.returnPlace]]}/></details></>:null}
  {issue?<p className="order-read-warning" role="status">{issue}</p>:null}
  {editable?<Command label={restart?"修改并重新生成":"编辑终止安排"} processKey={`archive-termination-${version.id}`} path={`/admin/offline-archives/${archive.id}/versions/${version.id}`} method="PATCH" revision={archive.revision} disabled={disabled} fields={terminationFields(context)} initial={terminationInitial(details,context)} build={raw=>({terminationDetails:terminationDetailsBody(raw,context)})} after={reload} successReceipt="终止安排已保存。" nextStep="请按本次安排重新生成并预览协议。" note="按原已签合同及各方确认结果填写，金额不自动推算。保存后原生成文件和打印确认失效，须重新生成、预览打印，并重新签署并上传签字版；这里不会执行扣款或退款。"/>:null}
 </section>;
}

function TerminationContextFacts({context}:{context:TerminationContext}){
 const original=context.originalContract,delivery=context.delivery;
 return <>
  <h5>原已签合同</h5>{original?<Facts items={[["合同名称",original.name],["合同编号",original.number],["签署日期",original.signedOn],["原合同版本",`第 ${original.version} 版`]]}/>:<p className="order-read-warning">尚未取得原已签合同资料。</p>}
  {context.vehicle?<Facts items={[["原合同车辆",context.vehicle.identification],["VIN",context.vehicle.vin]]}/>:null}
  <details className="termination-reference"><summary>查看原合同约定的终止与押金条款</summary><h5>提前终止</h5><ProseText text={context.relevantTerms.earlyTerminationRule||'原已签版本的提前终止条款缺失。'}/><h5>押金处理</h5><ProseText text={context.relevantTerms.depositRefundRule||'原已签版本的押金条款缺失。'}/></details>
  <h5>车辆交回依据</h5>{delivery.state==='NOT_DELIVERED'?<p>车辆未交付，无需还车或还车查验。</p>:delivery.state==='AWAITING_RETURN'?<><p>此处填写交回计划，尚无实际收车记录。</p><Facts items={[["交付记录",delivery.deliveryId],["实际交付时间",date(delivery.deliveredAt)]]}/></>:delivery.state==='RETURNED'?<><p>已取得实际收车记录，车况以对应现场资料为准。</p><Facts items={[["记录来源",delivery.source==='PHYSICAL_RECEIPT'?'实际收车记录':'已完成还车查验单'],["记录编号",delivery.returnId],["实际收车时间",date(delivery.returnedAt)],["收车地点",delivery.returnPlace],["累计里程（km）",delivery.readingKm]]}/></>:<p className="order-read-warning">车辆交付及收车事实待核实，请核对原始交接记录。</p>}
  <details className="termination-reference"><summary>查看系统收退款参考（不自动填入结算金额）</summary><Facts items={[["已实收",context.funds.receivedAmount,'money'],["已成功退款",context.funds.refundedAmount,'money'],["当前净实收",context.funds.netReceivedAmount,'money'],["已收押金",context.funds.depositReceivedAmount,'money'],["已退押金",context.funds.depositRefundedAmount,'money']]}/></details>
 </>;
}
