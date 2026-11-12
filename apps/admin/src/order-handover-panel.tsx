import { useEffect, useState } from 'react';
import { api } from './core';
import { RecordForm } from './ui';
import { resourceWritable, resources } from './resources';
import { OrderRecordPanel, type OrderFocus } from './order-record-panel';
import type { OrderProcess } from './order-process';
export function OrderHandoverPanel({orderId,process,disabled,focus,refreshKey,after,renderValues}: {orderId:string;process:OrderProcess|null;disabled:boolean;focus?:OrderFocus;refreshKey:number;after:()=>Promise<void>;renderValues:(v:Record<string,unknown>)=>React.ReactNode}) {
  const [create,setCreate]=useState<'DELIVERY'|'RETURN'>(),[receipt,setReceipt]=useState(''),[readbackFailed,setReadbackFailed]=useState(false);
  const def=resources.find(r=>r.key==='handover-tasks')!,writable=resourceWritable(def,api.session?.user.permissions||[],api.session?.user.role);
  const actions=process?.steps.flatMap(s=>s.actions)||[];
  const allow=(type:string)=>!disabled&&writable&&actions.some(a=>a.key===`CREATE_${type}_TASK`&&a.enabled&&a.target?.orderId===orderId);
  useEffect(()=>{if(focus?.resource==='handover-tasks'&&focus.key?.startsWith('CREATE_'))setCreate(focus.key==='CREATE_RETURN_TASK'?'RETURN':'DELIVERY');},[focus?.sequence]);
  const selected=create;
  const submit=async(body:Record<string,unknown>)=>{
    if(!selected||!allow(selected))throw new Error('当前订单条件不允许新建此交接任务，请先完成上方待办');
    const payload={...body,orderId,type:selected};await api.request('/admin/handover-tasks',{method:'POST',body:payload,permission:'handover-tasks.write'});
    setCreate(undefined);setReceipt('现场任务已建立，现场人员可在公众号员工工作台采集；客户随后在小程序核对。');setReadbackFailed(false);
    try{await after();}catch{setReadbackFailed(true);}
  };
  return <><section className="order-related-panel"><h3>现场派单与交还手续</h3><p className="muted">运营派单 → 现场人员采集并发布 → 客户核对证据及本版约定 → 运营确认完成。历史纸质交接仍按原归档手续办理。</p><div className="order-inline-actions">{(['DELIVERY','RETURN'] as const).filter(allow).map(type=><button key={type} className="button primary" onClick={()=>setCreate(type)}>新增{type==='DELIVERY'?'交付':'还车'}现场任务</button>)}</div>{selected?<RecordForm key={selected} fields={def.fields!.filter(f=>!['orderId','type'].includes(f.key))} warning={`本任务固定关联当前订单，类型为${selected==='DELIVERY'?'交付':'还车'}；现场事实由实际人员办理。`} submitLabel="建立现场任务" onSubmit={submit} onCancel={()=>setCreate(undefined)} submitDisabled={!allow(selected)}/>:null}{receipt?<p role="status" className="order-operation-receipt">{receipt}{readbackFailed?'任务已提交，但最新进度读取失败。请刷新核对，勿重复提交。':''}</p>:null}</section>
    {['handover-tasks','handovers'].map(resource=><OrderRecordPanel key={resource} orderId={orderId} resource={resource} rows={(resource==='handovers'?process?.related.handovers:process?.related.tasks)||[]} process={process} disabled={disabled} focus={focus} refreshKey={refreshKey} after={after} renderValues={renderValues}/>)}</>;
}
