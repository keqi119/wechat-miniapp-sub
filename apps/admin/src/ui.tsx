import {VehicleWorkspace} from './vehicle-workspace';
import {vehicleLedgerStatus} from './vehicle-ledger-display';
import {HandoverProcessGuide} from './process-guide';
import {useRecordWorkspace} from './record-workspace-shell';
import {CommandBoundary} from './domain-ui';
import {ProcessReturn} from './process-navigation-ui';
import {syncProcessSection} from './process-navigation';
import {visibleBusinessField} from './detail-visibility';
import { OrderWorkspace } from './order-workspace';
import {CustomerProfilePanel} from './customer-profile';
import {canReadCustomerProfile} from './customer-profile-model';
import {ProseText} from './prose-text';
import {LegalDocumentPreview} from './legal-document-preview';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowUpRight, Check, FileText, LoaderCircle, Plus, Upload, X } from 'lucide-react';
import { api, ApiError, date, money, isPrivateField, type Entity, type Page } from './core';
import { serializeForm } from './form';
import { commercialTermLabels, handoverFactLabels, normaliseHandoverChecklist } from './business-terms';
import { display, type Field, statusLabel, verificationReviewNotice } from './resources';
import { creditDepositPreview, creditBandLabels } from './credit';
import { shanghaiDateTime, usageStatusLabel } from './usage';
import {swapCreditStatusLabel} from './swap-credits';
import { requestErrorHint } from './request-error-hint';
import { detailSections, detailSummary } from './detail-layout';
import { refreshPlanFormValues, restoreCommercialTerm } from './final-plan-defaults';

export function PaymentVerificationReviewNotice({ entity }: { entity: Entity }) {
  const notice = verificationReviewNotice(entity);
  return notice ? <section className="esign-card approval-summary" role="note"><header><AlertCircle size={18}/><h3>{notice.title}</h3></header><p>{notice.message}</p></section> : null;
}

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : '请求失败，请稍后重试';
  const hint = error instanceof ApiError ? requestErrorHint(error) : undefined;
  return <div className="error-notice" role="alert"><AlertCircle size={18}/><div><strong>{message}</strong>{hint ? <p>{hint}</p> : null}{error instanceof ApiError && error.requestId ? <small>请求编号：{error.requestId}</small> : null}</div>{retry ? <button className="text-button" onClick={retry}>重新连接 <ArrowUpRight size={14}/></button> : null}</div>;
}
export function Loading({ label = '正在读取真实数据' }: { label?: string }) { return <div className="loading" role="status"><LoaderCircle size={20} className="spin"/>{label}</div>; }
export function Status({ value, resource }: { value: unknown; resource?: string }) {
  const text = String(value ?? '');
  const tone = /PAID|SIGNED|APPROVED|COMPLETED|ACTIVE|AVAILABLE|PUBLISHED|SUCCEEDED|RESOLVED/.test(text) ? 'green' : /FAIL|REJECT|OVERDUE|CANCEL/.test(text) ? 'red' : /PENDING|AWAITING|REVIEW|SUBMITTED|OPEN|PROCESS|NEEDS|ACCEPTED|RECONCILIATION_REQUIRED/.test(text) ? 'orange' : 'neutral';
  return <span className={`status ${tone}`}><i/>{(resource==='bills'&&text==='PENDING'?'待支付':resource==='vehicles'?vehicleLedgerStatus(text):undefined)??swapCreditStatusLabel(resource,text)??usageStatusLabel(resource, text) ?? (statusLabel(text) || '未设置')}</span>;
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
      const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary') ?? []).filter(element => element.getClientRects().length > 0);
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
  return <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panel}><header className="drawer-header"><div><h2 id={titleId}>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button className="icon-button" aria-label="关闭面板" onClick={onClose}><X size={20}/></button></header>{api.session?.user.id?<ProcessReturn userId={api.session.user.id}/>:null}<div className="drawer-content">{children}</div></section></div>;
}

