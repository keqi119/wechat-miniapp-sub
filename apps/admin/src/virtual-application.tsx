import {useEffect,useState,useRef} from 'react';
import {Alert,Card,Descriptions,Form,Input,Space} from 'antd';
import {api,type Entity} from './core';
import {ErrorNotice,Status} from './ui';
export function VirtualApplicationWorkspace({application,onRefresh,refreshKey,detailRefreshing,detailError}:{application:Entity;onRefresh:()=>void;refreshKey:number;detailRefreshing?:boolean;detailError?:unknown}){
 const plan=application.finalPlan as Entity|undefined,scope=application.virtualAcceptance as {notice:string};
 const savedAddress=String((plan?.commercialTerms as Record<string,unknown>)?.customerAddress||''),savedDate=typeof plan?.startDate==='string'?plan.startDate.slice(0,10):'';
 const [address,setAddress]=useState(savedAddress),[referenceDate,setDate]=useState(savedDate),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[receipt,setReceipt]=useState('');
 const attempt=useRef<{payload:string;key:string}|null>(null),writable=['ADMIN','OPERATIONS'].includes(api.session?.user.role||''),disabled=busy||!!detailRefreshing||!!detailError,dirty=!!plan&&(address.trim()!==savedAddress||referenceDate!==savedDate);
 useEffect(()=>{let active=true;setAddress(savedAddress);setDate(savedDate);api.request<{referenceDate:string}>('/admin/applications/'+application.id+'/final-plan-defaults').then(value=>{if(active&&!savedDate)setDate(value.referenceDate||'');}).catch(e=>{if(active)setError(e);});return()=>{active=false;};},[application.id,refreshKey,savedAddress,savedDate]);
 async function command(action:string,body:Record<string,unknown>){if(disabled||action==='virtual-review'&&dirty)return;const session=api.session,payload=JSON.stringify({id:application.id,revision:application.revision,action,body});if(attempt.current?.payload!==payload)attempt.current={payload,key:crypto.randomUUID()};setBusy(true);setError(undefined);try{await api.request('/admin/applications/'+application.id+'/'+action,{method:'POST',body:{revision:application.revision,idempotencyKey:attempt.current.key,...body}});if(api.session!==session)return;setReceipt(action==='virtual-review'?'测试资料与方案已确认，请客户核对。':'操作已保存，请核对最新方案。');onRefresh();}catch(e){if(api.session===session)setError(e);}finally{setBusy(false);}}
 return <section className="detail-body"><Space orientation="vertical" size={20} style={{width:'100%'}}>
 <Card title="虚拟流程验收" extra={<Status value={application.status} resource="applications"/>}><Alert type="info" showIcon title={scope.notice}/><p>客户本人真实实名与双方企业协议归档仍须完成；本次不产生车辆交付、合作分润或对公结算义务。</p>{detailError||error?<ErrorNotice error={detailError||error}/>:null}{receipt?<p role="status">{receipt}</p>:null}</Card>
 <Card title="测试资料确认（驾驶资格、信用核验不适用）"><p>仅确认本次测试方案及真实身份依据，不形成普通信用或驾驶资格审核结论。</p>
 {writable&&application.status==='SUBMITTED'?<button className="button primary" disabled={disabled} onClick={()=>command('review',{decision:'IN_REVIEW'})}>受理测试申请</button>:null}
 {writable&&['IN_REVIEW','AWAITING_CONFIRMATION'].includes(String(application.status))?<Form layout="vertical" style={{maxWidth:720}}>
 <Form.Item label="客户实际联系地址"><Input aria-label="客户实际联系地址" value={address} maxLength={1000} onChange={e=>setAddress(e.target.value)}/></Form.Item>
 <Form.Item label="测试参考日期" extra="参考日期不代表真实起租或交付承诺；联系地址由运营核对后填写。"><Input aria-label="测试参考日期" type="date" value={referenceDate} onChange={e=>setDate(e.target.value)} style={{maxWidth:240}}/></Form.Item>
 {dirty?<Alert type="warning" title="存在未保存编辑，请先生成测试方案，再确认最新保存的版本。" style={{marginBottom:16}}/>:null}
 <button type="button" className="button" disabled={disabled||!address.trim()||!referenceDate} onClick={()=>command('virtual-quote',{customerAddress:address.trim(),referenceDate})}>生成测试方案</button></Form>:null}</Card>
 {plan?<Card title={'已保存方案 · 版本 '+String(plan.revision)}><Descriptions column={1} size="small" items={[{key:'fee',label:'固定测试金额',children:'12期 × ¥1.00；固定押金 ¥1.00；首次合计 ¥2.00'},{key:'address',label:'客户实际联系地址',children:savedAddress||'待登记'},{key:'date',label:'测试参考日',children:savedDate||'待登记'},{key:'review',label:'资料确认状态',children:plan.reviewStatus==='APPROVED'?'已完成测试资料确认':'待确认'}]}/><p>确认对象为上方已保存的版本；修改表单不会改写该版本。</p>{writable&&['IN_REVIEW','AWAITING_CONFIRMATION'].includes(String(application.status))?<button type="button" className="button primary" disabled={disabled||dirty||!savedAddress||!savedDate||plan.revision!==application.revision||plan.reviewStatus==='APPROVED'} onClick={()=>command('virtual-review',{commercialHash:plan.commercialHash})}>确认测试资料与方案</button>:null}</Card>:null}
 <div><button className="button" disabled={busy} onClick={onRefresh}>刷新详情</button></div></Space></section>;
}
