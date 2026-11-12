import {useEffect,useState} from 'react';
import {certificationPayload,dateTime,documentLabel,ownerVerificationLabel,statusLabel,verificationDocumentTypes} from './model';
import type {Authority,AuthorityAction,AuthorityOptions,AuthorityRequestResult,LegalDocument,OwnerDetail,Seal} from './model';
import {ActionFeedback,Notice,useDismissFeedback} from './Common';
import {AuthorityPanel} from './AuthorityPanel';
import type {authorityPayload} from './model';
import type {Feedback,FeedbackMap} from './workspace';
import type {OwnerClient} from './client';
import {ContractPanel} from './ContractPanel';

function SealCard({seal,index,busy,canSelect,onSeal,onPreview,feedback,selectedLabel,selectedReady}:{selectedReady:boolean;selectedLabel:string;seal:Seal;index:number;busy:boolean;canSelect:boolean;onSeal:(id:string)=>Promise<boolean>;onPreview:(id:string)=>Promise<string|null>;feedback?:Feedback}){
 const [preview,setPreview]=useState<string|null>(null),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0),[previewFeedback,setPreviewFeedback]=useState<Feedback>();
 useEffect(()=>{let current=true;setPreview(null);setLoading(true);void onPreview(seal.id).then(image=>{if(current){setPreview(image);setLoading(false);if(retry>0)setPreviewFeedback(image?{note:'已重新加载印章图样。'}:{error:'印章图样暂未加载，请稍后重试。'});}},()=>{if(current){setLoading(false);if(retry>0)setPreviewFeedback({error:'印章图样暂未加载，请稍后重试。'});}});return()=>{current=false;};},[seal.id,seal.imageHash,seal.checkedAt,retry,onPreview]);
 return <article className="seal-card"><div className="section-title"><h3>企业印章 {index+1}</h3><span className={`tag ${seal.status==='ACTIVE'&&selectedReady?'done':''}`}>{seal.status==='ACTIVE'?selectedLabel:statusLabel(seal.status)}</span></div>
  {preview?<img className="seal-preview" src={preview} alt={`企业印章 ${index+1} 图样`}/>:<div className="seal-placeholder" role="status">{loading?'正在读取印章图样…':'印章图样暂未加载'}</div>}
  {!loading&&!preview&&<><p className="fineprint">图样读取未完成，请重新加载。此操作不会生成或选用印章。</p><button className="secondary full" disabled={busy||loading} onClick={()=>setRetry(value=>value+1)}>重新加载图样</button></>}
  <p className="fineprint">最近核验：{dateTime(seal.checkedAt)}</p>
  {seal.status!=='ACTIVE'&&<div className="action-row"><button className="primary" disabled={busy||!canSelect||seal.status!=='DISCOVERED'} onClick={()=>void onSeal(seal.id)}>选用此印章</button></div>}
  <ActionFeedback value={feedback} busy={busy}/><ActionFeedback value={previewFeedback} busy={busy}/>
 </article>;
}

