import { useEffect, useRef, useState } from 'react';
import { api, can, type Entity } from './core';
import { ArchiveDetail } from './contract-center';
import { Command, write } from './domain-ui';
import { ErrorNotice, Loading } from './ui';
import { scopedRecord, processActions, type OrderProcess } from './order-process';
import type { OrderFocus } from './order-record-panel';
const labels:Record<string,string>={RENTAL:'租赁合同',DELIVERY_RECEIPT:'交车单',RETURN_RECEIPT:'还车单',TERMINATION:'终止协议'};
export function OrderContractPanel({ orderId, process, disabled, focus, refreshKey, after }: {orderId:string;process:OrderProcess|null;disabled:boolean;focus?:OrderFocus;refreshKey:number;after:()=>Promise<void>}) {
  const [selected,setSelected]=useState<string>(),[detail,setDetail]=useState<Entity>(),[error,setError]=useState<unknown>(),[loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0),[receipt,setReceipt]=useState('');
  const generation=useRef(0),archives=process?.related.archives||[],allowed=can(api.session?.user.permissions||[],'offline-archives.read');
  const creates=(process?processActions(process):[]).filter(a=>a.key==='CREATE_ARCHIVE'&&a.target?.orderId===orderId&&a.enabled&&labels[a.target?.section||'']);
  const createKey=(a:typeof creates[number])=>`create:${a.target!.section}:${a.target!.id||orderId}`;
  const keys=[...archives.map(row=>row.id),...(write('offline-archives')?creates.map(createKey):[])],selectionKey=keys.join('|');
  useEffect(()=>{if(!selected||!keys.includes(selected))setSelected(keys[0]);},[selectionKey,selected]);
  useEffect(()=>{if(focus?.resource!=='offline-archives')return;if(focus.key==='CREATE_ARCHIVE'){const item=creates.find(a=>a.target?.section===focus.section);if(item)setSelected(createKey(item));}else if(archives.some(row=>row.id===focus.id))setSelected(focus.id);},[focus?.sequence,selectionKey]);
  useEffect(()=>{if(!selected||!allowed||!archives.some(row=>row.id===selected)){setDetail(undefined);setError(undefined);setLoading(false);return;}const g=++generation.current,controller=new AbortController();setLoading(true);setError(undefined);
    api.request<Entity>(`/admin/offline-archives/${encodeURIComponent(selected)}`,{signal:controller.signal}).then(value=>{if(g!==generation.current)return;const row=scopedRecord(value,orderId);if(!row||row.id!==selected)throw new Error('档案不属于当前订单，请刷新核对');setDetail(row);}).catch(e=>{if(g===generation.current&&e.name!=='AbortError')setError(e);}).finally(()=>{if(g===generation.current)setLoading(false);});return()=>{generation.current++;controller.abort();};
  },[orderId,selected,allowed,refresh,refreshKey]);
  if(!allowed)return <p className="muted">当前岗位没有合同档案读取权限。</p>;
  const reload=async()=>{await after();setRefresh(v=>v+1);};
  const creating=creates.find(a=>createKey(a)===selected);
  return <section className="order-related-panel" aria-label="本单合同档案">
    <label className="contract-document-picker">本单合同<select aria-label="选择本单合同" value={selected||''} onChange={event=>setSelected(event.target.value)} disabled={!keys.length}>{!keys.length?<option value="">暂无合同</option>:null}{archives.map(row=><option key={row.id} value={row.id}>{labels[String(row.kind)]||'线下档案'} · {row.id}</option>)}{write('offline-archives')?creates.map(a=><option key={createKey(a)} value={createKey(a)}>建立{labels[a.target!.section!]}档案</option>):null}</select></label>
    {receipt?<p className="order-operation-receipt" role="status">{receipt}</p>:null}
    {creating&&write('offline-archives')?(()=>{const kind=creating.target!.section!,subjectId=creating.target!.id||orderId;if(['DELIVERY_RECEIPT','RETURN_RECEIPT'].includes(kind)&&!process?.related.handovers.some(row=>row.id===subjectId))return null;return <div className="order-inline-create"><p className="muted">选择已启用模板后，按本单交易条件生成、预览打印、上传审核并归档。</p><Command key={selected} label={`建立${labels[kind]}档案`} path="/admin/offline-archives" revision={0} disabled={disabled} fields={[{key:'templateId',label:`已启用${labels[kind]}模板`,source:`/admin/legal-documents?type=OFFLINE_${kind}`,sourceKind:'published-document',required:true}]} build={v=>({kind,subjectType:['RENTAL','TERMINATION'].includes(kind)?'ORDER':'HANDOVER',subjectId,templateId:v.templateId})} permission="offline-archives.write" after={reload} onCommitted={()=>setReceipt(`${labels[kind]}档案已建立，请继续办理。`)}/></div>;})():null}
    {!keys.length?<p className="muted">本单暂无可办理的合同档案，请核对当前流程条件。</p>:null}
    {loading?<Loading label="正在读取本单档案"/>:null}{error?<ErrorNotice error={error} retry={()=>setRefresh(v=>v+1)}/>:null}
    {detail&&detail.id===selected?<ArchiveDetail row={detail} reload={reload} disabled={disabled||loading||!!error} onCommitted={setReceipt}/>:null}
  </section>;
}
