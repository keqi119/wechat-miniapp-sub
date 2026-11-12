import {useEffect,useRef,useState} from 'react';
import {authorityDocumentPath,authorityKindLabel,authorityLetterNotice,authorityLetterStatus,canResumeAuthority,dateTime,isAuthorityOptionsV2,isUnilateralAuthority,matchingAuthorityTemplate,money,statusLabel} from './model';
import type {Authority,AuthorityAction,AuthorityOptions,LegalDocument,OwnerDetail} from './model';
import {ActionFeedback,Notice} from './Common';
import {authorityGuidance} from './workspace';
import type {Feedback} from './workspace';

export function AuthorityRecord({detail,authority,options,documents,busy,onManage,onPreview,onLegal,feedback,onRefresh}:{detail:OwnerDetail;authority:Authority;options:AuthorityOptions|null;documents:LegalDocument[];busy:boolean;onManage:(authority:Authority,action:AuthorityAction,confirmation?:string)=>Promise<boolean>;onPreview:(id:string)=>Promise<string|null>;onLegal:(type:string)=>void;feedback?:Feedback;onRefresh:()=>void}){
 const [confirmRevoke,setConfirmRevoke]=useState(false),[preview,setPreview]=useState<string|null>(null),[previewBusy,setPreviewBusy]=useState(false),[previewFeedback,setPreviewFeedback]=useState<Feedback>();
 const alive=useRef(true),previewLocked=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function readPreview(){
  if(previewLocked.current||busy)return;previewLocked.current=true;setPreviewBusy(true);
  try{const image=await onPreview(authority.sealId);if(alive.current){setPreview(image);setPreviewFeedback(image?{note:'已加载本次授权印章图样，请核对。'}:{error:'印章图样暂未加载，请稍后重试。'});}}
  catch{if(alive.current)setPreviewFeedback({error:'印章图样暂未加载，请稍后重试。'});}
  finally{previewLocked.current=false;if(alive.current)setPreviewBusy(false);}
 }
 const legacy=authority.scope.version===1?authority.scope:null,v2=authority.scope.version===2?authority.scope:null,legacyOptions=options&&!isAuthorityOptionsV2(options)?options:null;
 const template=legacy?matchingAuthorityTemplate(documents,{id:legacy.templateId,version:legacy.templateVersion,hash:legacy.templateHash}):null;
 const title=template?.title||(legacy&&legacyOptions?.template?.id===legacy.templateId&&legacyOptions.template.version===legacy.templateVersion&&legacyOptions.template.hash===legacy.templateHash?legacyOptions.template.title:'已保存合同模板');
 const unilateral=isUnilateralAuthority(authority),seal=detail.seals.find(item=>item.id===authority.sealId),authorized=!unilateral&&authority.status==='AUTHORIZED'&&!authority.enabled;
 // Automatic activation is unavailable in this manual workspace; historical grants can be stopped or revoked.
 async function manage(action:AuthorityAction){return onManage(authority,action);}
 return <article className="authority-card" data-authority-id={authority.id}>
  <div className="section-title"><h3>{unilateral?authorityLetterStatus(authority.status):statusLabel(authority.status)}</h3><span className={`tag ${!unilateral&&authority.enabled?'done':''}`}>{unilateral?'自动用印尚未开放':authority.enabled?'平台用印已启用':'平台用印已停用'}</span></div>
  {legacy&&<p className="fineprint">历史授权 · 保留原车辆及方案范围</p>}
  <p className="record-guidance">{authorityGuidance(authority)}</p><p className="fineprint">创建于 {dateTime(authority.createdAt)}</p>
  {unilateral&&['PENDING','UNKNOWN'].includes(authority.status)&&authority.certificateMatchesCurrent===null&&<Notice>当前证书状态需重新核验，尚不能判断本份授权书是否匹配。<button className="text-button" disabled={busy||!detail.capabilities.canRefreshVerification} onClick={onRefresh}>重新核验企业与证书状态</button></Notice>}
  <dl className="facts"><div><dt>授权期间</dt><dd>{dateTime(authority.scope.validFrom)} 至 {dateTime(authority.scope.validUntil)}</dd></div>
   {v2?<><div><dt>被授权主体</dt><dd>{v2.delegates.map(item=><span className="scope-value" key={item.id}>{item.name}</span>)}</dd></div><div><dt>合同／文件种类</dt><dd>{v2.documentKinds.map(kind=><span className="scope-value" key={kind}>{authorityKindLabel(kind)}</span>)}</dd></div></>:legacy&&<><div><dt>月费范围</dt><dd>{money(legacy.minMonthlyFeeAmount)}–{money(legacy.maxMonthlyFeeAmount)}</dd></div><div><dt>押金范围</dt><dd>{money(legacy.minDepositAmount)}–{money(legacy.maxDepositAmount)}</dd></div><div><dt>期数</dt><dd>{legacy.minMonths}–{legacy.maxMonths} 个月</dd></div><div><dt>合同模板</dt><dd>{title} · v{legacy.templateVersion}<small>{legacy.templateId}</small></dd></div></>}
   <div><dt>最近查询</dt><dd>{dateTime(authority.checkedAt)}</dd></div></dl>
  <div className="saved-scope">{legacy&&<><h4>本次授权车辆</h4><ul>{legacy.vehicleIds.map(id=><li key={id}>{legacyOptions?.vehicles.find(vehicle=>vehicle.vehicleId===id)?.vehicle.title||'车辆名称暂不可用'}<small>{id}</small></li>)}</ul><p className="fineprint">合同模板摘要</p><code>{legacy.templateHash}</code></>}<details className="hash-details"><summary>查看授权记录摘要</summary><p className="fineprint">修订 {authority.revision}</p><code>{authority.scopeHash}</code><p className="fineprint">授权印章：{authority.sealId} · {seal?statusLabel(seal.status):'未在当前企业发现'}</p></details></div>
  {template&&<button className="text-button" disabled={busy} onClick={()=>onLegal('owner-rental-contract')}>阅读本次授权合同模板</button>}
  {seal&&<button className="secondary full" disabled={busy||previewBusy||!detail.capabilities.canManageAuthority} onClick={()=>void readPreview()}>{previewBusy?'正在加载图样…':'查看本次授权印章图样'}</button>}
  {preview&&<img className="seal-preview" src={preview} alt="本次授权印章图样"/>}
  {unilateral&&<>
   <div className="action-row">{authority.document?.sourceAvailable&&<a className="secondary" href={authorityDocumentPath(detail.id,authority.id,'source')} target="_blank" rel="noopener noreferrer">查看本次授权书</a>}{authority.document?.signedAvailable&&<a className="secondary" href={authorityDocumentPath(detail.id,authority.id,'signed')} target="_blank" rel="noopener noreferrer">查看签后授权书</a>}</div>
   {!(['PENDING','UNKNOWN'].includes(authority.status)&&(authority.certificateMatchesCurrent===false||authority.certificateMatchesCurrent===null))&&<Notice>{authorityLetterNotice(authority)}</Notice>}
   {authority.certificateMatchesCurrent!==false&&authority.certificateMatchesCurrent!==null&&canResumeAuthority(detail,authority)&&<button className="primary full" disabled={busy} onClick={()=>void manage('resume')}>继续签署本份授权书 <span aria-hidden="true">↗</span></button>}
  </>}
  {authorized&&!detail.autoSigningExecutionEnabled&&<Notice>供应商已确认本次授权；自动用印尚未开放，当前不会自动盖章。</Notice>}
  {detail.capabilities.canManageAuthority&&<div className="action-row"><button className="secondary" disabled={busy} onClick={()=>void manage('refresh')}>{unilateral?'查询授权书签署状态':'查询授权状态'}</button>{authority.enabled&&<button className="secondary" disabled={busy} onClick={()=>void manage('disable')}>停用平台用印</button>}{(unilateral?authority.status!=='WITHDRAWN'&&!authority.document?.withdrawnAt:authority.status!=='REVOKED')&&<button className="text-button danger" disabled={busy} onClick={()=>setConfirmRevoke(true)}>{unilateral?'撤回并停用本地授权':'撤销供应商授权'}</button>}</div>}
  {confirmRevoke&&<div className="revoke-confirm"><Notice>{unilateral?'此操作仅撤回并停用本地授权，不会撤销法大大账户授权，也不会作废已完成的电子签名。已发出的签署仍需查询实际结果。':'此操作会停用该企业账户相关的平台用印授权，并前往法大大撤销账户授权。完成外部操作后，仍需主动查询确认。'}</Notice><div className="action-row"><button className="secondary" disabled={busy} onClick={()=>setConfirmRevoke(false)}>取消</button><button className="primary" disabled={busy} onClick={()=>void manage('revoke').then(ok=>{if(ok)setConfirmRevoke(false);})}>{unilateral?'确认撤回并停用':'确认撤销并继续'}</button></div></div>}
  <ActionFeedback value={feedback} busy={busy} canRefresh={detail.capabilities.canRefreshVerification} onRefresh={onRefresh}/>
  <ActionFeedback value={previewFeedback} busy={previewBusy}/>
 </article>;
}
