import {BoundEvidenceReader,evidenceSelection} from './legal-evidence';
import { useEffect, useLayoutEffect, useState } from 'react';
import type { BusinessAuthority, LegalTask } from './legal-client';
import { authorityConfirmation, LegalClient } from './legal-client';
import { dateTime } from './model';
export function LegalAuthorities({ api, ownerId, sessionBinding, task, busy, onAction }: {
    api: LegalClient;
    ownerId: string;
    sessionBinding:string;
    task: LegalTask | null;
    busy: boolean;
    onAction: (path: string, body: unknown) => Promise<void>;
}) {
    const base = `/owners/${ownerId}`, [items, setItems] = useState<BusinessAuthority[]>([]), [technical, setTechnical] = useState<{
        id: string;
        status: string;
    }[]>([]), [error, setError] = useState('');
    const [provider, setProvider] = useState(''), [fileId, setFileId] = useState(''), [fileHash, setFileHash] = useState(''), [scope, setScope] = useState(''), [from, setFrom] = useState(''), [until, setUntil] = useState(''), [accepted, setAccepted] = useState(false), [proof, setProof] = useState<{url:string;selection:string;sha256:string;ticket:number} | null>(null);
    const [reader]=useState(()=>new BoundEvidenceReader());
    const selection=evidenceSelection({ownerId,sessionBinding,taskId:task?.id||'',taskRevision:task?.revision??-1,sourceHash:task?.sourceSha256||'',grantId:task?.grant?.id||'',grantRevision:task?.grant?.revision??-1,grantSourceHash:task?.grant?.sourceHash||'',fileId});
    useLayoutEffect(()=>{
        reader.select(selection);
        setProof(null);setAccepted(false);
        return ()=>reader.invalidate();
    },[reader,selection,api]);
    const visibleProof=proof?.selection===selection?proof:null;
    const currentOriginal=reader.matches(visibleProof,selection,fileHash);
    const platform = task?.frozenSources.parties.PLATFORM?.id === ownerId;
    useEffect(() => { let active = true; setItems([]); setAccepted(false); setProof(null); setError(''); void Promise.all([api.request<{
            items: BusinessAuthority[];
        }>(`${base}/electronic-documents/authorities/list`), api.request<{
            id: string;
            status: string;
        }[]>(`${base}/authorities`)]).then(([a, t]) => { if (active) {
        setItems(a.items);
        setTechnical(t);
    } }).catch(e => { if (active)
        setError(e.message); }); return () => { active = false; }; }, [api, base, sessionBinding,task?.revision, task?.id, busy]);
    useEffect(() => () => { if (proof)
        URL.revokeObjectURL(proof.url); }, [proof]);
    async function original() {
        setError('');setProof(null);setAccepted(false);
        try {
            const current=await reader.read(selection,()=>api.request<Blob>(`${base}/internal-evidence/${fileId}`));
            if(current)setProof({url:URL.createObjectURL(current.blob),selection:current.selection,sha256:current.sha256,ticket:current.ticket});
        }catch(error){setError((error as Error).message);}
    }
    async function confirm() { setError(''); try {
        if (!task || !accepted || platform && !reader.matches(visibleProof,selection,fileHash))
            throw Error('请先阅读全文、原始依据并明确确认');
        await onAction(`${base}/electronic-documents/authorities/confirm`, authorityConfirmation(task, provider, platform ? { fileId, hash: fileHash, sourceHash: scope, from, until } : undefined));
        setAccepted(false);
    }
    catch (e) {
        setError((e as Error).message);
    } }
    return <section className="state-card">
<h2>独立用印授权</h2>
<p>约定谁能在什么范围内用章，与主合作协议分别签署归档。仅主订阅合同可申请自动用印，其他协议由本人逐份签署。</p>
 {error && <p role="alert">{error}
</p>}
 {items.map(item => <article className="state-card" key={item.id}>
<p>{item.enabled ? '已启用' : '已暂停'} · {item.reviewed ? '运营已核验' : '待运营核验'}
</p>
<p>实际订单适用性仍需逐单核对</p>{item.internalApplicability && <p>北京时间签发期 {dateTime(item.internalApplicability.signingValidFrom)} 至 {dateTime(item.internalApplicability.signingValidUntil)}
</p>}
<p>{item.readinessReasons.join(' · ')}
</p>
<button className="secondary" disabled={busy || !item.enabled && !item.reviewed} onClick={() => void onAction(`${base}/electronic-documents/authorities/${item.id}/switch`, { revision: item.revision, scopeHash: item.scopeHash, enabled: !item.enabled, idempotencyKey: crypto.randomUUID() })}>{item.enabled ? '本人暂停' : '本人启用'}
</button>
</article>)}
 {task?.signaturePolicy==='MANUAL_ONLY'?<p>{task.grant?.archivedAt?'测试授权文书已归档。':''}本轮逐份签署，请核对并亲自签署测试合同。</p>:task?.grant?.archivedAt && !task.grant.revokedAt && !items.some(item=>item.grantId===task.grant?.id) ? <fieldset disabled={busy}>
<legend>本人确认本版独立授权</legend>
<label className="field">本企业渠道授权<select value={provider} onChange={e => { setProvider(e.target.value); setAccepted(false); }}>
<option value="">请选择本人已办理的渠道授权</option>{technical.map(t => <option key={t.id} value={t.id}>{t.id} · {t.status}
</option>)}
</select>
</label>
 {platform && <>
<p>宁达自身原始内部授权须覆盖本版完整冻结范围，签发期独立输入。部分覆盖请逐份手工签署。</p>
<label className="field">已登记原始依据文件 ID<input value={fileId} onChange={e => { reader.invalidate();setFileId(e.target.value); setProof(null); setAccepted(false); }}/>
</label>
<button type="button" onClick={() => void original()}>查看受保护原始依据</button>{visibleProof && <iframe title="宁达原始内部授权全文" src={visibleProof.url}/>}
<p className="fineprint">已读取原始凭据摘要：{visibleProof?.sha256||'尚未读取当前文件'}</p>
<label className="field">原始文件 SHA256<input value={fileHash} onChange={e => { setFileHash(e.target.value); setAccepted(false); }}/>
</label>
<label className="field">明确输入完整冻结范围摘要<input value={scope} onChange={e => { setScope(e.target.value); setAccepted(false); }}/>
</label>
<p className="fineprint">本版摘要：{task.grant.sourceHash}
</p>
<label className="field">独立签发起时（北京时间）<input type="datetime-local" value={from} onChange={e => { setFrom(e.target.value); setAccepted(false); }}/>
</label>
<label className="field">独立签发止时（北京时间）<input type="datetime-local" value={until} onChange={e => { setUntil(e.target.value); setAccepted(false); }}/>
</label>
</>}
<label className="check">
<input type="checkbox" disabled={platform&&!currentOriginal} checked={accepted} onChange={e => setAccepted(e.target.checked)}/>本人已阅读全文并确认完整冻结范围{platform ? '及原始内部依据和独立签发有效期' : ''}
</label>
<button className="secondary" disabled={!accepted || !provider || platform && !currentOriginal} onClick={() => void confirm()}>本人确认，等待运营核验</button>
</fieldset> : <p>请先在合同与协议中选择已签署归档且未撤销的独立用印授权，再确认范围。重新授权请联系运营准备新版本。</p>}
</section>;
}
