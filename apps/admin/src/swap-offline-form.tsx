import {useEffect,useRef,useState} from 'react';
import {api,money,type Entity} from './core';
import {ErrorNotice,Loading} from './ui';
import {SwapMutationForm,useSwapRead} from './swap-workspace';
import {frozenSwapTarget,offlineSwapDraft,offlineSwapPreviewPayload,offlineSwapPreviewSafe,offlineSwapQuotePayload,offlineSwapTextFields,swapTargetSafe,type SwapTarget} from './swap-offline-model';
import type {SwapContext} from './swap';
type Data=Record<string,any>;
export function SwapOfflineQuoteForm({detail,context,disabled=false,onSaved,reload,onCancel,onFrozenChange}:{detail:Entity;context:SwapContext;disabled?:boolean;onSaved:()=>Promise<void>;reload:()=>Promise<unknown>;onCancel:()=>void;onFrozenChange:(value:boolean)=>void}){
 const [draft,setDraft]=useState(()=>offlineSwapDraft(detail,context)),[target,setTarget]=useState<SwapTarget|undefined>(()=>frozenSwapTarget(detail)),[keyword,setKeyword]=useState(''),[page,setPage]=useState(1),[seen,setSeen]=useState<{input:Data;preview:Data}>(),[error,setError]=useState<unknown>(),[previewing,setPreviewing]=useState(false),[checked,setChecked]=useState(false);
 const q=detail.quote as Data|undefined,returned=detail.returnHandover as Data|undefined,fixed=!!q?.previousPreparedQuoteId||['AWAITING_FINANCE','SWAP_RETURNED'].includes(String(detail.status)),read=useSwapRead<Data>(fixed?'':`/admin/order-changes/${encodeURIComponent(detail.id)}/offline/targets?keyword=${encodeURIComponent(keyword)}&page=${page}&pageSize=20`),generation=useRef(0),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
 useEffect(()=>{generation.current++;setSeen(undefined);setChecked(false);},[detail.revision]);
 const invalidate=()=>{generation.current++;setSeen(undefined);setChecked(false);setPreviewing(false);};
 const change=(key:string,value:string)=>{invalidate();setDraft(old=>({...old,[key]:value}));};
 const preview=async()=>{
  if(disabled||previewing)return;setError(undefined);const token=++generation.current,session=api.session;
  try{const input=offlineSwapPreviewPayload(detail,draft,target);setPreviewing(true);const raw=await api.request(`/admin/order-changes/${encodeURIComponent(detail.id)}/offline/quote-preview`,{method:'POST',permission:'order-changes.write',body:input});const value=offlineSwapPreviewSafe(raw,detail,input);if(alive.current&&token===generation.current&&session===api.session){setSeen({input,preview:value});setChecked(false);}}
  catch(e){if(alive.current&&token===generation.current&&session===api.session){setSeen(undefined);setError(e);}}
  finally{if(alive.current&&token===generation.current)setPreviewing(false);}
 };
 const selection=()=>{try{return(read.data?.items||[]).map(swapTargetSafe) as SwapTarget[];}catch(e){return e;}};
 const options=selection(),view=seen?.preview;
 return <SwapMutationForm path={`/admin/order-changes/${encodeURIComponent(detail.id)}/offline/quotes`} disabled={disabled||previewing} after={onSaved} reload={async()=>{invalidate();return reload();}} onFrozenChange={onFrozenChange} build={()=>{if(!seen||!checked)throw Error('请先预览并核对本次自动报价');return offlineSwapQuotePayload(offlineSwapPreviewPayload(detail,draft,target),seen,crypto.randomUUID());}}>
 {submit=><form className="swap-offline-form" onSubmit={e=>{e.preventDefault();void submit({}).catch(setError);}}>
  <h3>自动报价预览</h3><p>选择真实目标商品，按原服务月自动计算同价或升级差额。原租期、里程规则和赠送约定保持；商品所列租期不延长本订单。</p>
  {fixed?<p className="action-warning">本次重新核对实际日期，原目标商品及押金固定；已完成旧车归还时间保持。</p>:<section className="esign-card"><label>搜索目标商品<input aria-label="搜索目标商品" value={keyword} onChange={e=>{setKeyword(e.target.value);setPage(1);}} placeholder="车名、VIN、牌号或产品名称"/></label>
   {read.error?<ErrorNotice error={read.error} retry={()=>void read.reload().catch(setError)}/>:null}{read.loading?<Loading label="正在读取真实商品"/>:null}
   {!Array.isArray(options)?<ErrorNotice error={options}/>:options.map(row=><button type="button" className={`swap-target-card ${target?.targetListingId===row.targetListingId?'selected':''}`} key={row.targetListingId} disabled={read.disabled} onClick={()=>{invalidate();setTarget(row);}}><strong>{row.vehicle.title} · {row.vehicle.plateNumber||'牌号未登记'}</strong><span>VIN {row.vehicle.vin||'未登记'}</span><span>{row.product.name} · 产品版本 {row.product.version} · 月费 {money(row.product.monthlyFeeAmount)}</span></button>)}
   {Array.isArray(options)&&!options.length&&!read.loading&&!read.error?<p>没有匹配商品，请调整搜索。列表不代表已通过本次换车全部条件。</p>:null}
   <div className="table-pagination"><span>共 {read.data?.total??'—'} 个商品 · 第 {page} 页</span><button type="button" className="button" disabled={read.loading||page===1} onClick={()=>setPage(p=>p-1)}>商品上一页</button><button type="button" className="button" disabled={read.loading||!read.data||page*20>=read.data.total} onClick={()=>setPage(p=>p+1)}>商品下一页</button></div>
  </section>}
  {target?<p className="action-warning">本次目标：{target.vehicle.title} · VIN {target.vehicle.vin||'未登记'} · {target.product.name}（版本 {target.product.version}）。实际可用及同一出租方将由预览核验。</p>:null}
  <div className="asset-fields">{[['plannedReturnAt','预计旧车交还时间（北京时间）'],['plannedDeliveryAt','预计新车交付时间（北京时间）'],['expiresAt','客户确认截止时间（北京时间）']].map(([key,label])=><label key={key}><span>{label}</span><input type="datetime-local" aria-label={label} required value={draft[key]} readOnly={key==='plannedReturnAt'&&returned?.status==='COMPLETED'} onChange={e=>change(key,e.target.value)}/></label>)}<label><span>本次约定押金（元）</span><input aria-label="本次约定押金（元）" inputMode="decimal" required readOnly={fixed} value={draft.depositAmount} onChange={e=>change('depositAmount',e.target.value)}/><small>补收或原路退款以真实净实收为准。</small></label>
  {offlineSwapTextFields.map(([key,label])=><label className="asset-wide" key={key}><span>{label}</span><textarea aria-label={label} required maxLength={500} value={draft[key]} onChange={e=>change(key,e.target.value)}/></label>)}</div>
  <p>本入口仅处理可追溯的正常补退，不包含额外赔付；有额外赔付事项请先交人工财务核对。</p>
  {error?<><ErrorNotice error={error}/><button type="button" className="button" onClick={()=>void reload().then(()=>{invalidate();setError(undefined);}).catch(setError)}>重新读取报价来源</button></>:null}
  <button type="button" className="button" disabled={disabled||previewing||!target} onClick={()=>void preview()}>{previewing?'正在核对…':'读取自动报价预览'}</button>
  {view?<section className="esign-card"><h4>已核对的自动报价</h4><p>当前月费 {money(view.currentMonthlyFeeAmount)} → 目标月费 {money(view.targetMonthlyFeeAmount)}；押金应补 {money(view.depositChargeAmount)} / 应退 {money(view.depositRefundAmount)}。</p><p>交还旧车前核清本次款项，未来月份按原到期日主动支付。</p><div className="table-scroll"><table><thead><tr><th>服务月</th><th>原应收</th><th>本次差额</th><th>新应收</th><th>应补 / 应退</th></tr></thead><tbody>{view.periods.map((row:Data)=><tr key={row.sequence}><td>全单第 {row.sequence} 期{row.stageSequence?<small>本段第 {row.stageSequence} 期</small>:null}<small>{row.startDate} 至 {row.endDate}（末日不含）</small><small>付款日 {row.dueDate}</small></td><td>{money(row.originalAmount)}</td><td>{money(row.differenceAmount)}</td><td>{money(row.amount)}</td><td>{money(row.chargeAmount)} / {money(row.refundAmount)}</td></tr>)}</tbody></table></div><label className="confirmation-check"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>我已核对目标商品、自动逐期差额、押金及本次责任安排</label></section>:null}
  <footer className="asset-form-actions"><button type="button" className="button" onClick={onCancel}>取消</button><button type="submit" className="button primary" disabled={!seen||!checked||previewing}>保存换车报价版本</button></footer>
 </form>}
 </SwapMutationForm>;
}
