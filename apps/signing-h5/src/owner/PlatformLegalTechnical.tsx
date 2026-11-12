import {useCallback,useEffect,useRef,useState} from 'react';
import {Modal} from './Common';
import {LegalPdfReader} from './LegalPdfReader';
import type {LegalClient} from './legal-client';
import type {OwnerDetail} from './model';
import {dateTime} from './model';
import {platformAuthorityState,canRequestPlatformAuthority} from './platform-authority';
import type {PlatformAuthority} from './platform-authority';

type Options={scopeVersion:3;authorizationMethod:string;scope:Record<string,unknown>;grantee:{name:string}};
export function PlatformLegalTechnical({api,detail,busy,onAction,onExpired}:{api:LegalClient;detail:OwnerDetail;busy:boolean;onAction:(p:string,b:unknown)=>Promise<void>;onExpired?:()=>void}){
 const [records,setRecords]=useState<PlatformAuthority[]>([]),[options,setOptions]=useState<Options|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[preview,setPreview]=useState<PlatformAuthority|null>(null),[cancel,setCancel]=useState<PlatformAuthority|null>(null),[reason,setReason]=useState('');
 const key=useRef(crypto.randomUUID()),submitting=useRef(false),base=`/owners/${detail.id}/authorities`;
 const closePreview=useCallback(()=>setPreview(null),[]),closeCancel=useCallback(()=>{setCancel(null);setReason('');},[]);
 useEffect(()=>{let active=true;void Promise.all([api.request<PlatformAuthority[]>(base),api.request<Options>(`/owners/${detail.id}/authority-options`)]).then(([items,scope])=>{if(active){setRecords(items);setOptions(scope);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[api,base,detail.id]);
 async function apply(){if(!options||busy||submitting.current)return;submitting.current=true;try{await onAction(base,{scope:options.scope,sealId:detail.seals.find(s=>s.status==='ACTIVE')?.id,accepted:true,idempotencyKey:key.current});}finally{submitting.current=false;}}
 async function revoke(){if(!cancel||reason.trim().length<2||busy||submitting.current)return;const value={reason:reason.trim(),revision:cancel.revision},path=`${base}/${cancel.id}/revoke`;submitting.current=true;closeCancel();try{await onAction(path,value);}finally{submitting.current=false;}}
 return <section className="state-card">
  <h2>企业自动签授权</h2>
  <p>受托方：{options?.grantee.name||'上海晓浪网络科技有限公司'}</p>
  <p>订单相关合同由客户逐份签署、合作商与宁达自动签署；合作协议由合作商逐份签署、宁达自动签署。原合作协议的业务约定继续有效。</p>
  {error&&<p role="alert">{error}</p>}
  {loading&&<p role="status">正在读取授权记录…</p>}
  {!detail.autoSigningExecutionEnabled&&<p className="partner-note">可先办理授权，平台自动签执行尚未开放。</p>}
  {records.map(a=>{const state=platformAuthorityState(a);return <article className="legal-task-detail" key={a.id}>
   <div className="legal-document-heading"><h3>{a.scope?.version===3?'企业自动签授权书':'历史用印授权'}</h3><span className="legal-document-state">{state.label}</span></div>
   {a.signedAt&&<p className="legal-detail-hint">签署完成 {dateTime(a.signedAt)}</p>}
   {a.scope?.version===3&&<div className="legal-document-actions">
    {a.document?.signedAvailable&&<button type="button" className="secondary" disabled={busy} onClick={()=>setPreview(a)}>查看授权文件</button>}
    <button type="button" className="secondary" disabled={busy} onClick={()=>void onAction(`${base}/${a.id}/refresh`,{})}>状态刷新</button>
    {state.canContinue&&<button type="button" className="primary" disabled={busy||!detail.readyForSigning} onClick={()=>void onAction(`${base}/${a.id}/resume`,{})}>继续办理授权</button>}
    {a.enabled&&<button type="button" className="secondary" disabled={busy} onClick={()=>void onAction(`${base}/${a.id}/switch`,{enabled:false,revision:a.revision,scopeHash:a.scopeHash})}>暂停自动签</button>}
    {state.canResume&&<button type="button" className="secondary" disabled={busy||!detail.readyForSigning} onClick={()=>void onAction(`${base}/${a.id}/switch`,{enabled:true,revision:a.revision,scopeHash:a.scopeHash})}>恢复自动签</button>}
    {state.canRevoke&&<button type="button" className="text-button danger" disabled={busy} onClick={()=>{setReason('');setCancel(a);}}>{a.status==='REVOKING'?'继续取消授权':'取消自动签授权'}</button>}
   </div>}
  </article>;})}
  {!loading&&options&&canRequestPlatformAuthority(records)&&<button type="button" className="primary" disabled={busy||!detail.capabilities.canRequestAuthority} onClick={()=>void apply()}>本人办理自动签授权</button>}
  {!loading&&!detail.readyForSigning&&<p className="partner-note">请在“实名与印章”中刷新企业及证书状态，确认已选用印章后办理。</p>}
  {preview&&<LegalPdfReader key={preview.id} api={api} path={`${base}/${preview.id}/document/signed`} title="企业自动签授权书" variant="signed" onClose={closePreview} onReady={()=>{}} onExpired={()=>{closePreview();if(onExpired)onExpired();else setError('登录已过期，请重新登录企业服务。');}}/>}
  {cancel&&<Modal label="取消自动签授权" close={closeCancel} closeLabel="关闭取消授权"><p>确认后将先停止本平台的新自动签，再前往法大大完成取消。已有签署文件继续保留。</p><label className="field">取消原因<textarea autoFocus value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000}/></label><div className="legal-document-actions"><button type="button" className="secondary" onClick={closeCancel}>暂不取消</button><button type="button" className="primary" disabled={busy||reason.trim().length<2} onClick={()=>void revoke()}>确认取消授权</button></div></Modal>}
 </section>;
}
