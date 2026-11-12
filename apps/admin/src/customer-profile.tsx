import {useEffect,useRef,useState} from 'react';
import {api,date,type Session} from './core';
import {Facts} from './domain-ui';
import {ErrorNotice,Loading} from './ui';
import {ProseText} from './prose-text';
import {CustomerQualificationFromProfile} from './customer-risk';
import {canReadCustomerProfile,customerFilePath,customerSourceLabel,profileQualificationEvidence,customerIdentityStatus,type ClassifiedFiles,type CustomerDossier,type CustomerResource,type ProfileFile} from './customer-profile-model';
import './customer-profile.css';

const fields=[['identityFront','身份证人像面'],['identityBack','身份证国徽面'],['drivingLicense','驾驶证']] as const;
const missingNames:Record<string,string>={name:'姓名',mobile:'已验证手机号',drivingYears:'驾龄',identityFrontFileId:'身份证人像面',identityBackFileId:'身份证国徽面',drivingLicenseFileId:'驾驶证'};

export function CustomerProfilePanel({resource,recordId,refreshKey,onQualificationSaved,disabled=false}:{resource:CustomerResource;recordId:string;refreshKey?:unknown;onQualificationSaved?:()=>void;disabled?:boolean}){
 return canReadCustomerProfile(api.session?.user.role)?<ReviewerProfile key={`${resource}:${recordId}:${api.session?.user.id}`} resource={resource} recordId={recordId} refreshKey={refreshKey} onQualificationSaved={onQualificationSaved} disabled={disabled}/>:null;
}
function ReviewerProfile({resource,recordId,refreshKey,onQualificationSaved,disabled=false}:{resource:CustomerResource;recordId:string;refreshKey?:unknown;onQualificationSaved?:()=>void;disabled?:boolean}){
 const session=api.session,[refresh,setRefresh]=useState(0),[result,setResult]=useState<{session:Session|null;path:string;data:CustomerDossier}>(),[error,setError]=useState<unknown>(),[loading,setLoading]=useState(true),[profileChanged,setProfileChanged]=useState(false),[previewGeneration,setPreviewGeneration]=useState(0);
 const previousHash=useRef<string|undefined>(undefined);
 const path=`/admin/${resource}/${encodeURIComponent(recordId)}/customer-profile`;
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError(undefined);setPreviewGeneration(value=>value+1);
  api.request<CustomerDossier>(path,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted){const hash=profileQualificationEvidence(data)?.profileHash;if(previousHash.current&&previousHash.current!==hash)setProfileChanged(true);previousHash.current=hash;setResult({session,path,data});}}).catch(e=>{if(!controller.signal.aborted)setError(e);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[path,session,refresh,refreshKey]);
 const data=result?.session===session&&result?.path===path?result.data:undefined;
 const retry=()=>setRefresh(value=>value+1);
 if(!data)return error?<ErrorNotice error={error} retry={retry}/>:<Loading label="正在读取本次客户资料"/>;
 const frozen=data.source!=='CURRENT_SUPPLEMENT'?data.snapshot:null,current=data.currentProfile,evidence=profileQualificationEvidence(data);
 const identityPolicy=current.readiness.identityPolicy??data.identity.identityPolicy;
 return <div className="customer-dossier">
  <header className="customer-dossier-heading"><div><h3>客户资料</h3><p>核对本次申请或订单的资料依据，并独立查看客户当前补充内容。</p></div><button className="button" type="button" onClick={retry}>刷新客户资料</button></header>
  {error?<><ErrorNotice error={error} retry={retry}/><p className="customer-evidence-notice">以下为上次读取的客户资料，输入已保留；刷新核对后才可提交。</p></>:loading?<p className="customer-evidence-notice" role="status">正在读取最新客户资料，已填写内容已保留；读取完成后再提交。</p>:null}
  {profileChanged?<p className="customer-evidence-notice" role="status">客户个人资料已更新，原填写内容不再套用。请重新核对当前证件后办理。</p>:null}
  <section className="customer-evidence-section" aria-label="原审核资料">
   <h4>{customerSourceLabel(data.source)}</h4>
   {frozen?<><p className="customer-evidence-source">冻结于 {date(frozen.capturedAt)} · 资料第 {frozen.profileRevision} 版。后续个人资料修改不会覆盖本版。</p>
    <Facts items={[["姓名",frozen.name],["已验证手机号",frozen.mobile],["驾龄（年）",frozen.drivingYears],["冻结实名状态",customerIdentityStatus({identityPolicy:frozen.version===2?frozen.identityPolicy:undefined,verified:!!data.identity.snapshot})],['实名核验时间',frozen.version===1?data.identity.snapshot?.verifiedAt:undefined,'date']]}/>
    <EvidenceFiles key={previewGeneration} resource={resource} recordId={recordId} files={data.files.snapshot}/>
   </>:<p className="customer-evidence-notice">此记录没有可核验的历史客户资料快照。下方当前资料仅供补充查阅，不代表当时已提交或通过审核。</p>}
  </section>
  <section className="customer-evidence-section" aria-label="当前个人资料">
   <h4>当前个人资料与补充材料</h4><p className="customer-evidence-source">资料第 {current.revision} 版 · 客户后续更新会在此处显示，与上方原审核依据分开保存。</p>
   <Facts items={[["当前姓名",current.name],["已验证手机号",current.mobile],["当前驾龄（年）",current.drivingYears],["当前实名状态",customerIdentityStatus({identityPolicy,verified:data.identity.current.verified})],['当前实名核验时间',identityPolicy==='MANUAL_REVIEW'?undefined:data.identity.current.verifiedAt,'date'],['人工资格审核',data.qualificationStatus.status,'status'],['人工资格当前有效',data.qualificationStatus.valid]]}/>
   <p className="customer-evidence-source">实名结果与人工资格审核是两项独立事实；上传照片本身不代表已实名。</p>
   <EvidenceFiles key={previewGeneration} resource={resource} recordId={recordId} files={data.files.current}/>
   {data.files.current.legacy.length?<section className="customer-legacy-files"><h5>未分类历史附件</h5><p>这些附件没有可信证件分类，不能按排列顺序认定为身份证或驾驶证。</p><div className="customer-document-grid">{data.files.current.legacy.map((file,index)=><PrivateDocument key={`${previewGeneration}:${file.id}`} resource={resource} recordId={recordId} file={file} label={`未分类历史附件 ${index+1}`}/>)}</div></section>:null}
   {current.readiness.missingFields.length?<p className="customer-evidence-notice">当前待补齐：{current.readiness.missingFields.map(field=>missingNames[field]||'其他资料').join('、')}</p>:null}
   {current.readiness.blockers.length?<div className="customer-evidence-notice"><h5>当前资料待处理事项</h5>{current.readiness.blockers.map((block,index)=><ProseText key={`${block.code}-${index}`} text={block.message}/>)}</div>:null}
   {evidence?<CustomerQualificationFromProfile key={evidence.profileHash} customerId={data.customerId} evidence={evidence} after={retry} onCommitted={onQualificationSaved} disabled={disabled||loading||!!error} refreshKey={data}/>:<p className="customer-evidence-source">补齐明确分类的证件后，可沿用已上传证件提交人工资格资料。</p>}
  </section>
 </div>;
}
function EvidenceFiles({resource,recordId,files}:{resource:CustomerResource;recordId:string;files:ClassifiedFiles|null}){
 return <div className="customer-document-grid">{fields.map(([key,label])=>files?.[key]?<PrivateDocument key={key} resource={resource} recordId={recordId} file={files[key]!} label={label}/>:<div className="customer-document missing" key={key}><h5>{label}</h5><p>未提供对应分类材料</p></div>)}</div>;
}
function PrivateDocument({resource,recordId,file,label}:{resource:CustomerResource;recordId:string;file:ProfileFile;label:string}){
 const session=api.session,[preview,setPreview]=useState<{url:string;session:Session|null;fileId:string;fileUrl:string}>(),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 const controller=useRef<AbortController|undefined>(undefined),url=useRef<string|undefined>(undefined),generation=useRef(0);
 useEffect(()=>{setPreview(undefined);setError(undefined);setBusy(false);return()=>{generation.current++;controller.current?.abort();if(url.current)URL.revokeObjectURL(url.current);url.current=undefined;};},[file.id,file.url,session]);
 const read=async()=>{
  const stamp=++generation.current;controller.current?.abort();controller.current=new AbortController();setBusy(true);setError(undefined);
  try{const path=customerFilePath(resource,recordId,file),blob=await api.readPrivateFile(path,file.mimeType,controller.current.signal);if(generation.current!==stamp||api.session!==session)return;if(url.current)URL.revokeObjectURL(url.current);url.current=URL.createObjectURL(blob);setPreview({url:url.current,session,fileId:file.id,fileUrl:file.url});}
  catch(e){if(generation.current===stamp&&!controller.current?.signal.aborted)setError(e);}
  finally{if(generation.current===stamp)setBusy(false);}
 };
 const safeUrl=preview?.session===session&&preview.fileId===file.id&&preview.fileUrl===file.url?preview.url:undefined,supported=['image/png','image/jpeg','application/pdf'].includes(file.mimeType);
 return <article className="customer-document"><h5>{label}</h5><p className="customer-document-name">{file.name}</p>
  {safeUrl&&file.mimeType.startsWith('image/')?<img src={safeUrl} alt={label} onError={()=>setError(new Error('图片无法显示，请下载原件核对'))}/>:null}
  {supported?<button className="button" type="button" disabled={busy} onClick={()=>void read()}>{busy?'正在读取…':file.mimeType==='application/pdf'?`读取${label} PDF`:`预览${label}`}</button>:<p>此文件格式不支持安全预览</p>}
  {safeUrl?<a className="text-button" href={safeUrl} download={file.name} rel="noreferrer">下载{label}原件</a>:null}{error?<ErrorNotice error={error}/>:null}
 </article>;
}
