import {LegalApp} from './LegalApp';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {OwnerApiError,OwnerClient} from './client';
import {OwnerLifecycle,scopedOwners,validPortalSession,validEnterpriseSession,portalReturnDecision} from './lifecycle';
import {dateTime,documentsCurrent,loginDocumentTypes,readEntry} from './model';
import type {LegalDocument,OwnerSummary,Session,loginPayload,smsPayload} from './model';
import type {EnterpriseSession} from './lifecycle';
import type {PartnerDetail} from './partner-model';
import {ActionFeedback,LegalDialog,useDismissFeedback} from './Common';
import {Login} from './Login';
import {SimpleWorkspace} from './SimpleWorkspace';
import {invitationConfirmPayload,invitationPreviewPayload,validateInvitationPreview} from './simple-model';
import type {InvitationPreview} from './simple-model';
import './simple.css';
export interface SmsChallenge {accepted:true;challengeId:string;expiresInSeconds:number;resendAfterSeconds:number}
const message=(e:unknown)=>e instanceof Error?e.message:'读取未完成，请稍后重试。';
function PartnerApp(){
 const [lifecycle]=useState(()=>new OwnerLifecycle(new OwnerClient())),api=lifecycle.api;
 const [entry]=useState(()=>{const value=readEntry(location.pathname,location.search);history.replaceState(null,'',value.cleanPath+location.hash);return value;});
 const [ready,setReady]=useState(false),[enabled,setEnabled]=useState(false),[session,setSession]=useState<EnterpriseSession|null>(null),[documents,setDocuments]=useState<LegalDocument[]>([]),[owners,setOwners]=useState<OwnerSummary[]>([]),[detail,setDetail]=useState<PartnerDetail|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState(''),[legal,setLegal]=useState<LegalDocument|null>(null);
 const pendingInvitation=useRef(entry.invitationToken);
 const locked=useRef(false),viewEpoch=useRef(0),recovering=useRef(false),dismissFeedback=useDismissFeedback();
 const [binding,setBinding]=useState(false),[readonlyLogin,setReadonlyLogin]=useState(false);
 const feedback=useMemo(()=>error?{error}:note?{note}:undefined,[error,note]);
 const clearView=useCallback(()=>{dismissFeedback();viewEpoch.current++;setDetail(null);setOwners([]);setSession(null);setLegal(null);setBinding(false);setReadonlyLogin(false);},[dismissFeedback]);
 const expire=useCallback(()=>{lifecycle.clear();clearView();locked.current=false;setBusy(false);setError('登录或查看授权已失效，请重新登录。');},[lifecycle,clearView]);
 const bootstrap=useCallback(async(preserveRoute=true)=>{
  lifecycle.clear();clearView();const ticket=lifecycle.ticket();locked.current=true;setBusy(true);setReady(false);setError('');
  try{
   const state=await lifecycle.bootstrap();if(!lifecycle.current(ticket))return;
   setEnabled(state.config.enabled);setDocuments(state.documents);setSession(state.session);setOwners(state.owners);setBinding(!!state.session&&!!pendingInvitation.current);
   if(state.session){
    api.setCsrf(state.session.csrfToken);
    const ownerId=preserveRoute?/^#\/owners\/([A-Za-z0-9_-]+)\//.exec(location.hash)?.[1]:undefined;
    const scope=state.session.mode==='PARTNER_READONLY'?state.session.scopes.find(s=>s.ownerId===ownerId):undefined;
    if(scope&&state.owners.some(o=>o.ownerId===scope.ownerId)){
     const value=await api.request<PartnerDetail>(`/owners/${scope.ownerId}`);if(!lifecycle.current(ticket))return;
     if(value.mode==='PARTNER_READONLY'&&value.id===scope.ownerId&&value.accessVersion===scope.accessVersion)setDetail(value);
    }
   }
   setReady(true);
  }catch(e){if(lifecycle.current(ticket)){setError(message(e));setReady(false);}}
  finally{if(lifecycle.current(ticket)){locked.current=false;setBusy(false);}recovering.current=false;}
 },[api,lifecycle,clearView]);
 useEffect(()=>{const unsubscribe=api.onAccessDenied(status=>{
  if(status===401){expire();return;}
  if(recovering.current)return;recovering.current=true;setNote('查看授权已变化，请从当前有效合作范围重新选择。');history.replaceState(null,'',entry.cleanPath);void bootstrap(false);
 });void bootstrap();return()=>{unsubscribe();lifecycle.clear();};},[api,lifecycle,bootstrap,expire,entry.cleanPath]);
 useEffect(()=>{if(!session)return;const remaining=Date.parse(session.expiresAt)-Date.now();if(remaining<=0){expire();return;}const timer=setTimeout(expire,Math.min(remaining,2147483647));return()=>clearTimeout(timer);},[session,expire]);
 // Recheck grants on return to the page; the server rechecks every resource request too.
 useEffect(()=>{const resume=()=>{if(document.visibilityState!=='visible'||!session||locked.current)return;const ticket=lifecycle.ticket(),view=viewEpoch.current;void api.request<EnterpriseSession>('/auth/me').then(current=>{if(!lifecycle.current(ticket)||viewEpoch.current!==view)return;const decision=session.mode==='PARTNER_READONLY'?portalReturnDecision(current,session):validEnterpriseSession(current)&&current.mode==='ELECTRONIC_LEGAL'&&current.sessionBinding===session.sessionBinding?'PRESERVE':'EXPIRE';if(decision==='EXPIRE')expire();else if(decision==='RELOAD')void bootstrap();}).catch(()=>{if(lifecycle.current(ticket)&&viewEpoch.current===view)expire();});};document.addEventListener('visibilitychange',resume);return()=>document.removeEventListener('visibilitychange',resume);},[api,bootstrap,session,lifecycle,expire]);
 async function auth<T>(work:()=>Promise<T>):Promise<T|null>{
  if(locked.current)return null;locked.current=true;setBusy(true);setError('');setNote('');const ticket=lifecycle.ticket();
  try{return await work();}catch(e){if(lifecycle.current(ticket))setError(message(e));return null;}finally{if(lifecycle.current(ticket)){locked.current=false;setBusy(false);}}
 }
 async function login(body:ReturnType<typeof loginPayload>,invitationToken?:string){
  return !!await auth(async()=>{
   const useReadonly=readonlyLogin&&!invitationToken;
   const ticket=lifecycle.ticket();const current=(await api.request<{documents:LegalDocument[]}>('/legal')).documents;
   if(!lifecycle.current(ticket))return false;setDocuments(current);
   if(!documentsCurrent(documents,current,loginDocumentTypes))throw Error('协议版本已更新，请重新阅读并勾选同意。');
   const value=await api.request<EnterpriseSession>('/auth/login',{...body,...(useReadonly?{}:{purpose:'ENTERPRISE_CENTER'}),...(invitationToken?{invitationToken}:{})});if(!lifecycle.current(ticket))return false;
   if(!validEnterpriseSession(value)||useReadonly&&value.mode!=='PARTNER_READONLY'||invitationToken&&value.mode!=='ELECTRONIC_LEGAL')throw Error('登录会话校验未通过，请重新获取验证码。');
   api.setCsrf(value.csrfToken);const items=scopedOwners(value,await api.request<OwnerSummary[]>('/owners'));if(!lifecycle.current(ticket))return false;
   viewEpoch.current++;pendingInvitation.current='';setReadonlyLogin(false);setBinding(false);setDetail(null);setSession(value);setOwners(items);history.replaceState(null,'',entry.cleanPath);return true;
  });
 }
 async function sms(body:ReturnType<typeof smsPayload>,invitationToken?:string){const useReadonly=readonlyLogin&&!invitationToken;return auth(()=>api.request<SmsChallenge>('/auth/sms/request',{...body,...(useReadonly?{}:{purpose:'ENTERPRISE_CENTER'}),...(invitationToken?{invitationToken}:{})}));}
 async function invitationPreview(body:ReturnType<typeof invitationPreviewPayload>){return auth(async()=>validateInvitationPreview(await api.request<InvitationPreview>('/auth/invitation/preview',body)));}
 async function invitationConfirm(body:ReturnType<typeof invitationConfirmPayload>){
  return !!await auth(async()=>{
   const ticket=lifecycle.ticket(),current=(await api.request<{documents:LegalDocument[]}>('/legal')).documents;
   if(!lifecycle.current(ticket))return false;setDocuments(current);if(!documentsCurrent(documents,current,loginDocumentTypes))throw Error('协议版本已更新，请重新核对公司并阅读同意。');
   const value=await api.request<Session>('/auth/invitation/confirm',body);if(!lifecycle.current(ticket))return false;
   if(!validPortalSession(value))throw Error('确认结果无法读取，请使用手机号和短信验证码重新登录。');api.setCsrf(value.csrfToken);
   const items=scopedOwners(value,await api.request<OwnerSummary[]>('/owners'));if(!lifecycle.current(ticket))return false;
   viewEpoch.current++;setDetail(null);setSession(value);setOwners(items);pendingInvitation.current='';setReadonlyLogin(false);setBinding(false);history.replaceState(null,'',entry.cleanPath);return true;
  });
 }
 async function choose(owner:OwnerSummary){
  if(locked.current||session?.mode!=='PARTNER_READONLY'||!session.scopes.some(s=>s.ownerId===owner.ownerId&&s.accessVersion===owner.accessVersion))return;
  viewEpoch.current++;setDetail(null);const view=viewEpoch.current;
  await auth(async()=>{const value=await api.request<PartnerDetail>(`/owners/${owner.ownerId}`);if(view!==viewEpoch.current)return;
   if(value.mode!=='PARTNER_READONLY'||value.id!==owner.ownerId||value.accessVersion!==owner.accessVersion)throw Error('查看范围已变化，请刷新合作范围。');
   location.hash=`/owners/${owner.ownerId}/overview`;setDetail(value);
  });
 }
 async function logout(){await auth(async()=>{await api.request('/auth/logout',{});lifecycle.clear();clearView();locked.current=false;setBusy(false);setNote('已退出登录。');history.replaceState(null,'',entry.cleanPath);return true;});}
 function openLegal(type:string){const value=documents.find(d=>d.type===type);if(value)setLegal(value);else setError('文案尚未发布，请联系运营。');}
 const ticket=lifecycle.ticket(),view=viewEpoch.current;
 return <div className="app owner-app"><header className="topbar"><a className="brand" href="/owner/"><span className="brand-mark" aria-hidden="true"/><span>宁达汽车<small>企业服务</small></span></a>{session&&<button className="logout" disabled={busy} onClick={()=>void logout()}>退出登录</button>}</header>
 <main className="main" aria-busy={busy}>{session&&(session.mode==='PARTNER_READONLY'||session.readonlyAvailable)&&<button className="secondary" disabled={busy} onClick={()=>{const next=session.mode==='ELECTRONIC_LEGAL';lifecycle.clear();clearView();setReadonlyLogin(next);setNote('切换服务需要重新获取验证码并同意当前登录协议。');}}>切换至{session.mode==='ELECTRONIC_LEGAL'?'合作资料':'实名与合同'}（短信验证）</button>}<ActionFeedback value={feedback} busy={busy}/>
 {!ready?(error?<section className="state-card"><h1>暂时无法读取服务</h1><p className="muted">请稍后重试或联系运营。</p><button className="secondary" disabled={busy} onClick={()=>void bootstrap()}>重新加载</button></section>:<section className="state-card" role="status">正在读取合作商服务…</section>):!enabled?<section className="state-card"><h1>合作商入口暂未开放</h1><p>请联系运营确认开放时间。</p><button className="secondary" onClick={()=>void bootstrap()}>重新查看入口状态</button></section>:<>
 {entry.isReturn&&<aside className="return-card"><h2>已返回合作商中心</h2><p>返回页面不表示任何业务已完成，请查看平台发布的当前资料。</p></aside>}
 {!session||binding?<Login initialInvitation={pendingInvitation.current} onReload={()=>void bootstrap(false)} key={binding?'binding':'login'} documents={documents} busy={busy} onLogin={login} onSms={sms} onLegal={openLegal} onPreview={invitationPreview} onConfirm={invitationConfirm} bindOnly={!!session} onCancel={()=>{setBinding(false);setError('');}}/>:session.mode==='ELECTRONIC_LEGAL'?<LegalApp key={session.sessionBinding} session={session} companies={owners} onExpired={expire}/>:detail?<SimpleWorkspace key={detail.id} api={api} detail={detail} onBack={()=>{viewEpoch.current++;setDetail(null);setError('');location.hash='';}} onExpired={expire} isCurrent={()=>lifecycle.current(ticket)&&viewEpoch.current===view}/>:<section><div className="section-kicker"><span>合作伙伴</span><span className="hero-line"/><span>企业服务</span></div><div className="hero"><h1>我的公司</h1><p>合作车辆一目了然，<br/><span>每笔租金分润有据可查。</span></p></div><div className="account-summary"><span>查看账号 · {session.viewer.maskedMobile}</span><button className="text-button" disabled={busy} onClick={()=>void bootstrap(false)}>刷新公司范围</button></div><button className="secondary full bind-another" disabled={busy} onClick={()=>{setBinding(true);setError('');}}>绑定其他公司</button>
 {owners.length?<div className="record-list">{owners.map(owner=><button className="record-card" key={owner.ownerId} disabled={busy} onClick={()=>void choose(owner)}><div><span className="record-kind">{owner.subjectType==='INDIVIDUAL'?'个人合作商':'企业合作商'}</span><span className="tag">已绑定 · 只读查看</span></div><h3>{owner.name}</h3><p>{typeof owner.vehicleCount==='number'?`${owner.vehicleCount} 辆合作车辆`:'查看合作车辆与分润'}</p><span className="record-action">进入公司<span aria-hidden="true">↗</span></span></button>)}</div>:<div className="empty"><h2>暂无可访问的公司</h2><p>请接受公司邀请或联系运营核对查看权限。</p></div>}<p className="fineprint">每家公司分别确认绑定。登录有效至 {dateTime(session.expiresAt)}。</p></section>}
 </>}</main><footer className="footer"><p>宁达汽车 · 企业服务</p><p>合作资料由平台运营维护</p>{documents.length>0&&<div><button className="inline-link" onClick={()=>openLegal('terms')}>服务协议</button><span>·</span><button className="inline-link" onClick={()=>openLegal('privacy')}>隐私政策</button></div>}</footer>{legal&&<LegalDialog document={legal} close={()=>setLegal(null)}/>}</div>;
}

export function OwnerApp(){return <PartnerApp/>;}
