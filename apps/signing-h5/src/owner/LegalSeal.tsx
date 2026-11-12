import {useEffect,useState} from 'react';
import type {LegalClient} from './legal-client';
import type {Seal} from './model';

// Parent key binds the image, load acknowledgement and action to owner/session/hash.
export function LegalSeal({api,ownerId,seal,canSelect,busy,onSelect}:{api:LegalClient;ownerId:string;seal:Seal;canSelect:boolean;busy:boolean;onSelect:()=>void}){
 const [image,setImage]=useState(''),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let current=true;setImage('');setLoaded(false);setError('');
  void api.request<{imageBase64:string;imageType:string}>(`/owners/${ownerId}/seals/${seal.id}/image`).then(v=>{if(current){if(!['image/png','image/jpeg','image/gif','image/webp'].includes(v.imageType)||!v.imageBase64)throw Error('印章图片格式不可用，请更新查询');setImage(`data:${v.imageType};base64,${v.imageBase64}`);}}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};
 },[api,ownerId,seal.id,seal.imageHash,retry]);
 return <article className="seal-card"><h3>{seal.status==='ACTIVE'?'印章已启用':'待确认企业印章'}</h3>
 {error?<><p role="alert">{error}</p><button className="secondary" onClick={()=>setRetry(v=>v+1)}>重试印章预览</button></>:image?<img className="seal-preview" alt="企业印章预览" src={image} onLoad={()=>setLoaded(true)} onError={()=>{setLoaded(false);setError('印章图片无法显示');}}/>:<p role="status">正在读取受保护印章…</p>}
 {seal.status!=='ACTIVE'&&loaded&&canSelect&&!!seal.imageHash&&<><p>请核对上方印模，确认后用于本企业签署。</p><button className="primary" disabled={busy} onClick={onSelect}>确认使用此印章</button></>}
 {seal.status!=='ACTIVE'&&!canSelect&&<p>请先查询更新企业与证书状态，再确认选章。</p>}
 </article>;
}
