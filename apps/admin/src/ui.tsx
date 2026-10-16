import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowUpRight, Check, FileText, LoaderCircle, Plus, Upload, X } from 'lucide-react';
import { api, ApiError, date, money, isPrivateField, type Entity, type Page } from './core';
import { serializeForm } from './form';
import { commercialTermLabels, handoverFactLabels, normaliseHandoverChecklist } from './business-terms';
import { display, type Field, statusLabel, verificationReviewNotice } from './resources';

export function PaymentVerificationReviewNotice({ entity }: { entity: Entity }) {
  const notice = verificationReviewNotice(entity);
  return notice ? <section className="esign-card approval-summary" role="note"><header><AlertCircle size={18}/><h3>{notice.title}</h3></header><p>{notice.message}</p></section> : null;
}

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : '请求失败，请稍后重试';
  return <div className="error-notice" role="alert"><AlertCircle size={18}/><div><strong>{message}</strong>{error instanceof ApiError && error.status === 409 ? <p>记录已经发生变化，请关闭表单并刷新详情后重新核对。</p> : null}{error instanceof ApiError && error.requestId ? <small>请求编号：{error.requestId}</small> : null}</div>{retry ? <button className="text-button" onClick={retry}>重新连接 <ArrowUpRight size={14}/></button> : null}</div>;
}
export function Loading({ label = '正在读取真实数据' }: { label?: string }) { return <div className="loading" role="status"><LoaderCircle size={20} className="spin"/>{label}</div>; }
export function Status({ value }: { value: unknown }) {
  const text = String(value ?? '');
  const tone = /PAID|SIGNED|APPROVED|COMPLETED|ACTIVE|AVAILABLE|PUBLISHED|SUCCEEDED|RESOLVED/.test(text) ? 'green' : /FAIL|REJECT|OVERDUE|CANCEL/.test(text) ? 'red' : /PENDING|AWAITING|REVIEW|SUBMITTED|OPEN|PROCESS|NEEDS|ACCEPTED/.test(text) ? 'orange' : 'neutral';
  return <span className={`status ${tone}`}><i/>{statusLabel(text) || '未设置'}</span>;
}
export function Drawer({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]');
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, [onClose]);
  return <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panel}><header className="drawer-header"><div><span className="eyebrow">CHUNDIAN / OPERATIONS</span><h2 id={titleId}>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button className="icon-button" aria-label="关闭面板" onClick={onClose}><X size={20}/></button></header>{children}</section></div>;
}
function ReferenceField({ field, value, onChange, disabled }: { field: Field; value: string; onChange: (value: string) => void; disabled: boolean }) {
  const [items, setItems] = useState<Entity[]>([]);
  const [error, setError] = useState<unknown>();
  const [keyword, setKeyword] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setError(undefined); setLoaded(false);
      const query = new URLSearchParams({ page: '1', pageSize: '100', keyword, ...field.sourceFilters });
      api.request<Page>(`/admin/${field.source}?${query}`, { signal: controller.signal }).then(page => { setItems(page.items.filter(item => Object.entries(field.sourceFilters ?? {}).every(([key, value]) => String(item[key]) === value))); setLoaded(true); }).catch(error => { if (error.name !== 'AbortError') { setError(error); setLoaded(true); } });
    }, keyword ? 300 : 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [field.source, keyword]);
