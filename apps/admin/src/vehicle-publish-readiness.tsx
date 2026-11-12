import {useCallback,useEffect,useRef,useState} from 'react';
import {api,can} from './core';
import {useCommandDisabled} from './domain-ui';
import {accessFailure,mediaError} from './vehicle-media';
import {checkPublishReadiness,publicationCheckHref,type PublicationScope,type PublishReadiness} from './vehicle-publish-readiness-model';
import './vehicle-publish-readiness.css';
type Props=PublicationScope&{active?:boolean;refreshKey?:number;compact?:boolean;onReady?:(ready:boolean)=>void};
export function VehiclePublishReadiness(props:Props){
 const session=api.session,signature=JSON.stringify([session?.user.id,session?.user.role,session?.user.permissions]),epoch=useRef({session,signature,value:0});if(epoch.current.session!==session||epoch.current.signature!==signature)epoch.current={session,signature,value:epoch.current.value+1};
 const allowed=['ADMIN','OPERATIONS'].includes(session?.user.role||'')&&can(session?.user.permissions||[],props.goodsId?'goods.read':'vehicles.read');
 useEffect(()=>{if(!allowed)props.onReady?.(false);},[allowed,props.onReady]);
 return allowed?<ReadinessBody key={`${props.vehicleId}:${props.goodsId||''}:${epoch.current.value}`} {...props}/>:null;
}
function ReadinessBody({vehicleId,vehicleRevision,goodsId,goodsRevision,active=true,refreshKey=0,compact=false,onReady}:Props){
 const blocked=useCommandDisabled(),permission=goodsId?'goods.read':'vehicles.read',path=goodsId?`/admin/goods/${encodeURIComponent(goodsId)}/publish-readiness`:`/admin/vehicles/${encodeURIComponent(vehicleId)}/publish-readiness`;
 const session=useRef(api.session),signature=useRef(JSON.stringify([api.session?.user.id,api.session?.user.role,api.session?.user.permissions])),alive=useRef(false),controller=useRef<AbortController|undefined>(undefined),sequence=useRef(0),availability=useRef({active,blocked}),notify=useRef(onReady);availability.current={active,blocked};notify.current=onReady;
 const[data,setData]=useState<PublishReadiness>(),[reading,setReading]=useState(false),[error,setError]=useState<unknown>(),[denied,setDenied]=useState(false);
 const current=useCallback(()=>alive.current&&session.current===api.session&&signature.current===JSON.stringify([api.session?.user.id,api.session?.user.role,api.session?.user.permissions])&&availability.current.active&&!availability.current.blocked,[]);
 const load=useCallback(async()=>{
  if(!current())return;const token=++sequence.current;controller.current?.abort();const requestController=new AbortController();controller.current=requestController;notify.current?.(false);setReading(true);setError(undefined);
  try{const value=checkPublishReadiness(await api.request<unknown>(path,{signal:requestController.signal,permission}),{vehicleId,vehicleRevision,goodsId,goodsRevision});if(!current()||requestController.signal.aborted||token!==sequence.current)return;setData(value);notify.current?.(value.ready);
  }catch(e){if(!alive.current||requestController.signal.aborted||token!==sequence.current)return;if(accessFailure(e)){setData(undefined);setDenied(true);notify.current?.(false);setError(e);}else if(current()){setError(e);notify.current?.(false);}}
  finally{if(alive.current&&token===sequence.current)setReading(false);}
 },[current,path,permission,vehicleId,vehicleRevision,goodsId,goodsRevision]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++;controller.current?.abort();notify.current?.(false);};},[]);
 useEffect(()=>{if(active&&!blocked)void load();else{sequence.current++;controller.current?.abort();setReading(false);notify.current?.(false);}return()=>{sequence.current++;controller.current?.abort();};},[load,active,blocked,refreshKey]);
 if(!active)return null;if(denied)return <p role="alert">发布条件访问权限已失效，请重新核对登录权限。</p>;
 const fresh=!!data&&!reading&&!error&&!blocked;
 return <section className={'vehicle-publish-readiness'+(compact?' vehicle-readiness-compact':'')} aria-label="发布条件"><header><div><h3>发布条件</h3><p>{blocked?'车辆资料正在核对，发布条件待重新确认。':reading?'正在核对发布条件…':fresh&&data.ready?'已具备发布条件':fresh?'请补全以下发布条件':'发布条件尚未确认。'}</p></div><button type="button" className="button" disabled={reading||blocked} onClick={()=>void load()}>{compact?'重新核对':'重新核对发布条件'}</button></header>
 {error?<p className="publication-read-error" role="alert">{mediaError(error)}</p>:null}{data?<><div className="publication-checks">{data.checks.map(check=><article key={check.key} data-publish-check={check.key} className={`publication-check ${!check.required?'optional':check.passed?'complete':'missing'}`}><div><strong>{check.label}</strong><span>{!check.required?'不适用':check.passed?'已完成':'待补全'}</span><a href={publicationCheckHref(vehicleId,check.targetView)} aria-label={'查看'+check.label}>{compact?'定位':'查看资料'}</a></div>{check.messages.length&&(!compact||!check.passed)?<ul>{check.messages.map((message,index)=><li key={index}>{message}</li>)}</ul>:null}</article>)}</div><p className="publication-date">按 {data.publicationDate}（上海）核对，提交商品上架时将再次检查当前资料。</p></>:null}
 </section>;
}
