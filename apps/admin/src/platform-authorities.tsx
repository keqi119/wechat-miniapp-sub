import {useState} from 'react';
import {api} from './core';
import {Command,Facts,endpoint,type Row} from './domain-ui';
import {ErrorNotice} from './ui';

export function PlatformAuthorities({ownerId,data,after}:{ownerId:string;data:Row;after:()=>void}){
 const [error,setError]=useState<unknown>(),[busy,setBusy]=useState(false);
 const base=`/admin/vehicle-owners/${encodeURIComponent(ownerId)}/authorities`;
 async function refresh(id:string){if(busy)return;setBusy(true);setError(undefined);try{await api.request(`${base}/${id}/refresh-platform-scope`,{method:'POST',permission:'vehicle-owners.write',body:{}});after();}catch(e){setError(e);}finally{setBusy(false);}}
 return <section>
  <p className="muted">企业本人在原合作商 H5 签署法大大授权书；受托方为上海晓浪网络科技有限公司。原合作业务约定继续有效。</p>
  {!data.executionEnabled?<p>授权可办理，平台自动签执行尚未开放。</p>:null}
  {error?<ErrorNotice error={error}/>:null}
  {!data.items?.length?<p>尚未办理本企业自动签授权。</p>:null}
  {(data.items||[]).map((r:Row)=>{const terminal=['REVOKED','SUPERSEDED','INVALIDATED'].includes(r.status),label=r.status==='REVOKED'?'已取消授权':terminal?'授权已失效':r.status==='REVOKING'?'取消授权处理中':r.pausedAt?'自动签已暂停':r.enabled?'已授权':r.scopeReviewStatus==='PENDING'&&r.document?.signedAvailable?'授权范围待核验':r.status==='UNKNOWN'?'授权状态待核对':'待完成授权';
   return <article className="partner-source-record" key={r.id}><h4>{label}</h4><Facts items={[["签署时间",r.signedAt,'date'],["渠道核验时间",r.checkedAt,'date']]}/>
    <div className="domain-actions">{r.document?.signedAvailable?<a className="button" href={endpoint(`${base}/${r.id}/platform-document`)} target="_blank" rel="noreferrer">阅读签后授权全文</a>:null}<button type="button" className="button" disabled={busy} onClick={()=>void refresh(r.id)}>状态刷新</button></div>
    {r.status==='AUTHORIZED'&&r.scopeReviewStatus==='PENDING'&&r.document?.signedAvailable&&api.session?.user.role==='ADMIN'?<Command label="核验授权全文" submitLabel="确认核验" presentation="drawer" permission="vehicle-owners.write" path={`${base}/${r.id}/review-platform-scope`} revision={r.revision} fields={[{key:'accepted',label:'已阅读本次签后完整授权书',kind:'check',required:true},{key:'platformContracts',label:'正文支持本企业参与的平台合同自动签署',kind:'check',required:true},{key:'dualRepresentation',label:'正文支持受托方为合同双方企业办理签章',kind:'check',required:true}]} build={v=>({...v,signedSha256:r.document.signedPdfHash,granteeName:'上海晓浪网络科技有限公司'})} after={after} note="核对实际渠道全文后记录结论；如正文不支持本次范围，保留待核验状态。此操作不修改业务合同。"/>:null}
    {r.enabled?<Command label="暂停自动签" path={`${base}/${r.id}/pause`} permission="vehicle-owners.write" after={after}/>:null}
   </article>;
  })}
 </section>;
}
