import {useEffect,useState} from 'react';
import {api} from './core';
import {Command,CommandBoundary,type Row} from './domain-ui';
import {ErrorNotice,Loading} from './ui';
import {CustomerQualificationPanel} from './customer-risk';
import {CustomerProfilePanel} from './customer-profile';

export function OrderQualificationPanel(props:{orderId:string;refreshKey?:unknown;disabled?:boolean;after:()=>void|Promise<void>}){
 return <OrderQualificationContent key={`${props.orderId}:${api.session?.user.id}`} {...props}/>;
}
function OrderQualificationContent({orderId,refreshKey,disabled=false,after}:{orderId:string;refreshKey?:unknown;disabled?:boolean;after:()=>void|Promise<void>}){
 const session=api.session,path=`/admin/orders/${encodeURIComponent(orderId)}/qualification-continuity`;
 const [refresh,setRefresh]=useState(0),[data,setData]=useState<{context:Row;qualification:Row}>(),[loading,setLoading]=useState(true),[error,setError]=useState<unknown>();
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError(undefined);
  (async()=>{const context=await api.request<Row>(path,{signal:controller.signal});if(context.orderId!==orderId||!context.customerId)throw Error('返回资料不属于本单，请刷新核对');
   const qualification=await api.request<Row>(`/admin/customers/${encodeURIComponent(context.customerId)}/qualifications`,{signal:controller.signal});if(qualification.customerId!==context.customerId)throw Error('客户资格与本单不匹配，请刷新核对');
   if(!controller.signal.aborted&&session===api.session)setData({context,qualification});
  })().catch(e=>{if(!controller.signal.aborted)setError(e);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
 },[path,orderId,session,refreshKey,refresh]);
 const reload=()=>setRefresh(v=>v+1),saved=async()=>{reload();await after();},blocked=disabled||loading||!!error;
 const context=data?.context;
 return <CommandBoundary disabled={blocked} readVersion={refresh}><section className="domain-section" aria-label="本单资格核对">
  <div className="customer-dossier-heading"><div><h3>本单资格核对</h3><p>对照原签约资料核对当前证件，保留原合同及原审核记录。</p></div><button className="button" onClick={reload} disabled={loading}>刷新本单资格</button></div>
  {error?<ErrorNotice error={error} retry={reload}/>:loading?<Loading label="正在核对本单资格"/>:null}
  {context?<><p role="status">{context.ready?'本单资格已满足':'本单资格待核对'}</p>{(context.messages||[]).map((message:string)=><p className="customer-evidence-notice" key={message}>{message}</p>)}
   {context.confirmation?<p>核对记录：{context.confirmation.reason}</p>:null}
   {context.canConfirm?<Command key={`${context.qualificationId}:${context.profileHash}:${context.originalScopeHash}:${context.revision}`} label="核对本单更新证件" submitLabel="保存本单核对" path={path} permission="customers.write" revision={context.revision} disabled={blocked} fields={[{key:'sameCustomerConfirmed',label:'已对照原签约资料与当前两证，确认仍为同一承租人',kind:'check',required:true},{key:'reason',label:'核对说明',kind:'textarea',required:true,hint:'请说明更换照片或更新证件的核对情况（2～500字）。'}]} build={v=>{const reason=String(v.reason||'').trim();if(reason.length<2||reason.length>500)throw Error('核对说明须为2～500字');return{...v,reason,qualificationId:context.qualificationId,qualificationRevision:context.qualificationRevision,profileHash:context.profileHash,originalScopeHash:context.originalScopeHash};}} after={saved}/>:null}
  </>:null}
 </section>{data?<CustomerQualificationPanel customerId={data.context.customerId} controlled={{data:data.qualification,loading:blocked,error}} after={()=>void saved()} showSubmit={false}/>:null}
 <CustomerProfilePanel resource="orders" recordId={orderId} refreshKey={data} disabled={blocked} onQualificationSaved={()=>void saved()}/>
 </CommandBoundary>;
}
