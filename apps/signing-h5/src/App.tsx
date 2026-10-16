import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiError, Client } from './client';
import { dateTime, externalUrl, filePath, kindLabels, navigation, recordPath, signingPayload, statusLabel, verificationPayload } from './model';
import type { LegalDocument, Readiness, Session, SigningRecord } from './model';

const api=new Client();
type Config={enabled:boolean;mode:'SERVICE_ACCOUNT_H5';entryUrl:string;signProviderConfigured?:boolean};
const fallbackError=(error:unknown)=>error instanceof Error?error.message:'操作未完成，请稍后重试。';
function Notice({children,tone='error'}:{children:ReactNode;tone?:'error'|'info'|'success'}){return <div className={`notice ${tone}`} role={tone==='error'?'alert':'status'}>{children}</div>;}
function Modal({title,close,children}:{title:string;close:()=>void;children:ReactNode}){
 const element=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null; const alreadyOpen=document.body.classList.contains('modal-open');document.body.classList.add('modal-open');
  element.current?.focus();
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){
   const elements=[...(element.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')||[])];
   const first=elements[0],last=elements.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===element.current)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }};document.addEventListener('keydown',key);return()=>{if(!alreadyOpen)document.body.classList.remove('modal-open');document.removeEventListener('keydown',key);previous?.focus();};
 },[close]);
 return <div className="modal-backdrop"><div className="modal" ref={element} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="关闭文案" onClick={close}>×</button></div>{children}</div></div>;
}
function LegalText({documents,type,onClose}:{documents:LegalDocument[];type:string;onClose:()=>void}){
 const doc=documents.find(d=>d.type===type);
 return <Modal title={type==='privacy'?'隐私政策':'服务协议'} close={onClose}>{doc?<><p className="eyebrow">当前已发布版本 · v{doc.version}</p><h3>{doc.title}</h3><div className="document-body">{doc.content}</div></>:<Notice>当前文案未能加载，请关闭后重新加载。暂时无法登录。</Notice>}</Modal>;
}
function Login({documents,busy,error,onLogin,onRequest,onLegal}:{documents:LegalDocument[];busy:string;error:string;onLogin:(body:unknown)=>Promise<void>;onRequest:(mobile:string)=>Promise<boolean>;onLegal:(type:string)=>void}){
 const [mobile,setMobile]=useState(''),[code,setCode]=useState(''),[agreed,setAgreed]=useState(false),[validation,setValidation]=useState(''),[sent,setSent]=useState(false),[cooldown,setCooldown]=useState(0);
 useEffect(()=>{if(!cooldown)return;const timer=setTimeout(()=>setCooldown(cooldown-1),1000);return()=>clearTimeout(timer);},[cooldown]);
 const validMobile=()=>{if(!/^1[3-9]\d{9}$/.test(mobile)){setValidation('请输入正确的 11 位手机号。');return false;}setValidation('');return true;};
 async function request(){if(!validMobile())return;if(await onRequest(mobile)){setSent(true);setCooldown(60);}}
 async function login(event:FormEvent){event.preventDefault();if(!validMobile())return;if(!/^\d{6}$/.test(code)){setValidation('请输入 6 位短信验证码。');return;}if(!agreed||!documents.some(d=>d.type==='terms')||!documents.some(d=>d.type==='privacy')){setValidation('请阅读并同意当前服务协议和隐私政策。');return;}setValidation('');await onLogin({mobile,code,consents:documents.map(({id,version})=>({documentId:id,version}))});setCode('');}
 return <section className="login-card"><div className="section-kicker"><span>01</span> 身份确认</div><h1>登录签约中心</h1><p className="muted">使用您在小程序登记的手机号。<br/>这里只处理本人签约事项，不创建新客户账号。</p>
  {(validation||error)&&<Notice>{validation||error}</Notice>}{sent&&<Notice tone="info">验证码请求已提交。若未收到，请稍后重试或联系平台。</Notice>}
  <form onSubmit={login}><label className="field">手机号<input type="tel" inputMode="numeric" autoComplete="tel" maxLength={11} value={mobile} onChange={event=>setMobile(event.target.value.replace(/\D/g,''))} placeholder="请输入手机号" required/></label>
   <label className="field">短信验证码<span className="code-field"><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,''))} placeholder="6 位验证码" required/><button type="button" className="text-button" disabled={!!busy||cooldown>0} onClick={()=>void request()}>{cooldown?`${cooldown} 秒后重试`:'获取验证码'}</button></span></label>
   <label className="check"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} aria-label="我已阅读并同意服务协议和隐私政策"/><span>我已阅读并同意<button type="button" className="inline-link" onClick={()=>onLegal('terms')}>服务协议</button>和<button type="button" className="inline-link" onClick={()=>onLegal('privacy')}>隐私政策</button></span></label>
   <button className="primary full" disabled={!!busy||!documents.some(d=>d.type==='terms')||!documents.some(d=>d.type==='privacy')}>{busy==='login'?'正在登录…':'登录'}<span aria-hidden="true">↗</span></button>
  </form><p className="fineprint">验证码仅用于本次登录。登录状态最多保留 8 小时；请勿在他人设备保留登录。</p>
 </section>;
}
function Account({readiness,busy,error,note,privacy,onAction,onLegal,close}:{readiness:Readiness|null;busy:string;error:string;note:string;privacy:LegalDocument|undefined;onAction:(action:string,body:unknown)=>Promise<boolean>;onLegal:()=>void;close:()=>void}){
 const [name,setName]=useState(''),[idCardNo,setIdCardNo]=useState(''),[consent,setConsent]=useState(false),[validation,setValidation]=useState('');
 useEffect(()=>{setConsent(false);},[privacy?.id,privacy?.version]);
 async function verify(event:FormEvent){event.preventDefault();if(!consent){setValidation('请先阅读并确认实名认证用途。');return;}if(name.trim().length<2||!/^\d{17}[\dXx]$/.test(idCardNo)){setValidation('请填写真实姓名与有效的 18 位身份证号码。');return;}setValidation('');try{const input=verificationPayload(name,idCardNo,consent,privacy);setIdCardNo('');await onAction('verify',input);}catch(e){setValidation(fallbackError(e));}}
 return <Modal title="实名签约准备" close={close}><p className="muted">实名认证和签署证书由法大大核验。平台只根据可信查询结果显示状态。</p>
  {error&&<Notice>{error}</Notice>}{note&&<Notice tone="success">{note}</Notice>}
  {!readiness?<p role="status">正在读取实名状态…</p>:<><div className="readiness-grid"><div><span>实名状态</span><strong>{statusLabel(readiness.realNameStatus)}</strong></div><div><span>证书状态</span><strong>{readiness.certBound?'已绑定':'待核验'}</strong></div></div>
   <Notice tone="info">{readiness.signingEligible?'实名与证书已就绪。具体文件仍须满足运营复核及当前签署条件。':readiness.nextAction==='REGISTER_PROVIDER_ACCOUNT'?'请先建立本人实名签约账户，然后进行实名认证。':readiness.nextAction==='START_REALNAME_VERIFICATION'?'请完成本人实名认证；已在外部页面操作后，可点击查询实名与证书状态。':'请查询实名与证书状态，未核实前无法进入签署。'}</Notice>
   {readiness.nextAction==='REGISTER_PROVIDER_ACCOUNT'&&<button className="primary full" disabled={!!busy} onClick={()=>void onAction('register',{})}>建立实名签约账户 <span aria-hidden="true">↗</span></button>}
   {readiness.nextAction==='START_REALNAME_VERIFICATION'&&<form onSubmit={verify}><div className="purpose"><h3>实名认证用途</h3><p>您的真实姓名、身份证号码及已绑定手机号将提交给法大大，用于本人身份核验及电子签署证书准备。拒绝仅影响实名认证和电子签约，不影响浏览和已有合同查询。请由本人操作，并先阅读平台隐私政策。</p><button type="button" className="inline-link" onClick={onLegal}>阅读隐私政策{privacy?` · v${privacy.version}`:''}</button></div>
    {validation&&<Notice>{validation}</Notice>}
    <label className="field">真实姓名<input autoComplete="off" value={name} onChange={e=>setName(e.target.value)} maxLength={50} required/></label>
    <label className="field">身份证号码<input autoComplete="off" spellCheck={false} value={idCardNo} onChange={e=>setIdCardNo(e.target.value.trim())} maxLength={18} required/></label>
    <label className="check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>我已阅读实名用途及隐私政策，由本人发起核验</span></label><button className="primary full" disabled={!!busy||!privacy}>前往实名认证 <span aria-hidden="true">↗</span></button>
   </form>}
   <button className="secondary full" disabled={!!busy} onClick={()=>void onAction('refresh',{})}>{busy==='account-refresh'?'正在查询…':'查询实名与证书状态'}</button>
  </>}
 </Modal>;
}
function RecordDetail({record,busy,onBack,onAccount,onSign,onSync,read,setRead}:{record:SigningRecord;busy:string;onBack:()=>void;onAccount:()=>void;onSign:()=>void;onSync:()=>void;read:boolean;setRead:(value:boolean)=>void}){
 const eligible=record.canSign===true&&record.readiness?.signingEligible===true;
 return <article className="detail"><button className="back-link" onClick={onBack} disabled={!!busy}>← 返回我的签约</button><div className="detail-heading"><span className="section-kicker">{kindLabels[record.kind]}</span><span className={`tag ${record.status==='SIGNED'?'done':''}`}>{statusLabel(record.status)}</span></div><h1>{record.title}</h1><p className="muted">核对本次文件与状态，再由本人完成签署。</p>
  <dl className="facts"><div><dt>记录编号</dt><dd>{record.id}</dd></div><div><dt>创建时间</dt><dd>{dateTime(record.createdAt)}</dd></div>{record.actualAt&&<div><dt>实际交接时间</dt><dd>{dateTime(record.actualAt)}</dd></div>}{record.revision!==undefined&&<div><dt>当前业务版本</dt><dd>v{record.revision}</dd></div>}</dl>
  <div className="file-section"><div className="section-title"><h2>签署文件</h2><span>以当前版本为准</span></div>
   {record.sourceFileId?<a className="file-link" href={filePath(record.sourceFileId)} target="_blank" rel="noopener noreferrer"><span className="file-symbol">PDF</span><span><strong>签署前审核稿</strong><small>查看 / 下载本人当前文件</small></span><span aria-hidden="true">↗</span></a>:<Notice tone="info">审核稿暂未就绪，请等待运营完成签前准备。</Notice>}
   {record.signedFileId&&<a className="file-link" href={filePath(record.signedFileId)} target="_blank" rel="noopener noreferrer"><span className="file-symbol">PDF</span><span><strong>已签署归档稿</strong><small>查看 / 下载服务端核验文件</small></span><span aria-hidden="true">↗</span></a>}
   {record.body&&<details className="body-details"><summary>阅读本次合同正文</summary><div className="document-body">{record.body}</div></details>}
   {record.documentHash&&<details className="hash-details"><summary>查看文件摘要</summary><code>{record.documentHash}</code></details>}
  </div>
  <div className="status-section"><h2>签约准备</h2><div className="readiness-line"><span className={`status-dot ${record.readiness?.signingEligible?'ready':''}`}/><span>{record.readiness?.signingEligible?'实名与证书已就绪':'实名与证书待核验'}</span><button className="inline-link" onClick={onAccount} disabled={!!busy}>查看实名准备</button></div>
   {!!record.blockers?.length&&<Notice tone="info"><ul>{record.blockers.map((blocker,index)=><li key={index}>{blocker}</li>)}</ul></Notice>}
   {!record.canSign&&!record.blockers?.length&&record.status!=='SIGNED'&&<p className="muted">当前记录暂不可签署，请查询最新状态或返回小程序处理待办。</p>}
  </div>
  <div className="action-panel">{eligible&&<><label className="check"><input type="checkbox" checked={read} onChange={e=>setRead(e.target.checked)}/><span>我已阅读本次签署文件</span></label><button className="primary full" disabled={!!busy||!read} onClick={onSign}>{busy==='sign'?'正在获取签署入口…':'前往签署'}<span aria-hidden="true">↗</span></button><p className="fineprint">将前往法大大签署页面。返回后请查询状态，页面跳转不代表签署完成。</p></>}
   {record.canSync&&<button className="secondary full" disabled={!!busy} onClick={onSync}>{busy==='sync'?'正在查询…':'查询签署状态'}</button>}
  </div>
 </article>;
}
export function App(){
 const [phase,setPhase]=useState<'loading'|'ready'|'failed'>('loading'),[config,setConfig]=useState<Config|null>(null),[documents,setDocuments]=useState<LegalDocument[]>([]),[session,setSession]=useState<Session|null>(null);
 const [records,setRecords]=useState<SigningRecord[]>([]),[record,setRecord]=useState<SigningRecord|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[note,setNote]=useState(''),[read,setRead]=useState(false),[listLoading,setListLoading]=useState(false);
 const [accountOpen,setAccountOpen]=useState(false),[readiness,setReadiness]=useState<Readiness|null>(null),[legal,setLegal]=useState<string|null>(null);
 const active=useRef(0),authEpoch=useRef(0),running=useRef(false),initial=useRef(navigation(location.search));const returning=location.pathname.endsWith('/return/');
 const fail=useCallback((value:unknown)=>{setError(fallbackError(value));setNote('');if(value instanceof ApiError&&value.status===401){api.clear();authEpoch.current++;running.current=false;setBusy('');setSession(null);setRecords([]);setRecord(null);setReadiness(null);setAccountOpen(false);setRead(false);active.current++;}},[]);
 const boot=useCallback(async()=>{setPhase('loading');setError('');try{
  const settings=await api.request<Config>('/config');setConfig(settings);if(!settings.enabled){setSession(null);setPhase('ready');return;}
  const [law,current]=await Promise.all([api.request<{documents:LegalDocument[]}>('/legal'),api.request<Session>('/auth/me').catch(e=>{if(e instanceof ApiError&&e.status===401)return null;throw e;})]);
  setDocuments(law.documents);if(current){api.setCsrf(current.csrfToken);setSession(current);}setPhase('ready');
 }catch(e){fail(e);setPhase('failed');}},[fail]);
 useEffect(()=>{const selected=initial.current;history.replaceState(null,'',location.pathname+(selected?`?kind=${selected.kind}&id=${encodeURIComponent(selected.id)}`:''));void boot();},[boot]);
 const list=useCallback(async()=>{const epoch=authEpoch.current;setListLoading(true);try{const data=await api.request<{items:SigningRecord[]}>('/records');if(epoch===authEpoch.current)setRecords(data.items);}catch(e){if(epoch===authEpoch.current)fail(e);}finally{if(epoch===authEpoch.current)setListLoading(false);}},[fail]);
 const open=useCallback(async(item:Pick<SigningRecord,'kind'|'id'>)=>{const request=++active.current;setBusy('detail');setError('');setNote('');setRead(false);setRecord(null);try{const data=await api.request<SigningRecord>(recordPath(item));if(request===active.current){setRecord(data);history.replaceState(null,'',location.pathname+`?kind=${data.kind}&id=${encodeURIComponent(data.id)}`);}}catch(e){if(request===active.current)fail(e);}finally{if(request===active.current)setBusy('');}},[fail]);
 useEffect(()=>{if(!session)return;void list();if(initial.current){const selected=initial.current;initial.current=null;void open(selected);}},[session,list,open]);
 useEffect(()=>{if(!session)return;const delay=new Date(session.expiresAt).getTime()-Date.now();const timer=setTimeout(()=>fail(new ApiError(401,'SESSION_EXPIRED','登录已过期，请重新登录。')),Math.min(Math.max(delay,0),2147483647));return()=>clearTimeout(timer);},[session,fail]);
 async function run<T>(name:string,work:()=>Promise<T>):Promise<T|undefined>{if(busy||running.current)return;const epoch=authEpoch.current;running.current=true;setBusy(name);setError('');setNote('');try{const value=await work();return epoch===authEpoch.current?value:undefined;}catch(e){if(epoch===authEpoch.current)fail(e);return undefined;}finally{if(epoch===authEpoch.current){running.current=false;setBusy('');}}}
 async function login(body:unknown){const next=await run<Session>('login',()=>api.request('/auth/login',body));if(next){authEpoch.current++;api.setCsrf(next.csrfToken);setRecord(null);setRecords([]);setReadiness(null);setSession(next);setError('');}}
 async function sms(mobile:string){const result=await run('sms',()=>api.request('/auth/sms/request',{mobile}));return result!==undefined;}
 async function logout(){const result=await run('logout',()=>api.request('/auth/logout',{}));if(result!==undefined){authEpoch.current++;active.current++;api.clear();setSession(null);setRecords([]);setRecord(null);setReadiness(null);setAccountOpen(false);setNote('已退出本次签约登录。');history.replaceState(null,'',location.pathname);}}
 async function showAccount(){setAccountOpen(true);setError('');setNote('');const data=await run<Readiness>('account-readiness',()=>api.request('/account/readiness'));if(data)setReadiness(data);}
 async function accountAction(action:string,body:unknown){const epoch=authEpoch.current;const result=await run<Readiness|{redirectUrl:string;status:string}>(`account-${action}`,async()=>{
  if(action==='verify'){const law=await api.request<{documents:LegalDocument[]}>('/legal');if(epoch!==authEpoch.current)throw new ApiError(401,'SESSION_EXPIRED','登录已过期，请重新登录。');const privacy=law.documents.find(d=>d.type==='privacy');const accepted=(body as {consent?:{documentId:string;version:number}}).consent;setDocuments(law.documents);if(!privacy||privacy.id!==accepted?.documentId||privacy.version!==accepted.version)throw new ApiError(409,'CONSENT_VERSION','隐私政策已更新，请重新阅读并确认实名用途。');}
  return api.request(`/account/${action}`,body);
 });if(!result)return false;
  if('redirectUrl'in result){try{location.assign(externalUrl(result.redirectUrl));}catch(e){fail(e);return false;}}
  else{setReadiness(result);setNote('已从服务端查询最新实名准备状态。');if(record){const resource=recordPath(record);const request=active.current;const fresh=await api.request<SigningRecord>(resource).catch(e=>{if(epoch===authEpoch.current)fail(e);return null;});if(fresh&&epoch===authEpoch.current&&request===active.current){setRecord(fresh);setRead(false);}}}return true;
 }
 async function sign(){if(!record)return;const request=active.current;const result=await run<{record:SigningRecord;redirectUrl?:string}>('sign',()=>api.request(`${recordPath(record)}/sign`,signingPayload(record)));if(result&&request===active.current){setRecord(result.record);setRead(false);if(result.redirectUrl){try{location.assign(externalUrl(result.redirectUrl));}catch(e){fail(e);}}else setNote('当前未返回新的签署入口，请查询服务端状态。');}}
 async function sync(){if(!record)return;const request=active.current;const result=await run<SigningRecord>('sync',()=>api.request(`${recordPath(record)}/sync`,signingPayload(record)));if(result&&request===active.current){setRecord(result);setRead(false);setNote('已从服务端查询最新状态。');void list();}}
 const closeAccount=useCallback(()=>setAccountOpen(false),[]),closeLegal=useCallback(()=>setLegal(null),[]);
 function back(){active.current++;setRecord(null);setError('');setNote('');setRead(false);setBusy('');history.replaceState(null,'',location.pathname);void list();}
 return <div className="app"><header className="topbar"><a className="brand" href="/miniapp-sign/" aria-label="纯电主义签约中心"><span className="brand-mark" aria-hidden="true">C</span><span>纯电主义<small>CHUNDIAN · SIGNING</small></span></a>{session&&<button className="logout" disabled={!!busy} onClick={()=>void logout()}>退出登录</button>}</header>
  <main className="main">{phase==='loading'?<section className="state-card" role="status"><span className="loading-mark"/><h1>正在连接签约服务</h1><p>请稍候</p></section>:phase==='failed'?<section className="state-card"><h1>暂时无法打开签约中心</h1><Notice>{error}</Notice><button className="primary" onClick={()=>void boot()}>重新连接</button></section>:!config?.enabled?<section className="state-card"><span className="section-kicker">签约中心</span><h1>签约入口暂未开放</h1><p className="muted">请返回小程序查看业务进度，或稍后重试。</p><button className="secondary" onClick={()=>void boot()}>重新查询</button></section>:<>
   {returning&&<section className="return-card"><div className="section-kicker">签署后查询</div><h2>返回这里，核对真实进度。</h2><p>外部页面返回不代表已完成签署。{session?'请选择对应记录并查询签署状态。':'请先登录，再查询本人签署记录。'}</p><p className="return-instruction">回小程序：我的 → 业务记录，刷新查看最新状态。</p></section>}
   {!session?<Login documents={documents} busy={busy} error={error} onLogin={login} onRequest={sms} onLegal={setLegal}/>:<>
    {config.signProviderConfigured===false&&<Notice tone="info">签约通道尚未完成配置。您仍可查询已有记录；请等待平台开放签署。</Notice>}
    {(error||note)&&<div className="page-feedback">{error&&<Notice>{error}</Notice>}{note&&<Notice tone="success">{note}</Notice>}</div>}
    {record?<RecordDetail record={record} busy={busy} onBack={back} onAccount={()=>void showAccount()} onSign={()=>void sign()} onSync={()=>void sync()} read={read} setRead={setRead}/>:busy==='detail'?<section className="state-card" role="status"><h1>正在读取签署文件</h1></section>:<>
     <section className="hero"><div className="section-kicker">签约中心 <span className="hero-line"/></div><h1>我的签约</h1><p>每一份约定，<br/><span>清楚阅读，由您签署。</span></p><div className="account-summary"><span>当前账户 {session.customer.maskedMobile}</span><button className="inline-link" onClick={()=>void showAccount()} disabled={!!busy}>查看实名准备 ↗</button></div></section>
     <section className="records"><div className="section-title"><h2>本人签约记录</h2><button className="text-button" disabled={listLoading||!!busy} onClick={()=>void list()}>{listLoading?'读取中…':'刷新记录'}</button></div>{listLoading?<p role="status" className="muted">正在读取本人记录…</p>:records.length?<div className="record-list">{records.map(item=><button className="record-card" key={`${item.kind}:${item.id}`} disabled={!!busy} onClick={()=>void open(item)}><div><span className="record-kind">{kindLabels[item.kind]}</span><span className={`tag ${item.status==='SIGNED'?'done':''}`}>{statusLabel(item.status)}</span></div><h3>{item.title}</h3><p>{dateTime(item.createdAt)}</p><span className="record-action">查看文件与进度 <span aria-hidden="true">↗</span></span></button>)}</div>:!error&&<div className="empty"><span className="empty-symbol">—</span><h3>暂无签约记录</h3><p>签署事项准备完成后，会显示在这里。<br/>请返回小程序查看业务进度。</p></div>}</section>
    </>}
   </>}
  </>}
  </main><footer className="footer"><p>上海晓浪网络科技有限公司</p><div><button className="inline-link" onClick={()=>setLegal('terms')}>服务协议</button><span>·</span><button className="inline-link" onClick={()=>setLegal('privacy')}>隐私政策</button></div><p>返回小程序「我的 → 业务记录」刷新进度</p></footer>
  {accountOpen&&session&&!legal&&<Account readiness={readiness} busy={busy} error={error} note={note} privacy={documents.find(d=>d.type==='privacy')} onAction={accountAction} onLegal={()=>setLegal('privacy')} close={closeAccount}/>}
  {legal&&<LegalText documents={documents} type={legal} onClose={closeLegal}/>}
 </div>;
}
