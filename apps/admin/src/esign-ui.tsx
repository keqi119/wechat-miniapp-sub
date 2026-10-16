import { useEffect, useState } from 'react';
import { ArrowUpRight, FileCheck2, FileText, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, date, type Entity, type Page } from './core';
import { ErrorNotice, Loading, Status } from './ui';

type Readiness = { readyForSigning: boolean; signingEligible: boolean; state: string; realNameStatus: string; certBound: boolean; nextAction: string };
const readinessStates: Record<string, string> = { SIGNING_ENABLED: '实名与证书已准备', NOT_STARTED: '尚未注册签署账号', REALNAME_PENDING: '待客户完成实名', CERT_BINDING_PENDING: '待绑定实名证书', UNKNOWN: '待查询供应商状态' };
const nextSteps: Record<string, string> = { NONE: '实名与证书满足准备条件，仍需核对文案、印章与签署审批。', REGISTER_PROVIDER_ACCOUNT: '请客户在小程序注册签署账号并完成实名准备。', START_REALNAME_VERIFICATION: '请客户在小程序完成供应商实名核验。', QUERY_PROVIDER_STATUS: '请客户在小程序查询实名与证书状态，等待供应商确认。' };
export function CustomerSigningReadiness({ customerId }: { customerId: string }) {
  const [state, setState] = useState<Readiness>(); const [error, setError] = useState<unknown>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { const controller = new AbortController(); setState(undefined); setError(undefined); api.request<Readiness>(`/admin/customers/${encodeURIComponent(customerId)}/esign-readiness`, { signal: controller.signal }).then(setState).catch(error => { if (error.name !== 'AbortError') setError(error); }); return () => controller.abort(); }, [customerId, refresh]);
  return <section className="esign-card"><header><ShieldCheck size={18}/><h3>客户实名与证书准备</h3>{state ? <span className={state.readyForSigning ? 'readiness-ready' : 'readiness-pending'}>{readinessStates[state.state] ?? state.state}</span> : null}<button className="icon-button" aria-label="刷新实名准备状态" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14}/></button></header>{error ? <ErrorNotice error={error} retry={() => setRefresh(value => value + 1)}/> : !state ? <Loading label="正在查询签前准备状态"/> : <><div className="esign-checks"><div><span>供应商实名</span><strong>{state.realNameStatus === 'VERIFIED' ? '已核验' : state.realNameStatus === 'FAILED' ? '核验失败' : state.realNameStatus === 'EXPIRED' ? '已过期' : '待完成'}</strong></div><div><span>实名证书</span><strong>{state.certBound ? '已绑定' : '待绑定'}</strong></div></div><p>{nextSteps[state.nextAction] ?? '按服务端返回的准备状态继续处理。'}</p></>}</section>;
}
export function SigningPreparation({ entity, kind }: { entity: Entity; kind: 'SUBSCRIPTION' | 'HANDOVER' | 'AMENDMENT' }) {
  const [approval, setApproval] = useState<Entity>(); const [loaded, setLoaded] = useState(false); const [error, setError] = useState<unknown>();
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ resourceId: entity.id, kind, page: '1', pageSize: '100' });
    api.request<Page>(`/admin/esign-approvals?${query}`, { signal: controller.signal }).then(result => {
      const hash = kind === 'HANDOVER' ? entity.manifestHash : entity.documentHash;
      const matches = result.items.filter(item => item.resourceId === entity.id && item.kind === kind && item.documentHash === hash);
      setApproval(matches[0]); setLoaded(true);
    }).catch(error => { if (error.name !== 'AbortError') { setError(error); setLoaded(true); } });
    return () => controller.abort();
  }, [entity.id, entity.documentHash, entity.manifestHash, kind]);
  return <section className="esign-card"><header><FileCheck2 size={18}/><h3>冻结文档与签署复核</h3>{approval ? <Status value={approval.status}/> : null}</header>{error ? <ErrorNotice error={error}/> : !loaded ? <Loading label="正在读取当前文档的签署计划"/> : !approval ? <p>当前文档尚未生成冻结 PDF 与复核计划。请先确认客户实名证书、正式文案及有效签署策略，再准备签署复核。</p> : <><div className="esign-checks"><div><span>复核有效期</span><strong>{date(approval.expiresAt)}</strong></div><div><span>文档状态</span><strong>{new Date(String(approval.expiresAt)).getTime() <= Date.now() ? '复核计划已过期' : approval.status === 'REJECTED' ? '已驳回，请重新准备' : approval.status === 'APPROVED' ? '复核已通过，待实际签署' : '待另一名授权人员复核'}</strong></div></div><div className="esign-links">{typeof approval.sourceFileId === 'string' ? <a href={api.fileUrl(approval.sourceFileId)} target="_blank" rel="noreferrer"><FileText size={14}/>阅读冻结 PDF<ArrowUpRight size={12}/></a> : null}<a href={`#esign-approvals?record=${encodeURIComponent(approval.id)}`}>查看签署计划与审批<ArrowUpRight size={12}/></a></div><dl className="esign-hashes"><dt>PDF 内容哈希</dt><dd>{String(approval.sourcePdfHash ?? '—')}</dd><dt>签署计划哈希</dt><dd>{String(approval.planHash ?? '—')}</dd></dl><p>准备和审批不会产生“已签署”结果；最终状态仍由签署供应商核验。</p></>}</section>;
}
export function SigningApprovalSummary({ entity, userId }: { entity: Entity; userId: string }) {
  const samePerson = entity.requesterId === userId;
  return <section className="esign-card approval-summary"><header><ShieldCheck size={18}/><h3>双人复核要求</h3></header><p>{samePerson ? '您是该计划的申请人，请交由另一名具备此印章复核授权的人员审批。' : '请阅读冻结 PDF，核对文档与印章、签署位置及有效期。审批按当前计划哈希提交，服务端会重新核验授权、文档和策略。'}</p><div className="esign-links">{typeof entity.sourceFileId === 'string' ? <a href={api.fileUrl(entity.sourceFileId)} target="_blank" rel="noreferrer"><FileText size={14}/>阅读冻结 PDF<ArrowUpRight size={12}/></a> : null}{entity.resourceId ? <a href={`#${entity.kind === 'HANDOVER' ? 'handovers' : 'contracts'}?record=${encodeURIComponent(String(entity.resourceId))}`}>查看业务文档<ArrowUpRight size={12}/></a> : null}</div></section>;
}