/** Keeps business actions visible while the full server record remains available in separate panels. */
export function DetailWorkspace({ entity, status, resource, actions, emptyActionMessage, onRefresh, overview, operations, layout, detailError, detailRefreshing, vehicleSlots }: { vehicleSlots?:{asset?:ReactNode;maintenance?:ReactNode;plates?:ReactNode};detailError?:unknown;detailRefreshing?:boolean;layout?:'page'|'embedded'; entity: Record<string, unknown>; status: unknown; resource: string; actions: ReactNode; emptyActionMessage?: string; onRefresh: () => void; overview?: ReactNode; operations?: ReactNode }) {
  if (resource === 'orders') return <OrderWorkspace layout={layout} detailError={detailError} detailRefreshing={detailRefreshing} entity={entity} status={<Status value={status} resource={resource}/>} actions={actions} emptyActionMessage={emptyActionMessage} onRefresh={onRefresh} operations={operations} renderValues={value => <GroupedDetailValues entity={value} resource={resource}/>}/>;
  if (resource === 'vehicles') return <VehicleWorkspace key={`${api.session?.user.id||''}:${String(entity.id)}`} entity={entity} status={<Status value={status} resource={resource}/>} actions={actions} emptyActionMessage={emptyActionMessage} onRefresh={onRefresh} overview={overview} operations={operations} layout={layout} detailError={detailError} detailRefreshing={detailRefreshing} slots={vehicleSlots} renderValues={value=><GroupedDetailValues entity={value} resource={resource}/>}/>;
  return <GenericDetailWorkspace layout={layout} detailError={detailError} detailRefreshing={detailRefreshing} entity={entity} status={status} resource={resource} actions={actions} emptyActionMessage={emptyActionMessage} onRefresh={onRefresh} overview={overview} operations={operations}/>;
}
function GenericDetailWorkspace({ entity, status, resource, actions, emptyActionMessage, onRefresh, overview, operations, layout, detailError, detailRefreshing }: Parameters<typeof DetailWorkspace>[0]) {
  const sections = detailSections(entity), summary = detailSummary(entity);
  const [readVersion,setReadVersion]=useState(0);useEffect(()=>{if(!detailRefreshing&&!detailError)setReadVersion(value=>value+1);},[entity.id,entity.revision,detailRefreshing,detailError]);
  return <CommandBoundary disabled={detailRefreshing||!!detailError} readVersion={readVersion}><DetailFrame layout={layout} status={status ? <Status value={status} resource={resource}/> : null} actions={actions} emptyActionMessage={emptyActionMessage} onRefresh={onRefresh} tabs={[
    {key:'overview',label:'处理概览',content:<>{detailError?<ErrorNotice error={detailError} retry={onRefresh}/>:null}{detailRefreshing?<p role="status">正在核对当前资料，读取完成后可办理。</p>:null}{['handover-tasks','handovers'].includes(resource)?<HandoverProcessGuide entity={entity} resource={resource}/>:null}<h3 className="detail-section-title">关键信息</h3>{Object.keys(summary).length ? <DetailValues entity={summary} resource={resource}/> : <p className="detail-command-note">完整业务资料见“详细资料”。</p>}{overview ? <div className="detail-overview-checks"><h3 className="detail-section-title">办理条件与进度</h3>{overview}</div> : null}</>},
    ...(resource==='applications'&&canReadCustomerProfile(api.session?.user.role)?[{key:'customer-profile',label:'客户资料',content:<CustomerProfilePanel resource="applications" recordId={String(entity.id)} refreshKey={entity}/>}]:[]),
    ...(operations ? [{key:'operations',label:resource === 'orders' ? '履约与变更' : '业务办理',content:operations}] : []),
    {key:'details',label:'详细资料',content:<><h3 className="detail-section-title">完整资料与条款</h3><p className="detail-command-note">展开资料分组查看完整内容，附件及关联记录可直接打开。</p><GroupedDetailValues entity={sections.details} resource={resource}/></>},
    ...(Object.keys(sections.history).length ? [{key:'history',label:'历史记录',content:<><h3 className="detail-section-title">历史与同意记录</h3><GroupedDetailValues entity={sections.history} resource={resource}/></>}] : []),
  ]}/></CommandBoundary>;
}