return <><input aria-label={`查找${field.label}`} value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="输入名称、手机号或编号查找" disabled={disabled}/><select id={`field-${field.key}`} name={field.key} value={value} onChange={e => onChange(e.target.value)} required={field.required} disabled={disabled}><option value="">选择{field.label}</option>{value && !items.some(item => item.id === value) ? <option value={value}>{value}</option> : null}{items.map(item => <option key={item.id} value={item.id}>{display(item.title ?? item.name ?? item.sealName ?? item.policyName ?? item.mobile ?? item.id)} · {item.id.slice(-8)}{typeof item.amount === 'number' ? ` / ${money(item.amount)}` : ''}</option>)}</select>{loaded && !error && items.length === 0 ? <small>未找到可选记录。请调整关键词，或先完善对应业务记录。 <a href={`#${field.source}`}>打开相关模块</a></small> : null}{error ? <span className="field-error">关联数据读取失败，请稍后重试。</span> : null}</>;
}
function ChecklistField({ value, onChange, disabled, requireFacts = false }: { value: string; onChange: (value: string) => void; disabled: boolean; requireFacts?: boolean }) {
  const rows = JSON.parse(value || '[]') as { label: string; value: string }[];
  const change = (index: number, key: 'label' | 'value', next: string) => onChange(JSON.stringify(rows.map((row, i) => i === index ? { ...row, [key]: next } : row)));
  return <div className="checklist-field">{rows.map((row, index) => <div className="checklist-row" key={index}><span>{String(index + 1).padStart(2, '0')}</span><input aria-label={`检查项目 ${index + 1}`} placeholder="检查项目，如车身外观" value={requireFacts && index < 7 ? handoverFactLabels[row.label] ?? row.label : row.label} readOnly={requireFacts && index < 7} disabled={disabled} required onChange={e => change(index, 'label', e.target.value)}/><input aria-label={`检查结果 ${index + 1}`} placeholder="检查结果" value={row.value} disabled={disabled} required onChange={e => change(index, 'value', e.target.value)}/><button type="button" className="icon-button" aria-label={`移除检查项目 ${index + 1}`} disabled={disabled || (requireFacts && index < 7)} onClick={() => onChange(JSON.stringify(rows.filter((_row, i) => i !== index)))}><X size={14}/></button></div>)}<button className="button" type="button" disabled={disabled || rows.length >= 100} onClick={() => onChange(JSON.stringify([...rows, { label: '', value: '' }]))}><Plus size={14}/>添加检查项目</button></div>;
}
function CommercialTermsField({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  const terms = JSON.parse(value || '{}') as Record<string, string>;
  return <div className="commercial-fields" role="group" aria-label="逐单商业条款">{Object.entries(commercialTermLabels).map(([key, label], index) => <div className="commercial-field" key={key}><label htmlFor={`commercial-${key}`}><span>{String(index + 1).padStart(2, '0')}</span>{label}<i> *</i></label><textarea id={`commercial-${key}`} rows={3} required disabled={disabled} value={terms[key] ?? ''} onChange={e => onChange(JSON.stringify({ ...terms, [key]: e.target.value }))}/></div>)}</div>;
}
function FileField({ field, value, onChange, disabled }: { field: Field; value: string; onChange: (value: string) => void; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const single = field.key.endsWith('FileId');
  const ids = value.split('\n').filter(Boolean);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!single && ids.length + files.length > 20) { setError(new Error('每条记录最多上传 20 个附件')); return; }
    setBusy(true); setError(undefined);
    const uploaded: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const form = new FormData(); form.append('file', file); form.append('purpose', field.uploadPurpose ?? (field.key === 'fileIds' ? 'handover' : 'vehicle'));
        const result = await api.request<{ id: string }>('/admin/files', { method: 'POST', permission: 'files.write', body: form });
        uploaded.push(result.id);
      }
    } catch (error) { setError(error); }
    finally { if (uploaded.length) onChange((single ? uploaded.slice(-1) : [...ids, ...uploaded]).join('\n')); setBusy(false); }
  };
  return <div className="file-field"><label className={`upload-area ${disabled || busy ? 'disabled' : ''}`}><Upload size={20}/><span>{busy ? '正在上传真实文件…' : '选择图片或附件'}</span><small>文件保存至独立平台，成功后绑定文件 ID</small><input id={`field-${field.key}`} type="file" multiple={!single} disabled={disabled || busy} onChange={e => { void upload(e.target.files); e.target.value = ''; }}/></label>{ids.map(id => <div className="file-item" key={id}><FileText size={15}/><a href={api.fileUrl(id)} target="_blank" rel="noreferrer">附件 {id.slice(-12)}</a><button type="button" className="icon-button" aria-label="移除此附件" disabled={disabled} onClick={() => onChange(ids.filter(item => item !== id).join('\n'))}><X size={14}/></button></div>)}{error ? <ErrorNotice error={error}/> : null}</div>;
}
function initialValue(field: Field, initial: Record<string, unknown>) {
  const value = initial[field.key];
  if (field.type === 'commercial') return JSON.stringify(value ?? {});
  if (field.type === 'checklist' && field.requireFacts) return JSON.stringify(normaliseHandoverChecklist(value));
  if (field.type === 'money') return typeof value === 'number' ? (value / 100).toFixed(2) : '';
  if (field.type === 'boolean') return String(value ?? true);
  if (field.type === 'checklist') return value === undefined ? '[]' : JSON.stringify(value);
  if (Array.isArray(value)) return value.join('\n');
  if (field.type === 'date') return String(value ?? '').slice(0, 10);
  return value == null ? field.defaultValue ?? '' : String(value);
}
export function RecordForm({ fields, initial = {}, warning, submitLabel = '保存', onSubmit, onCancel }: { fields: Field[]; initial?: Record<string, unknown>; warning?: string; submitLabel?: string; onSubmit: (body: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(field => [field.key, initialValue(field, initial)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [confirmed, setConfirmed] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    setError(undefined);
    try {
      const body = serializeForm(fields, values);
      setBusy(true); await onSubmit(body);
    } catch (error) { setError(error); } finally { setBusy(false); }
  };
  return <form className="record-form" onSubmit={submit}>{warning ? <div className="action-warning"><AlertCircle size={19}/><p>{warning}</p></div> : null}<div className="form-grid">{fields.map(original => { const field = original.sourceWhen && values[original.sourceWhen.field] === original.sourceWhen.value ? { ...original, source: original.sourceWhen.source } : original; return <div className={`field ${['textarea', 'lines', 'files', 'checklist', 'commercial'].includes(field.type ?? '') ? 'wide' : ''}`} key={field.key}><label htmlFor={`field-${field.key}`}>{field.label}{field.required ? <span className="required"> *</span> : null}</label>{field.source ? <ReferenceField field={field} value={values[field.key]} disabled={busy} onChange={v => setValues(old => ({ ...old, [field.key]: v }))}/> : field.type === 'commercial' ? <CommercialTermsField value={values[field.key]} disabled={busy} onChange={v => setValues(old => ({ ...old, [field.key]: v }))}/> : field.type === 'checklist' ? <ChecklistField value={values[field.key]} requireFacts={field.requireFacts} disabled={busy} onChange={v => setValues(old => ({ ...old, [field.key]: v }))}/> : field.type === 'files' ? <FileField field={field} value={values[field.key]} disabled={busy} onChange={v => setValues(old => ({ ...old, [field.key]: v }))}/> : field.type === 'select' || field.type === 'boolean' ? <select id={`field-${field.key}`} required={field.required} value={values[field.key]} disabled={busy} onChange={e => setValues(old => ({ ...old, [field.key]: e.target.value }))}>{field.type === 'select' ? <option value="">请选择</option> : null}{(field.type === 'boolean' ? [['true', '启用'], ['false', '停用']] : field.options)?.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : ['textarea', 'lines'].includes(field.type ?? '') ? <textarea id={`field-${field.key}`} rows={field.key === 'content' ? 12 : 4} required={field.required} value={values[field.key]} disabled={busy} onChange={e => setValues(old => ({ ...old, [field.key]: e.target.value }))}/> : <input id={`field-${field.key}`} type={field.type === 'money' ? 'text' : field.type ?? 'text'} readOnly={field.readOnly} inputMode={field.type === 'money' ? 'decimal' : undefined} min={field.min} max={field.max} step={field.type === 'number' ? 1 : undefined} required={field.required} autoComplete={field.type === 'password' ? 'new-password' : undefined} value={values[field.key]} disabled={busy} onChange={e => setValues(old => ({ ...old, [field.key]: e.target.value }))}/>}{field.hint ? <small>{field.hint}</small> : null}</div>; })}</div>{warning ? <label className="confirm-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required/>我已核对上述业务对象和操作影响</label> : null}{error ? <ErrorNotice error={error}/> : null}<footer className="form-footer"><button type="button" className="button" onClick={onCancel} disabled={busy}>取消</button><button className="button primary" type="submit" disabled={busy || (!!warning && !confirmed)}>{busy ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>} {busy ? '正在提交' : submitLabel}</button></footer></form>;
}
const detailLabels: Record<string, string> = { id: '记录编号', customerId: '客户 ID', vehicleId: '车辆 ID', orderId: '订单 ID', billId: '账单 ID', paymentId: '支付 ID', status: '当前状态', revision: '方案版本', commercialHash: '商业条款哈希', manifestHash: '交接清单哈希', createdAt: '创建时间', updatedAt: '更新时间', monthlyFeeAmount: '月度订阅费', depositAmount: '押金', amount: '金额', readingKm: '仪表里程', mileageKm: '累计里程', fileIds: '附件', mediaFileIds: '媒体附件', coverFileId: '封面照片', finalPlan: '最终方案', customer: '客户信息', vehicle: '车辆信息', profile: '客户资料', snapshot: '方案快照', consents: '协议同意记录', checklist: '交接清单', note: '备注', reason: '原因', name: '姓名 / 名称', title: '标题', description: '说明', mobile: '手机号', type: '类型', role: '角色', content: '正文', benefits: '订阅权益', months: '订阅月数', startDate: '起租日期', firstDueDate: '首期到期日', dueDate: '应付日期', mileagePerMonthKm: '月含里程', excessMileagePriceAmount: '超里程单价', energyDescription: '能源说明', conditions: '使用条件', conditionDisclosure: '车况披露', brand: '品牌', model: '车型', city: '城市', year: '年份', batteryHealthPercent: '电池健康度', active: '启用', assigneeId: '处理人 ID', providerName: '服务方', contact: '联系方式', signedAt: '签署时间', paidAt: '支付时间', version: '文档版本', username: '用户名' };
const relations: Record<string, string> = { customerId: 'customers', vehicleId: 'vehicles', orderId: 'orders', paymentId: 'payments', billId: 'bills', applicationId: 'applications', subscriptionPlanId: 'plans' };
Object.assign(detailLabels, { subscriptionPlanId: '套餐 ID', applicationId: '申请 ID', drivingYears: '驾龄 / 年', finalPlanSnapshot: '已确认方案快照', customerResponse: '客户响应', responseReason: '异议说明', responseFileIds: '异议证据', signatureStatus: '交接签署状态', confirmedMileageKm: '已确认里程', actorType: '操作方', actorId: '操作人员', data: '变更记录', action: '操作', resourceType: '业务类型', resourceId: '关联记录', publishedAt: '发布时间', documentHash: '文档哈希', providerTaskId: '签署任务 ID', providerTransactionId: '渠道交易号', providerRefundId: '渠道退款号', requestedBy: '申请人员', approvedBy: '审核人员', sequence: '账单期数', paidAmount: '已付金额', documentId: '协议 ID', templateVersion: '模板版本', kind: '合同类型', recordedAt: '记录时间', reviewedBy: '审核人员', sourceFileId: '原始合同文件', signedFileId: '已签署文件', expiresAt: '到期时间', completedAt: '完成时间' });
Object.assign(detailLabels, { sealName: '印章名称', organizationName: '企业主体', providerCustomerId: '供应商企业客户编号', providerSignatureId: '供应商印章编号', evidenceFileId: '企业与用印授权证明', confirmedBy: '核验人员', sealId: '企业印章', policyId: '签署策略', policyCode: '策略编码', policyName: '策略名称', executionMode: '执行顺序', subjectType: '授权对象类型', subjectId: '授权对象', authorityType: '用印授权类型', requiresTwoPersonApproval: '双人复核', requesterId: '申请人员', approverId: '复核人员', sourcePdfHash: '冻结PDF内容哈希', slotCoordinates: 'PDF签署位置', planHash: '签署计划哈希', plan: '冻结签署计划', approvedAt: '复核通过时间', sourcePlanHash: '业务编译计划哈希', binding: '签署绑定信息', signerType: '签署方', signerRole: '签署职责', required: '是否必需', steps: '执行步骤', pageIndex: '页码索引', x: '横坐标', y: '纵坐标', width: '宽度', height: '高度' });
Object.assign(relations, { sealId: 'enterprise-seals', policyId: 'signature-policies' });
Object.assign(detailLabels, { renewal: '同任务重新授权来源', renewalEligibility: '重新授权资格', eligible: '符合重新授权条件', taskId: '原签署任务', priorApprovalId: '此前授权计划' });
Object.assign(relations, { priorApprovalId: 'esign-approvals' });
Object.assign(detailLabels, { currency: '币种', authorizationNote: '验收授权说明' });
Object.assign(detailLabels, { manualReviewRequired: '需人工核对', statusMessage: '可信渠道状态说明' });
Object.assign(detailLabels, { evidenceFileIds: '费用证据附件', createdBy: '创建人员', reviewNote: '复核意见', reviewedAt: '复核时间', terminationFileId: '正式终止协议', cancellationReason: '取消原因', cancelledAt: '取消时间', previousHandoverId: '上一版交接单', resolutionNote: '异议处理说明', resolvedBy: '异议处理人员' });
Object.assign(relations, { previousHandoverId: 'handovers' });
Object.assign(detailLabels, commercialTermLabels, { commercialTerms: '逐单商业条款' });
export function DetailValues({ entity }: { entity: Record<string, unknown> }) {
return <dl className="detail-values">{Object.entries(entity).filter(([key, value]) => value != null && !isPrivateField(key)).map(([key, value]) => <div key={key} className={typeof value === 'object' || String(value).length > 75 ? 'full' : ''}><dt>{detailLabels[key] ?? key}</dt><dd>{relations[key] && typeof value === 'string' ? <a href={`#${relations[key]}?record=${encodeURIComponent(value)}`}>{value}<ArrowUpRight size={12}/></a> : key === 'manualReviewRequired' ? value === true ? '需人工核对' : '无需人工核对' : key === 'kind' ? value === 'SUBSCRIPTION' ? '订阅合同' : value === 'HANDOVER' ? '车辆交接单' : display(value) : key === 'status' ? <Status value={value}/> : /Amount$|^amount$/.test(key) ? money(value) : /At$|Date$/.test(key) ? date(value, /Date$/.test(key)) : /FileId$/.test(key) && typeof value === 'string' ? <a target="_blank" rel="noreferrer" href={api.fileUrl(value)}>查看附件 <ArrowUpRight size={13}/></a> : Array.isArray(value) ? <div className="detail-array">{value.map((item, index) => /fileIds$/i.test(key) && typeof item === 'string' ? <a key={index} target="_blank" rel="noreferrer" href={api.fileUrl(item)}>附件 {index + 1} <ArrowUpRight size={12}/></a> : typeof item === 'object' && item !== null ? <DetailValues key={index} entity={item as Record<string, unknown>}/> : <span key={index}>{display(item)}</span>)}</div> : typeof value === 'object' ? <DetailValues entity={value as Record<string, unknown>}/> : display(value)}</dd></div>)}</dl>;
}