export function Enterprise({detail,documents,authorities,options,optionsError,busy,onBack,onRead,onVerification,onRefresh,onSeal,onPreview,onRequest,onManage,onLegal,feedback,api,onExpired,isSessionCurrent}:{detail:OwnerDetail;documents:LegalDocument[];authorities:Authority[];options:AuthorityOptions|null;optionsError:string;busy:boolean;onBack:()=>void;onRead:()=>void;onVerification:(body:ReturnType<typeof certificationPayload>)=>Promise<boolean>;onRefresh:(key?:string)=>void;onSeal:(id:string)=>Promise<boolean>;onPreview:(id:string)=>Promise<string|null>;onRequest:(body:ReturnType<typeof authorityPayload>)=>Promise<AuthorityRequestResult>;onManage:(authority:Authority,action:AuthorityAction,confirmation?:string)=>Promise<boolean>;onLegal:(type:string)=>void;feedback:FeedbackMap;api:OwnerClient;onExpired:()=>void;isSessionCurrent:()=>boolean}){
 const [accepted,setAccepted]=useState<Record<string,boolean>>({}),[error,setError]=useState<Feedback>();
 const dismissFeedback=useDismissFeedback();
 const [tab,setActiveTab]=useState<'enterprise'|'authority'|'contracts'>('enterprise');
 function setTab(value:'enterprise'|'authority'|'contracts'){dismissFeedback();setActiveTab(value);}
 const completed=detail.certificationComplete===true;
 const showVerification=!completed&&detail.capabilities.canStartVerification&&(detail.certificationComplete===undefined||detail.realNameStatus!=='VERIFIED'||detail.memberStatus!=='VERIFIED'||detail.certStatus!=='BOUND'||!detail.capabilities.canRefreshVerification);
 const documentVersion=documents.map(d=>`${d.id}:${d.version}`).join(',');
 const certificationContext=JSON.stringify({ownerId:detail.id,revision:detail.revision,legalRepresentative:detail.legalRepresentative});
 useEffect(()=>{setAccepted({});},[documentVersion,certificationContext]);
 async function verify(){try{setError(undefined);if(await onVerification(certificationPayload(accepted,documents)))setAccepted({});}catch(e){setError({error:(e as Error).message});}}
 return <div className="detail">
  <button className="back-link" disabled={busy} onClick={onBack}>← 返回我的企业</button>
  <div className="detail-heading"><div className="section-kicker"><span>企业车主</span></div><span className="tag">{ownerVerificationLabel(detail)}</span></div>
  <h1>{detail.name}</h1><p className="muted">法人 {detail.legalRepresentative.name} · {detail.legalRepresentative.maskedMobile}</p>
  <dl className="facts"><div><dt>统一信用代码</dt><dd>{detail.creditCode}</dd></div><div><dt>企业地址</dt><dd>{detail.address}</dd></div></dl>
  {detail.blockers.length>0&&<Notice><ul>{detail.blockers.map((item,index)=><li key={`${index}:${item}`}>{item}</li>)}</ul></Notice>}
  <button className="text-button" disabled={busy} onClick={onRead}>重新读取企业资料</button>
  <ActionFeedback value={feedback[`${detail.id}:enterprise-read`]} busy={busy} canRefresh={detail.capabilities.canRefreshVerification} onRefresh={()=>onRefresh('enterprise-read')}/>
  <div className="workspace-tabs" role="tablist" aria-label="企业工作区" onKeyDown={event=>{const tabs=['enterprise','authority','contracts'] as const,index=tabs.indexOf(tab),next=event.key==='ArrowRight'?(index+1)%3:event.key==='ArrowLeft'?(index+2)%3:event.key==='Home'?0:event.key==='End'?2:null;if(next!==null){event.preventDefault();setTab(tabs[next]);document.getElementById(`tab-${tabs[next]}`)?.focus();}}}>{([{id:'enterprise',label:'企业与印章'},{id:'authority',label:'签约授权'},{id:'contracts',label:'业务合同'}] as const).map(item=><button key={item.id} id={`tab-${item.id}`} role="tab" tabIndex={tab===item.id?0:-1} aria-selected={tab===item.id} aria-controls={`panel-${item.id}`} onClick={()=>setTab(item.id)}>{item.label}</button>)}</div>
  <div role="tabpanel" id="panel-enterprise" aria-labelledby="tab-enterprise" hidden={tab!=='enterprise'}>
  <section className="owner-section"><h2>01 · 企业与法人认证</h2><div className="readiness-grid"><div><span>企业实名记录</span><strong>{detail.realNameStatus==='VERIFIED'?'已完成认证':statusLabel(detail.realNameStatus)}</strong></div><div><span>签署证书</span><strong>{detail.verificationDisplay?.certification.label||(completed?'证书已核验':detail.certStatus==='BOUND'?'待更新核验':statusLabel(detail.certStatus))}</strong></div></div><p className="fineprint">法人关系记录：{detail.memberStatus==='VERIFIED'?'已确认':statusLabel(detail.memberStatus)}。手机号登录、企业认证及签署证书分别核验。</p>
   {showVerification&&<div className="purpose"><h3>由法人本人办理</h3><p>企业名称、统一信用代码、法人姓名及已验证手机号将用于法大大企业认证。请本人完成刷脸或其他核验；已有认证可在明确同意后接续查询。</p>
    <fieldset disabled={busy}>{verificationDocumentTypes.map(type=><label className="check" key={type}><input type="checkbox" checked={!!accepted[type]} onChange={e=>setAccepted(old=>({...old,[type]:e.target.checked}))}/><span>我已阅读并同意<button type="button" className="inline-link" onClick={()=>onLegal(type)}>{documentLabel(type)}</button></span></label>)}
     <ActionFeedback value={error} busy={busy}/><button className="primary full" onClick={()=>void verify()}>由法人本人办理认证 <span aria-hidden="true">↗</span></button>
    </fieldset>
   </div>}
   {(completed||detail.capabilities.canRefreshVerification)&&<button className="secondary full" disabled={busy||!detail.capabilities.canRefreshVerification} onClick={()=>onRefresh()}>{detail.verificationDisplay?.certification.state==='REFRESH_REQUIRED'||completed?'重新核验企业与证书状态':'主动查询认证与证书状态'}</button>}
   <ActionFeedback value={feedback[`${detail.id}:certification`]} busy={busy} canRefresh={detail.capabilities.canRefreshVerification} onRefresh={()=>onRefresh()}/>
   {completed&&<p className="fineprint">已完成认证。重新核验仅查询企业认证、证书和印章状态，不会发起认证或签署。{!detail.capabilities.canRefreshVerification&&'当前暂不能查询，请先重新读取企业资料；仍不可用时请联系平台核对。'}</p>}
   {!completed&&<p className="fineprint">{detail.verificationDisplay?.certification.message||'外部页面返回不会自动更新认证或触发授权。已有认证请先主动查询，以服务端核验结果为准。'}</p>}
  </section>
  <section className="owner-section"><div className="section-title"><h2>02 · 企业印章</h2><span>{detail.seals.length} 枚</span></div><p className="muted">选择印章仅用于明确企业拟用图样；每项用印授权仍需独立办理。</p>
   {!detail.seals.length&&<div className="empty compact"><p>尚未发现可用印章。请先完成企业认证并主动查询。</p></div>}
   <div className="seal-list">{detail.seals.map((seal,index)=><SealCard key={seal.id} seal={seal} selectedReady={detail.verificationDisplay?detail.verificationDisplay.seal.state==='READY':detail.readyForSigning} selectedLabel={detail.verificationDisplay?.seal.label||(completed?'已选用并核验':'已选用，待更新核验')} index={index} busy={busy} canSelect={detail.capabilities.canSelectSeal} onSeal={onSeal} onPreview={onPreview} feedback={feedback[`${detail.id}:seal:${seal.id}`]}/>)}</div>
  </section>
  </div>
  <div role="tabpanel" id="panel-authority" aria-labelledby="tab-authority" hidden={tab!=='authority'}><AuthorityPanel detail={detail} authorities={authorities} options={options} optionsError={optionsError} documents={documents} busy={busy} onRequest={onRequest} onManage={onManage} onPreview={onPreview} onLegal={onLegal} feedback={feedback} onRefresh={onRefresh}/></div>
  <div role="tabpanel" id="panel-contracts" aria-labelledby="tab-contracts" hidden={tab!=='contracts'}><ContractPanel ownerId={detail.id} active={tab==='contracts'} api={api} onExpired={onExpired} onEnterprise={()=>setTab('enterprise')} isSessionCurrent={isSessionCurrent}/></div>
 </div>;
}