/** Shared drawer layout; tab panels stay mounted so switching never discards form input. */
export function DetailFrame({status,actions,toolbar,emptyActionMessage,onRefresh,tabs,activeTab,onTabChange,className='',layout,notice}:{notice?:ReactNode;status:ReactNode;actions:ReactNode;toolbar?:ReactNode;emptyActionMessage?:string;onRefresh:()=>void;tabs:{key:string;label:string;content:ReactNode}[];activeTab?:string;onTabChange?:(key:string)=>void;className?:string;layout?:'page'|'embedded'}) {
  const inPage=useRecordWorkspace(),page=layout==='page'||inPage;
  const [selected,setSelected]=useState(()=>{const view=new URLSearchParams(window.location.hash.split('?')[1]).get('view');return tabs.some(item=>item.key===view)?view!:'overview';});
  useEffect(()=>{if(activeTab!==undefined)return;const update=()=>{const view=new URLSearchParams(window.location.hash.split('?')[1]).get('view');if(view&&tabs.some(item=>item.key===view))setSelected(view);};window.addEventListener('hashchange',update);window.addEventListener('process-location',update);return()=>{window.removeEventListener('hashchange',update);window.removeEventListener('process-location',update);};},[activeTab,tabs]);
  const positions=useRef<Record<string,number>>({});
  const id=useId(),tab=activeTab??selected;
  const active=tabs.some(item=>item.key===tab)?tab:tabs[0]?.key||'overview';
  const select=(key:string)=>{const scroll=document.getElementById(`${id}-scroll`);positions.current[active]=scroll?.scrollTop||0;setSelected(key);syncProcessSection(key);onTabChange?.(key);requestAnimationFrame(()=>scroll?.scrollTo({top:positions.current[key]||0}));};
  const navigation=<div className="detail-tabs" role="tablist" aria-label="详情分区" aria-orientation="horizontal">{tabs.map(item=><button type="button" role="tab" id={`${id}-${item.key}-tab`} aria-controls={`${id}-${item.key}-panel`} aria-selected={active===item.key} tabIndex={active===item.key?0:-1} key={item.key} onClick={()=>select(item.key)} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const current=tabs.findIndex(value=>value.key===item.key),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(current+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+tabs.length)%tabs.length;select(tabs[next].key);document.getElementById(`${id}-${tabs[next].key}-tab`)?.focus();}}>{item.label}</button>)}</div>;
  return <div className={`detail-workspace ${page?'detail-workspace-page':''} ${className}`}>
    {page?<nav className={`detail-section-nav${toolbar?' has-toolbar':''}`} id={`${id}-nav`} aria-label="本记录分区">{navigation}{toolbar?<div className="detail-tab-toolbar">{toolbar}</div>:null}</nav>:<><section className="detail-command" aria-label="当前状态与操作"><div className="detail-command-heading"><div>{status||<strong>业务记录</strong>}<span>当前可办操作</span></div><button className="text-button" onClick={onRefresh}>刷新详情</button></div><div className="detail-command-buttons">{actions}</div>{emptyActionMessage?<p className="detail-command-note">{emptyActionMessage}</p>:null}</section>{navigation}</>}
    <div className="detail-panel-scroll" id={`${id}-scroll`}>
      {notice?<div className="workspace-read-notice">{notice}</div>:null}
      {page?<section className="detail-page-commands" aria-label="当前状态与操作">{actions}{emptyActionMessage?<p className="detail-command-note">{emptyActionMessage}</p>:null}</section>:null}
      {tabs.map(item=><section className="detail-tab-panel" role="tabpanel" id={`${id}-${item.key}-panel`} aria-labelledby={`${id}-${item.key}-tab`} hidden={active!==item.key} key={item.key}>{item.content}{!page&&item.key==='overview'?<div className="detail-shortcuts">{tabs.filter(value=>value.key!=='overview').map(value=><button className="button" type="button" key={value.key} onClick={()=>select(value.key)}>{value.label}<ArrowUpRight size={14}/></button>)}</div>:null}</section>)}
    </div>
  </div>;
}

