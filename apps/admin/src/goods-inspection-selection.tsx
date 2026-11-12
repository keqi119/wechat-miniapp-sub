import {useRef,useState} from 'react';
import {api,ApiError} from './core';
import {useCommandDisabled} from './domain-ui';
import type {Goods} from './goods-model';
import {MediaScope,accessFailure,checkInspections,definiteFailure,mediaError,mediaPath,mediaWritable,useMediaResource,type InspectionList} from './vehicle-media';

export function GoodsInspectionSelection({record,onUpdated}:{record:Goods;onUpdated:(record:Goods)=>void}){return <MediaScope vehicleId={record.vehicleId} privateLabel="车况查验资料"><Selection key={record.id} record={record} onUpdated={onUpdated}/></MediaScope>;}
function Selection({record,onUpdated}:{record:Goods;onUpdated:(record:Goods)=>void}){
 const boundary=useCommandDisabled(),r=useMediaResource<InspectionList>(mediaPath(record.vehicleId)+'/inspections',value=>checkInspections(value,record.vehicleId));
 const[selected,setSelected]=useState((record.inspectionSelections||[]).map(x=>x.id)),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[phase,setPhase]=useState<'ready'|'retry'|'conflict'>('ready'),[notice,setNotice]=useState('');
 const pending=useRef<Record<string,unknown>|undefined>(undefined),running=useRef(false),latest=useRef(record);latest.current=record;
 const save=async()=>{if(running.current||boundary||!mediaWritable('goods.write')||r.failed||r.reading||phase==='conflict')return;running.current=true;setBusy(true);setError(undefined);setNotice('');try{
  if(!pending.current){if(selected.length>20)throw new Error('每个商品最多选择 20 条查验记录。');const inspectionSelections=selected.map(id=>{const source=r.data?.items.find(x=>x.id===id);if(!source)throw new Error('部分来源不可读，请取消对应选择或刷新查验记录。');return{id,revision:source.revision};});pending.current={revision:record.revision,idempotencyKey:crypto.randomUUID(),inspectionSelections};}
  const body=pending.current,value=await api.request<Goods>('/admin/goods/'+encodeURIComponent(record.id),{method:'PATCH',body,signal:r.controller.current.signal,permission:'goods.write'});
  if(!r.current())return;
  if(value.id!==record.id||value.vehicleId!==record.vehicleId||value.revision!==Number(body.revision)+1||JSON.stringify(value.inspectionSelections)!==JSON.stringify(body.inspectionSelections)||!Array.isArray(value.inspectionSnapshots))throw new ApiError('商品查验展示回执不完整，请核对原请求结果',0,'INVALID_RESPONSE');
  pending.current=undefined;setPhase('ready');setNotice('查验展示已保存。');onUpdated(value);
 }catch(e){if(accessFailure(e)){r.failure(e);return;}if(r.current()){setError(e);if(definiteFailure(e)){pending.current=undefined;setPhase('conflict');}else if(pending.current)setPhase('retry');}}finally{running.current=false;if(r.current())setBusy(false);}};
 const locked=boundary||!mediaWritable('goods.write')||busy||r.reading||r.failed||phase!=='ready',items=r.data?.items||[],missing=selected.filter(id=>!items.some(x=>x.id===id));
 if(r.denied)return <p role="alert">查验资料访问权限已失效。</p>;
 return <section className="goods-inspection-selection" aria-label="商品查验展示"><h3>本商品的查验展示</h3><p className="vehicle-media-hint">勾选 0 至 20 条，保存时冻结当前内容。源报告后续修改不自动更新本商品；取消全部选择并保存可关闭展示。</p>
 <details><summary>当前已保存 {record.inspectionSnapshots?.length||0} 条</summary>{record.inspectionSnapshots?.map(snapshot=><div key={snapshot.sourceId}><strong>{snapshot.title}</strong><p className="vehicle-inspection-description">{snapshot.description}</p><small>保存的来源版本 {snapshot.sourceRevision} · {snapshot.images?.length||0} 张图片</small></div>)}</details>
 {r.error?<p role="alert">{mediaError(r.error)}</p>:null}{error?<p role="alert">{mediaError(error)}</p>:null}{notice?<p role="status">{notice}</p>:null}
 {items.map(source=><label className="goods-inspection-choice" key={source.id}><input aria-label={'选择 '+source.title} type="checkbox" checked={selected.includes(source.id)} disabled={locked||!selected.includes(source.id)&&selected.length>=20} onChange={e=>{setSelected(e.target.checked?[...selected,source.id]:selected.filter(id=>id!==source.id));setNotice('');}}/><span><strong>{source.title}</strong><small>{source.provider||'未填写检测机构'} · {source.inspectedAt||'未填写检测日期'} · 来源版本 {source.revision}{record.inspectionSelections?.some(x=>x.id===source.id&&x.revision!==source.revision)?' · 来源已更新，保存后才替换旧快照':''}</small></span></label>)}
 {missing.map(id=><label key={id}><input type="checkbox" checked disabled={locked} onChange={()=>setSelected(selected.filter(x=>x!==id))}/>不可读的已选记录（可取消）</label>)}{!r.reading&&!items.length?<p className="vehicle-media-hint">本车暂无可选查验记录。</p>:null}
 {phase==='conflict'?<p role="status">商品或查验来源版本已变化，请刷新商品详情后重新核对选择。</p>:null}
 <div className="vehicle-media-actions"><button type="button" className="button" disabled={busy||r.reading||phase==='retry'} onClick={()=>void r.load().catch(()=>{})}>刷新可选查验</button><button type="button" className="button primary" disabled={boundary||!mediaWritable('goods.write')||busy||r.reading||r.failed||phase==='conflict'} onClick={()=>void save()}>{busy?'正在保存…':phase==='retry'?'按原请求重试查验展示':'保存查验展示'}</button></div></section>;
}
