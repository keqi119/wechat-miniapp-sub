import {useEffect,useState} from 'react';
import {api,money} from './core';
import {endpoint} from './domain-ui';
import {assetSessionKey} from './asset-shared';
import {assetLabels,type AssetFile} from './asset-model';
import {ErrorNotice,Loading} from './ui';

type Source={id:string;vehicleId:string;workOrderId:string;status:string;amount:number;category:string;occurredOn:string;supplierName:string;referenceNo:string;reason:string;sourceHash:string;files:AssetFile[]};
export function WorkCostSource({id,vehicleId,sourceHash,refreshKey}:{id:string;vehicleId:string;sourceHash:string;refreshKey:number}){
 const sessionKey=assetSessionKey(),allowed=['ADMIN','FINANCE'].includes(api.session?.user.role||'')&&api.session?.user.permissions.some(p=>p==='*'||p==='asset-work-order-cost-lines.read');
 const[row,setRow]=useState<Source>(),[error,setError]=useState<unknown>(),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setRow(undefined);setError(undefined);if(!allowed||!id)return;void api.request<Source>('/admin/asset-work-order-cost-lines/'+encodeURIComponent(id),{permission:'asset-work-order-cost-lines.read'}).then(value=>{if(value.id!==id||value.vehicleId!==vehicleId||value.sourceHash!==sourceHash||value.status!=='FROZEN'||!value.workOrderId)throw Error('费用来源与当前成本不一致，请重新核对');if(active)setRow(value);}).catch(e=>{if(active)setError(e);});return()=>{active=false;};},[id,vehicleId,sourceHash,refreshKey,sessionKey,retry,allowed]);
 if(!allowed)return <p>当前账号没有工单费用来源读取权限。</p>;
 return <section className="asset-section"><h3>冻结的工单费用来源</h3>{error?<ErrorNotice error={error} retry={()=>setRetry(v=>v+1)}/>:!row?<Loading/>:<><p><a href={'#work-order-costs?record='+encodeURIComponent(row.workOrderId)}>查看本工单财务资料</a></p><dl className="asset-facts"><div><dt>费用类别</dt><dd>{assetLabels[row.category]||row.category}</dd></div><div><dt>原费用</dt><dd>{money(row.amount)}</dd></div><div><dt>实际发生日</dt><dd>{row.occurredOn}</dd></div><div><dt>供应商</dt><dd>{row.supplierName}</dd></div><div><dt>原凭证号</dt><dd>{row.referenceNo}</dd></div><div><dt>费用说明</dt><dd>{row.reason}</dd></div></dl><ul className="asset-files">{row.files.map(file=><li key={file.id}><a href={endpoint('/admin/asset-work-order-cost-lines/'+encodeURIComponent(id)+'/files/'+encodeURIComponent(file.id))} target="_blank" rel="noreferrer">{file.name}</a></li>)}</ul><p className="muted">以上为冻结时的费用及凭据。付款凭据在下方成本记录中独立维护。</p></>}</section>;
}
