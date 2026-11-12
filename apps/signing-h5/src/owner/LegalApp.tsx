import {LegalDialog} from './Common';
import {LegalSeal} from './LegalSeal';
import type {OwnerSummary} from './model';
import {legalReturnKey,legalReturnReference,providerReturnReference,returnRefresh} from './legal-return';
import './legal.css';
import { LegalTechnical } from './LegalTechnical';
import { useEffect, useRef, useState } from 'react';
import { LegalClient } from './legal-client';
import type { LegalSession, LegalTask } from './legal-client';
import type { LegalDocument, OwnerDetail } from './model';
import { certificationPayload, dateTime, providerUrl, verificationDocumentTypes } from './model';
import { LegalAuthorities } from './LegalAuthorities';
import {LegalDocumentList,LegalTaskDetail} from './LegalDocuments';
export function LegalApp({session,companies,onExpired}:{session:LegalSession;companies:Pick<OwnerSummary,"ownerId"|"name"|"verificationDisplay">[];onExpired:()=>void}) {
    const [api] = useState(() => {const client=new LegalClient();client.setCsrf(session.csrfToken);return client;}), [ownerId, setOwnerId] = useState(''), [detail, setDetail] = useState<OwnerDetail | null>(null);
    const [tab,setTab]=useState(0),[legal,setLegal]=useState<LegalDocument|null>(null);
    const tabs=['实名与印章','合同与协议','自动用印'];
    const [documents,setDocuments]=useState<LegalDocument[]>([]),[identityConsent,setIdentityConsent]=useState(false);
    const [tasks, setTasks] = useState<LegalTask[]>([]), [task, setTask] = useState<LegalTask | null>(null), [page, setPage] = useState(1), [total, setTotal] = useState(0), [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(''), [taskView,setTaskView]=useState(0),[departure,setDeparture]=useState<{url:string;label:string}|null>(null);
    const epoch = useRef(0), lock = useRef(false), leaving=useRef(false), pendingReturn=useRef<string|null>(null), focusTask=useRef(false), base = `/owners/${ownerId}`;
    useEffect(()=>{
      let active=true;void api.request<{documents:LegalDocument[]}>('/legal-signing').then(v=>{if(active&&!leaving.current){setDocuments(v.documents);setIdentityConsent(false);}}).catch(e=>{if(active&&!leaving.current)setError(e.message);});
      const raw=sessionStorage.getItem(legalReturnKey),returning=legalReturnReference(raw,session.owners.map(o=>o.ownerId),session.sessionBinding);
      pendingReturn.current=returning?raw:null;
      if(returning)location.hash=`/legal/${returning.ownerId}${returning.taskId?'/'+returning.taskId:''}`;
      const saved=/^#\/legal\/([A-Za-z0-9_-]+)/.exec(location.hash)?.[1];if(saved&&session.owners.some(o=>o.ownerId===saved))setOwnerId(saved);
      return()=>{active=false;epoch.current++;api.clear();};
    },[api,session]);
    useEffect(() => { const timer = setTimeout(() => { epoch.current++; api.clear(); onExpired(); setDetail(null); setTasks([]); setTask(null); setError('登录已到期，请重新登录'); }, Math.max(0, Math.min(2147483647, Date.parse(session.expiresAt) - Date.now()))); return () => clearTimeout(timer); }, [session, api,onExpired]);
    useEffect(()=>{
      const resume=(event:PageTransitionEvent)=>{if(!event.persisted||!leaving.current)return;leaving.current=false;setDeparture(null);lock.current=false;setBusy(false);pendingReturn.current=sessionStorage.getItem(legalReturnKey);setRefresh(v=>v+1);};
      window.addEventListener('pageshow',resume);return()=>window.removeEventListener('pageshow',resume);
    },[]);
    useEffect(() => {
        if (!ownerId||leaving.current)
            return;
        const ticket = ++epoch.current;
        setDetail(null);
        setTasks([]);
        setTask(null);
        setIdentityConsent(false);
        setError('');
        setBusy(true);
        void Promise.all([api.request<OwnerDetail>(base), api.request<{
                items: LegalTask[];
                total: number;
            }>(`${base}/electronic-documents?page=${page}&pageSize=20`)]).then(async ([d, t]) => { if (ticket !== epoch.current||leaving.current)
            return; setDetail(d); setTasks(t.items); setTotal(t.total); const selected = /^#\/legal\/[^/]+\/([A-Za-z0-9_-]+)/.exec(location.hash)?.[1]; if (selected)
            await api.request<LegalTask>(`${base}/electronic-documents/${selected}`).then(v => { if (ticket === epoch.current&&!leaving.current)
                {setTask(v); setTab(1);} }).catch(e => { if (ticket === epoch.current&&!leaving.current)
                setError(e.message); }); }).catch(e => { if (ticket === epoch.current)
            {setError(e.message);if(e.name==='LEGAL_SESSION_EXPIRED')onExpired();} }).finally(() => { if (ticket === epoch.current)
            setBusy(false); });
        return () => { epoch.current++; };
    }, [api, base, ownerId, page, refresh]);
    useEffect(()=>{
        if(!detail||busy||lock.current||leaving.current)return;
        const command=returnRefresh(pendingReturn.current,{ownerId,sessionBinding:session.sessionBinding,taskId:task?.id,taskRevision:task?.revision,departing:leaving.current});
        if(!command)return;
        pendingReturn.current=null;
        sessionStorage.removeItem(legalReturnKey);
        void action(command.path,command.body);
    },[session,detail,task,base,ownerId,busy]);
    useEffect(()=>{
        if(!task||!focusTask.current)return;
        focusTask.current=false;
        const heading=document.getElementById('legal-current-document');
        heading?.focus({preventScroll:true});heading?.scrollIntoView({block:'start',behavior:'smooth'});
    },[task]);
    async function work(fn: () => Promise<void>) { if (lock.current||leaving.current)
        return; lock.current = true; setBusy(true); setError(''); const ticket = epoch.current; try {
        await fn();
    }
    catch (e) {
        if (ticket === epoch.current&&!leaving.current) {
            setError((e as Error).message);
            setTaskView(v=>v+1);setIdentityConsent(false);
            if((e as Error).name==='LEGAL_SESSION_EXPIRED'){epoch.current++;onExpired();setOwnerId('');setDetail(null);setTasks([]);setTask(null);}
        }
    }
    finally {
        lock.current = false;
        if(!leaving.current)setBusy(false);
    } }
    async function select(id: string) { await work(async () => { setTask(null); const ticket = epoch.current; const value = await api.request<LegalTask>(`${base}/electronic-documents/${id}`); if (ticket !== epoch.current)
        return; focusTask.current=true;setTask(value);setTasks(items=>items.map(item=>item.id===value.id?value:item)); location.hash = `/legal/${ownerId}/${id}`; }); }
    async function action(path: string, body: unknown) { await work(async () => { const ticket = epoch.current; const result = await api.request<{
        url?: string;id?:string;
    }>(path, body); if (ticket !== epoch.current)
        return; setIdentityConsent(false); if (result?.url){
        const url=providerUrl(result.url),reference=providerReturnReference(path,result,{ownerId,sessionBinding:session.sessionBinding,taskId:task?.id,taskRevision:task?.revision});
        sessionStorage.setItem(legalReturnKey,JSON.stringify(reference));
        leaving.current=true;epoch.current++;api.cancelPending();setTaskView(v=>v+1);setError('');setDeparture({url,label:/\/(sign|accept)$/.test(path)?'正在前往签署':'正在前往办理页面'});
        try{location.assign(url);}catch{leaving.current=false;setDeparture(null);sessionStorage.removeItem(legalReturnKey);setError('未能打开办理页面，请重试。');}
        return;
        } setTask(null);setRefresh(v=>v+1); }); }
    const identity=detail?.verificationDisplay?.identity;
    const completed=identity?.complete===true;
    const continuable=!completed&&identity?.state==='PENDING'&&identity.currentAttempt===true&&detail?.capabilities.canStartVerification===true;
    const startable=!completed&&detail?.capabilities.canStartVerification===true&&(!identity||['NOT_STARTED','FAILED','REAUTH_REQUIRED'].includes(identity.state));
    function back(){epoch.current++;api.cancelPending();pendingReturn.current=null;focusTask.current=false;setOwnerId('');setDetail(null);setTask(null);setTasks([]);setIdentityConsent(false);setTab(0);location.hash='';}
    if(departure)return <section className="legal-app partner-workspace simple-workspace"><div className="state-card" role="status"><h2>{departure.label}…</h2><p>请在法大大页面完成办理，返回后核对当前文件状态。</p><a className="secondary" href={departure.url}>继续前往</a></div></section>;
    return <section className="legal-app partner-workspace simple-workspace">
{error&&<p role="alert">{error}<button className="secondary" onClick={()=>{setIdentityConsent(false);setRefresh(v=>v+1);}}>重新读取</button></p>}
{!ownerId?<><h1>我的公司</h1><div className="record-list">{companies.map(c=><button className="record-card" key={c.ownerId} onClick={()=>{epoch.current++;setOwnerId(c.ownerId);setTab(0);location.hash=`/legal/${c.ownerId}`;setPage(1);}}><span className="record-kind">企业合作商</span><h3>{c.name}</h3><p>{c.verificationDisplay?.identity?.complete?'企业认证已完成':c.verificationDisplay?.label||'待核验'} · {c.verificationDisplay?.seal?.label||'印章待核验'}</p><span className="record-action">进入公司 ↗</span></button>)}</div></>:<button className="text-button" onClick={back}>返回公司列表</button>}
{detail&&<><header className="legal-company"><h1>{detail.name}</h1><p>统一社会信用代码 {detail.creditCode||'未登记'}</p><p>法人 {detail.legalRepresentative.name} · {detail.legalRepresentative.maskedMobile}</p><span className="tag">{completed?'企业认证已完成':detail.verificationDisplay?.label||'待核验'}</span> <span className="tag">{detail.seals.some(s=>s.status==='ACTIVE')?'印章已启用':'待确认印章'}</span></header>
<div className="partner-tabs company-tabs" role="tablist" aria-label="企业办理阶段">{tabs.map((label,index)=><button key={label} id={`legal-tab-${index}`} role="tab" aria-selected={tab===index} aria-current={tab===index?'page':undefined} aria-controls={`legal-panel-${index}`} tabIndex={tab===index?0:-1} onClick={()=>{setTab(index);setIdentityConsent(false);}} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?2:(index+(e.key==='ArrowRight'?1:2))%3;setTab(next);setIdentityConsent(false);document.getElementById(`legal-tab-${next}`)?.focus();}}}>{label}</button>)}</div>
<section role="tabpanel" id="legal-panel-0" aria-labelledby="legal-tab-0" hidden={tab!==0} className="state-card">
<h2>{completed?'企业认证已完成':identity?.state==='REAUTH_REQUIRED'?'资料已变更，需重新认证':'企业实名认证'}</h2>{identity?.state==='REAUTH_REQUIRED'&&<><p>企业或法人认证材料已变更。原证明仅保留为历史记录，新签署和自动用印已暂停，请按当前资料重新认证。</p>{identity.previous&&<p>历史认证资料：{identity.previous.companyName} · 法人 {identity.previous.legalName} · 保存时间 {dateTime(identity.previous.capturedAt)}</p>}</>}
{completed?<><p>完成时间 {dateTime(identity?.verifiedAt)}</p><p>{detail.seals.some(s=>s.status==='ACTIVE')?(detail.readyForSigning?'下一步：进入合同与协议，查看待办并逐份签署。':'下一步：查询更新证书与印章状态，保留当前已启用印章。'):'下一步：核对企业印模并确认选用。签署证书需要更新时，请查询更新状态。'}</p></>:<p>{identity?.state==='PENDING'||identity?.state==='PROCESSING'?'认证办理中，请查询现有认证结果，不会自动重复创建。':identity?.state==='FAILED'?'上次认证未通过，请重新阅读说明并明确同意后重试。':'请由当前登记法人本人阅读认证说明并办理。'}</p>}
<p>{detail.verificationDisplay?.message}</p>
<button className="secondary" disabled={busy||!detail.capabilities.canRefreshVerification} onClick={()=>void action(`${base}/refresh`,{})}>查询更新企业、证书及印章</button>
{!completed&&!detail.capabilities.canRefreshVerification&&!startable&&<p>当前认证结果需核对，请联系运营查询已有认证任务。</p>}
{(startable||continuable)&&<><div className="legal-links">{documents.filter(d=>verificationDocumentTypes.includes(d.type)).map(d=><button className="inline-link" key={d.id} onClick={()=>setLegal(d)}>{({terms:'服务协议',privacy:'隐私政策','owner-identity':'企业认证说明'} as Record<string,string>)[d.type]}</button>)}</div>
<label className="check"><input type="checkbox" checked={identityConsent} onChange={e=>setIdentityConsent(e.target.checked)}/>本人已阅读上述认证文案并同意办理</label>
{!documents.some(d=>d.type==='owner-identity')&&<p role="alert">企业认证说明尚未发布，暂不能办理实名。请联系运营。</p>}
<button className="primary" disabled={busy||!verificationDocumentTypes.every(t=>documents.some(d=>d.type===t))||!identityConsent||!detail.capabilities.canStartVerification} onClick={()=>void action(`${base}/verification`,certificationPayload(Object.fromEntries(verificationDocumentTypes.map(t=>[t,true])),documents))}>{continuable?'继续当前企业认证':identity?.state==='REAUTH_REQUIRED'?'按新资料重新认证':'本人办理企业认证'}</button>{continuable&&<p>查询并重新打开当前认证页面，继续原任务，不新建认证任务。</p>}</>}
<h2 className="legal-step-heading">企业印章</h2>
{detail.seals.some(s=>['ACTIVE','DISCOVERED'].includes(s.status))?<div className="seal-list">{detail.seals.filter(s=>['ACTIVE','DISCOVERED'].includes(s.status)).map(seal=><LegalSeal key={JSON.stringify([session.sessionBinding,ownerId,seal.id,seal.imageHash])} api={api} ownerId={ownerId} seal={seal} canSelect={detail.capabilities.canSelectSeal} busy={busy} onSelect={()=>void action(`${base}/seal`,{sealId:seal.id,imageHash:seal.imageHash})}/>)}</div>:<p>尚未发现可用印章，请查询更新企业与证书状态，再核对印章。</p>}
</section></>}
 {detail && <>
<div role="tabpanel" id="legal-panel-1" aria-labelledby="legal-tab-1" hidden={tab!==1}>
<section className="state-card">
<h2>合同与协议</h2>
<p>每份文件分别展示各方签署进度与归档状态。</p>{!tasks.length&&<div className="empty"><h3>暂无合同与协议</h3><p>平台准备好文件后会显示在这里。</p></div>}<LegalDocumentList tasks={tasks} selected={task?.id} busy={busy} onSelect={id=>void select(id)}/>
{total>20&&<div className="partner-pagination">
<button className="secondary" disabled={busy || page === 1} onClick={() => setPage(v => v - 1)}>上一页</button>
<span>{page} / {Math.max(1, Math.ceil(total / 20))}
</span>
<button className="secondary" disabled={busy || page * 20 >= total} onClick={() => setPage(v => v + 1)}>下一页</button>
</div>}
</section>
 {task&&<LegalTaskDetail key={JSON.stringify([session.sessionBinding,ownerId,task.id,task.revision,task.sourceSha256,taskView])} task={task} api={api} ownerId={ownerId} sessionBinding={session.sessionBinding} busy={busy} onAction={action} onExpired={onExpired}/>}
</div>
{tab===2&&<div role="tabpanel" id="legal-panel-2" aria-labelledby="legal-tab-2">{detail.authorizationScopeVersion!==3&&<p className="partner-note">可继续逐份电子签署，也可办理自动签授权。</p>}
{detail.authorizationScopeVersion!==3&&<LegalAuthorities key={ownerId} api={api} ownerId={ownerId} sessionBinding={session.sessionBinding} task={task} busy={busy} onAction={action}/>}
<LegalTechnical key={`${ownerId}-${refresh}`} documents={documents} api={api} detail={detail} busy={busy} onAction={action} onExpired={onExpired}/></div>}
</>}
{legal&&<LegalDialog document={legal} close={()=>setLegal(null)}/>}
</section>;
}