function GroupedDetailValues({ entity, resource }: { entity: Record<string, unknown>; resource: string }) {
  if(resource==='legal-documents'&&typeof entity.content==='string'){
    const {content,...metadata}=entity;
    return <><GroupedDetailValues entity={metadata} resource={resource}/><section className="legal-preview-section"><h3 className="detail-section-title">正文</h3><LegalDocumentPreview content={content} title={typeof entity.title==='string'?entity.title:undefined}/></section></>;
  }
  const fields = Object.entries(entity).filter(([key, value]) => value != null && visibleBusinessField(key,resource));
  const expanded = fields.filter(([, value]) => typeof value !== 'object' && String(value).length <= 200);
  const folded = fields.filter(([, value]) => typeof value === 'object' || String(value).length > 200);
  return <><DetailValues entity={Object.fromEntries(expanded)} resource={resource}/>{folded.map(([key, value]) => <details className="detail-record-group" key={key}><summary>{detailLabels[key] ?? key}{Array.isArray(value) ? <small>{value.length} 项</small> : null}</summary><DetailValues entity={{ [key]: value }} resource={resource}/></details>)}</>;
}
export function ReferenceField({ field, value, onChange, disabled, controlId }: { controlId?:string; field: Field; value: string; onChange: (value: string) => void; disabled: boolean }) {
  const generatedId=useId(),inputId=controlId||generatedId;
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
return <><input aria-label={`查找${field.label}`} value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="输入名称、手机号或编号查找" disabled={disabled}/><select id={inputId} name={field.key} value={value} onChange={e => onChange(e.target.value)} required={field.required} disabled={disabled}><option value="">选择{field.label}</option>{value && !items.some(item => item.id === value) ? <option value={value}>{value}</option> : null}{items.map(item => <option key={item.id} value={item.id}>{display(item.title ?? item.name ?? item.sealName ?? item.policyName ?? item.mobile ?? item.id)} · {item.id.slice(-8)}{typeof item.amount === 'number' ? ` / ${money(item.amount)}` : ''}</option>)}</select>{loaded && !error && items.length === 0 ? <small>未找到可选记录。请调整关键词，或先完善对应业务记录。 <a href={`#${field.source}`}>打开相关模块</a></small> : null}{error ? <span className="field-error">关联数据读取失败，请稍后重试。</span> : null}</>;
}
function ChecklistField({ value, onChange, disabled, requireFacts = false }: { value: string; onChange: (value: string) => void; disabled: boolean; requireFacts?: boolean }) {
  const rows = JSON.parse(value || '[]') as { label: string; value: string }[];
  const change = (index: number, key: 'label' | 'value', next: string) => onChange(JSON.stringify(rows.map((row, i) => i === index ? { ...row, [key]: next } : row)));
  return <div className="checklist-field">{rows.map((row, index) => <div className="checklist-row" key={index}><span>{String(index + 1).padStart(2, '0')}</span><input aria-label={`检查项目 ${index + 1}`} placeholder="检查项目，如车身外观" value={requireFacts && index < 7 ? handoverFactLabels[row.label] ?? row.label : row.label} readOnly={requireFacts && index < 7} disabled={disabled} required onChange={e => change(index, 'label', e.target.value)}/><input aria-label={`检查结果 ${index + 1}`} placeholder="检查结果" value={row.value} disabled={disabled} required onChange={e => change(index, 'value', e.target.value)}/><button type="button" className="icon-button" aria-label={`移除检查项目 ${index + 1}`} disabled={disabled || (requireFacts && index < 7)} onClick={() => onChange(JSON.stringify(rows.filter((_row, i) => i !== index)))}><X size={14}/></button></div>)}<button className="button" type="button" disabled={disabled || rows.length >= 100} onClick={() => onChange(JSON.stringify([...rows, { label: '', value: '' }]))}><Plus size={14}/>添加检查项目</button></div>;
}
function CommercialTermsField({ value, onChange, disabled, defaults }: { value: string; onChange: (value: string) => void; disabled: boolean; defaults?: Record<string, string> }) {
  const prefix=useId();
  const terms = JSON.parse(value || '{}') as Record<string, string>;
  return <div className="commercial-fields" role="group" aria-label="逐单商业条款">{Object.entries(commercialTermLabels).map(([key, label], index) => <div className="commercial-field" key={key}><div className="commercial-field-heading"><label htmlFor={`${prefix}-commercial-${key}`}><span>{String(index + 1).padStart(2, '0')}</span>{label}<i> *</i></label>{defaults && typeof defaults[key] === 'string' ? <button type="button" className="text-button" aria-label={`恢复${label}默认条款`} disabled={disabled || terms[key] === defaults[key]} onClick={() => onChange(restoreCommercialTerm(value, key, defaults))}>恢复默认</button> : null}</div><textarea id={`${prefix}-commercial-${key}`} rows={3} required disabled={disabled} value={terms[key] ?? ''} onChange={e => onChange(JSON.stringify({ ...terms, [key]: e.target.value }))}/></div>)}</div>;
}
function FileField({ field, value, onChange, disabled, controlId }: { controlId?:string; field: Field; value: string; onChange: (value: string) => void; disabled: boolean }) {
  const generatedId=useId(),inputId=controlId||generatedId;
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
  return <div className="file-field"><label className={`upload-area ${disabled || busy ? 'disabled' : ''}`}><Upload size={20}/><span>{busy ? '正在上传真实文件…' : '选择图片或附件'}</span><small>文件保存至独立平台，成功后绑定文件 ID</small><input id={inputId} type="file" multiple={!single} disabled={disabled || busy} onChange={e => { void upload(e.target.files); e.target.value = ''; }}/></label>{ids.map(id => <div className="file-item" key={id}><FileText size={15}/><a href={api.fileUrl(id)} target="_blank" rel="noreferrer">附件 {id.slice(-12)}</a><button type="button" className="icon-button" aria-label="移除此附件" disabled={disabled} onClick={() => onChange(ids.filter(item => item !== id).join('\n'))}><X size={14}/></button></div>)}{error ? <ErrorNotice error={error}/> : null}</div>;
}
function initialValue(field: Field, initial: Record<string, unknown>) {
  const value = initial[field.key];
  if (field.type === 'datetime-local') return shanghaiDateTime(value);
  if (field.type === 'commercial') return JSON.stringify(value ?? {});
  if (field.type === 'checklist' && field.requireFacts) return JSON.stringify(normaliseHandoverChecklist(value));
  if (field.type === 'money') return typeof value === 'number' ? (value / 100).toFixed(2) : '';
  if (field.type === 'boolean') return String(value ?? true);
  if (field.type === 'checklist') return value === undefined ? '[]' : JSON.stringify(value);
  if (Array.isArray(value)) return value.join('\n');
  if (field.type === 'date') return String(value ?? '').slice(0, 10);
  return value == null ? field.defaultValue ?? '' : String(value);
}
export function RecordForm({ fields, initial = {}, warning, submitLabel = '保存', onSubmit, onCancel, commercialDefaults, defaultsRevision, submitDisabled = false }: { fields: Field[]; initial?: Record<string, unknown>; warning?: string; submitLabel?: string; onSubmit: (body: Record<string, unknown>) => Promise<void>; onCancel: () => void; commercialDefaults?: Record<string, string>; defaultsRevision?: number; submitDisabled?: boolean }) {
  const formId=useId();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(field => [field.key, initialValue(field, initial)])));
  const previousDefaults = useRef(Object.fromEntries(fields.map(field => [field.key, initialValue(field, initial)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (defaultsRevision === undefined) return;
    const next = Object.fromEntries(fields.map(field => [field.key, initialValue(field, initial)]));
    const previous = previousDefaults.current;
    setValues(current => refreshPlanFormValues(current, previous, next));
    previousDefaults.current = next;
    setConfirmed(false);
  }, [defaultsRevision]);
  useEffect(()=>{setValues(old=>{const next={...old};for(const field of fields)if(field.readOnly)next[field.key]=initialValue(field,initial);return next;});},[JSON.stringify(fields.filter(f=>f.readOnly).map(f=>[f.key,initial[f.key]]))]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || submitDisabled) return;
    setError(undefined);
    try {
      const body = serializeForm(fields, values);
      setBusy(true); await onSubmit(body);
    } catch (error) { setError(error); } finally { setBusy(false); }
  };
  return <form className="record-form" onSubmit={submit}>{warning ? <div className="action-warning"><AlertCircle size={19}/><p>{warning}</p></div> : null}<div className="form-grid">{fields.map(original => { const field = original.sourceWhen && values[original.sourceWhen.field] === original.sourceWhen.value ? { ...original, source: original.sourceWhen.source } : original; return <div className={`field ${['textarea', 'lines', 'files', 'checklist', 'commercial'].includes(field.type ?? '') ? 'wide' : ''}`} key={field.key}><label htmlFor={`${formId}-field-${field.key}`}>{field.label}{field.required ? <span className="required"> *</span> : null}</label>{field.source ? <ReferenceField controlId={`${formId}-field-${field.key}`} field={field} value={values[field.key]} disabled={busy} onChange={v => setValues(old => ({ ...old, [field.key]: v }))}/> : field.type === 'commercial' ? <CommercialTermsField value={values[field.key]} disabled={busy} defaults={commercialDefaults} onChange={v => setValues(old => ({ ...old, [field.key]: v }))}/> : field.type === 'checklist' ? <ChecklistField value={values[field.key]} requireFacts={field.requireFacts} disabled={busy} onChange={v => setValues(old => ({ ...old, [field.key]: v }))}/> : field.type === 'files' ? <FileField controlId={`${formId}-field-${field.key}`} field={field} value={values[field.key]} disabled={busy} onChange={v => setValues(old => ({ ...old, [field.key]: v }))}/> : field.type === 'attestation' ? <input id={`${formId}-field-${field.key}`} type="checkbox" aria-label={field.label} required={field.required} checked={values[field.key] === 'true'} disabled={busy} onChange={e => setValues(old => ({ ...old, [field.key]: String(e.target.checked) }))}/> : field.type === 'select' || field.type === 'boolean' ? <select id={`${formId}-field-${field.key}`} required={field.required} value={values[field.key]} disabled={busy} onChange={e => setValues(old => ({ ...old, [field.key]: e.target.value }))}>{field.type === 'select' ? <option value="">请选择</option> : null}{(field.type === 'boolean' ? [['true', '启用'], ['false', '停用']] : field.options)?.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : ['textarea', 'lines'].includes(field.type ?? '') ? <textarea readOnly={field.readOnly} id={`${formId}-field-${field.key}`} rows={field.key === 'content' ? 12 : 4} required={field.required} value={values[field.key]} disabled={busy} onChange={e => setValues(old => ({ ...old, [field.key]: e.target.value }))}/> : <input id={`${formId}-field-${field.key}`} type={field.type === 'money' ? 'text' : field.type ?? 'text'} readOnly={field.readOnly} inputMode={field.type === 'money' ? 'decimal' : undefined} min={field.min} max={field.max} step={field.type === 'number' ? 1 : undefined} required={field.required} autoComplete={field.type === 'password' ? 'new-password' : undefined} value={field.creditDerived ? creditDepositPreview(values, initial) : values[field.key]} disabled={busy} onChange={e => setValues(old => ({ ...old, [field.key]: e.target.value }))}/>}{field.hint ? <small>{field.hint}</small> : null}</div>; })}</div>{warning ? <label className="confirm-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required/>我已核对上述业务对象和操作影响</label> : null}{error ? <ErrorNotice error={error}/> : null}<footer className="form-footer"><button type="button" className="button" onClick={onCancel} disabled={busy}>取消</button><button className="button primary" type="submit" disabled={busy || submitDisabled || (!!warning && !confirmed)}>{busy ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>} {busy ? '正在提交' : submitLabel}</button></footer></form>;
}
const detailLabels: Record<string, string> = { id: '记录编号', customerId: '客户 ID', vehicleId: '车辆 ID', orderId: '订单 ID', billId: '账单 ID', paymentId: '支付 ID', status: '当前状态', revision: '方案版本', commercialHash: '商业条款哈希', manifestHash: '交接清单哈希', createdAt: '创建时间', updatedAt: '更新时间', monthlyFeeAmount: '月度订阅费', depositAmount: '押金', amount: '金额', readingKm: '仪表里程', mileageKm: '累计里程', fileIds: '附件', mediaFileIds: '媒体附件', coverFileId: '封面照片', finalPlan: '最终方案', customer: '客户信息', vehicle: '车辆信息', profile: '客户资料', snapshot: '方案快照', consents: '协议同意记录', checklist: '交接清单', note: '备注', reason: '原因', name: '姓名 / 名称', title: '标题', description: '说明', mobile: '手机号', type: '类型', role: '角色', content: '正文', benefits: '订阅权益', months: '订阅月数', startDate: '起租日期', firstDueDate: '首期到期日', dueDate: '应付日期', mileagePerMonthKm: '月含里程', excessMileagePriceAmount: '超里程单价', energyDescription: '能源说明', conditions: '使用条件', conditionDisclosure: '车况披露', brand: '品牌', model: '车型', city: '城市', year: '年份', batteryHealthPercent: '电池健康度', active: '启用', assigneeId: '处理人 ID', providerName: '服务方', contact: '联系方式', signedAt: '签署时间', paidAt: '支付时间', version: '文档版本', username: '用户名' };
const relations: Record<string, string> = { customerId: 'customers', vehicleId: 'vehicles', orderId: 'orders', paymentId: 'payments', billId: 'bills', applicationId: 'applications', subscriptionPlanId: 'plans', archiveId: 'offline-archives', documentArchiveId: 'offline-archives', contractArchiveId: 'offline-archives', ownerId: 'partners' };
Object.assign(detailLabels, { subscriptionPlanId: '套餐 ID', applicationId: '申请 ID', drivingYears: '驾龄 / 年', finalPlanSnapshot: '已确认方案快照', customerResponse: '客户响应', responseReason: '异议说明', responseFileIds: '异议证据', signatureStatus: '交接签署状态', confirmedMileageKm: '已确认里程', actorType: '操作方', actorId: '操作人员', data: '变更记录', action: '操作', resourceType: '业务类型', resourceId: '关联记录', publishedAt: '发布时间', documentHash: '文档哈希', providerTaskId: '签署任务 ID', providerTransactionId: '渠道交易号', providerRefundId: '渠道退款号', requestedBy: '申请人员', approvedBy: '审核人员', sequence: '账单期数', paidAmount: '已付金额', documentId: '协议 ID', templateVersion: '模板版本', kind: '合同类型', recordedAt: '记录时间', reviewedBy: '审核人员', sourceFileId: '原始合同文件', signedFileId: '已签署文件', expiresAt: '到期时间', completedAt: '完成时间' });
Object.assign(detailLabels, { sealName: '印章名称', organizationName: '企业主体', providerCustomerId: '供应商企业客户编号', providerSignatureId: '供应商印章编号', evidenceFileId: '企业与用印授权证明', confirmedBy: '核验人员', sealId: '企业印章', policyId: '签署策略', policyCode: '策略编码', policyName: '策略名称', executionMode: '执行顺序', subjectType: '授权对象类型', subjectId: '授权对象', authorityType: '用印授权类型', requiresTwoPersonApproval: '双人复核', requesterId: '申请人员', approverId: '复核人员', sourcePdfHash: '冻结PDF内容哈希', slotCoordinates: 'PDF签署位置', planHash: '签署计划哈希', plan: '冻结签署计划', approvedAt: '复核通过时间', sourcePlanHash: '业务编译计划哈希', binding: '签署绑定信息', signerType: '签署方', signerRole: '签署职责', required: '是否必需', steps: '执行步骤', pageIndex: '页码索引', x: '横坐标', y: '纵坐标', width: '宽度', height: '高度' });
Object.assign(relations, { sealId: 'enterprise-seals', policyId: 'signature-policies' });
Object.assign(detailLabels, { renewal: '同任务重新授权来源', renewalEligibility: '重新授权资格', eligible: '符合重新授权条件', taskId: '原签署任务', priorApprovalId: '此前授权计划' });
Object.assign(relations, { priorApprovalId: 'esign-approvals' });
Object.assign(detailLabels, { currency: '币种', authorizationNote: '验收授权说明' });
Object.assign(detailLabels, { manualReviewRequired: '需人工核对', statusMessage: '可信渠道状态说明' });
Object.assign(detailLabels, { creditVerificationId: '绑定信用核验编号', creditRevision: '信用核验版本', creditRuleVersion: '押金规则版本', creditBand: '信用档位' });
Object.assign(detailLabels, { periodId: '所属订阅月', actualAt: '实际交接时间', startReadingKm: '本期起始仪表读数 / km', endReadingKm: '本期结束仪表读数 / km', startDate: '起算日期', endDate: '约定截止日期', effectiveEndDate: '实际截止日期', usedKm: '本期实际使用 / km', baseUsedKm: '扣减基础额度 / km', packUsedKm: '扣减已到账包 / km', excessKm: '核算超里程 / km', excessAmount: '核算超里程费', returnedOn: '实际归还日', unsettledPeriodIds: '待结月份', bills: '关联账单', disputeReason: '客户原争议', resolutionNote: '人工处理结论' });
Object.assign(relations, { periodId: 'usage-periods' });
Object.assign(detailLabels, { readingId: '月界仪表证据与审核', depositRefundRequiredAmount: '服务端核算应退押金', usagePolicy: '绑定的订阅使用规则', baseAllowanceKm: '每期基础公里数', excessPriceAmount: '超里程单价', documentVersion: '批准文案版本', hash: '文案哈希', rules: '使用规则快照', policyVersion: '规则版本' });
Object.assign(relations, { readingId: 'mileages' });
Object.assign(detailLabels, { evidenceFileIds: '费用证据附件', createdBy: '创建人员', reviewNote: '复核意见', reviewedAt: '复核时间', terminationFileId: '正式终止协议', cancellationReason: '取消原因', cancelledAt: '取消时间', previousHandoverId: '上一版交接单', resolutionNote: '异议处理说明', resolvedBy: '异议处理人员' });
Object.assign(relations, { previousHandoverId: 'handovers' });
Object.assign(detailLabels, commercialTermLabels, { commercialTerms: '逐单商业条款' });
Object.assign(detailLabels,{handoverId:'交接单',handoverArrangement:'已确认交还安排',draft:'现场草稿',place:'实际地点',accessories:'随车物品',condition:'车辆状况',batteryPercent:'电量（%）',openItems:'未结事项',resolutionPlan:'处理方案',contextChanged:'车辆批次已变化',canEdit:'可采集编辑',assignee:'现场人员',version:'任务版本',vehicleTitle:'任务车辆',customerName:'客户称呼',files:'现场附件',handover:'交接进度'});
Object.assign(relations,{handoverId:'handovers'});
Object.assign(detailLabels, { customerName: '客户姓名', vehicleTitle: '车辆', history: '历史记录', auditLogs: '操作审计', events: '业务事件', statusHistory: '状态历史', changeHistory: '变更历史', handoverProposal: '客户建议交接地点' });
export function DetailValues({ entity, resource, labels }: { entity: Record<string, unknown>; resource?: string; labels?:Record<string,string> }) {
return <dl className="detail-values">{Object.entries(entity).filter(([key, value]) => value != null && visibleBusinessField(key,resource)).map(([key, value]) => <div key={key} className={typeof value === 'object' || String(value).length > 75 ? 'full' : ''}><dt>{labels?.[key] ?? detailLabels[key] ?? key}</dt><dd>{relations[key] && typeof value === 'string' ? <a href={`#${relations[key]}?record=${encodeURIComponent(value)}&view=source`}>{value}<ArrowUpRight size={12}/></a> : key === 'creditBand' ? creditBandLabels[String(value)] ?? '未知信用档位' : key === 'manualReviewRequired' ? value === true ? '需人工核对' : '无需人工核对' : key === 'kind' ? value === 'SUBSCRIPTION' ? '订阅合同' : value === 'HANDOVER' ? '车辆交接单' : display(value) : key === 'status' ? <Status value={value} resource={resource}/> : /Amount$|^amount$/.test(key) ? money(value) : /At$|Date$/.test(key) ? date(value, /Date$/.test(key)) : /FileId$/.test(key) && typeof value === 'string' ? <a target="_blank" rel="noreferrer" href={api.fileUrl(value)}>查看附件 <ArrowUpRight size={13}/></a> : Array.isArray(value) ? <div className="detail-array">{value.map((item, index) => /fileIds$/i.test(key) && typeof item === 'string' ? <a key={index} target="_blank" rel="noreferrer" href={api.fileUrl(item)}>附件 {index + 1} <ArrowUpRight size={12}/></a> : typeof item === 'object' && item !== null ? <DetailValues key={index} entity={item as Record<string, unknown>} resource={resource} labels={labels}/> : <span key={index}>{display(item)}</span>)}</div> : typeof value === 'object' ? <DetailValues entity={value as Record<string, unknown>} resource={resource} labels={labels}/> : typeof value==='string'?<ProseText text={display(value)}/>:display(value)}</dd></div>)}</dl>;
}