export function SigningRenewalFacts({ entity }: { entity: Entity }) {
  const eligibility = entity.renewalEligibility as { eligible?: boolean; reason?: string; taskId?: string } | undefined;
  const renewal = (entity.plan as { renewal?: { taskId?: string; priorApprovalId?: string } } | undefined)?.renewal;
  if (!renewal && !(entity.status === 'APPROVED' && new Date(String(entity.expiresAt)).getTime() <= Date.now())) return null;
  return <section className="esign-card"><header><RefreshCw size={18}/><h3>同一签署任务重新授权</h3></header><p>{renewal ? '本计划为原任务的新授权复核。请核对同一冻结PDF及任务归属；原任务的授权切换由服务端在双人复核通过时校验，当前结果以本计划状态及最新任务记录为准。' : eligibility?.eligible ? '服务端确认原授权已过期，原签署任务可以申请新的双人授权。请选择已启用、文档类型一致且使用原印章的策略。' : '当前暂不能申请同一任务重新授权。'}</p><dl className="esign-hashes"><dt>原签署任务</dt><dd>{renewal?.taskId ?? eligibility?.taskId ?? '服务端未返回任务编号'}</dd>{renewal?.priorApprovalId ? <><dt>此前授权计划</dt><dd><a href={`#esign-approvals?record=${encodeURIComponent(renewal.priorApprovalId)}`}>{renewal.priorApprovalId}</a></dd></> : null}<dt>冻结PDF内容哈希</dt><dd>{String(entity.sourcePdfHash ?? '—')}</dd>{!renewal ? <><dt>服务端资格判断</dt><dd>{eligibility?.reason ?? '尚未取得资格判断，请刷新详情后重试'}</dd></> : null}</dl><p>沿用原任务、供应商交易编号与不可变PDF；重新授权本身不会产生已签署结果。</p></section>;
}
