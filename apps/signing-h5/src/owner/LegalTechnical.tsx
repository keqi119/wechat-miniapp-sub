import {LegalDialog} from './Common';
import {PlatformLegalTechnical} from './PlatformLegalTechnical';
import type {ComponentProps} from 'react';
import { useEffect, useState } from 'react';
import { LegalClient, shanghaiSigningInstant,technicalAuthoritySwitch } from './legal-client';
import type { OwnerDetail, LegalDocument } from './model';
function LegacyLegalTechnical({ api, detail, onAction, busy, documents }: {
    api: LegalClient;
    detail: OwnerDetail;
    onAction: (p: string, b: unknown) => Promise<void>;
    busy: boolean;
    documents: LegalDocument[];
}) {
    const [legal,setLegal]=useState<LegalDocument|null>(null);
    const [records, setRecords] = useState<{
        id: string;
        status: string;
        scopeHash: string;
        revision:number;
        enabled:boolean;
    }[]>([]);
    const [options, setOptions] = useState<{
        authorizationMethod: string;
        scopeVersion: number;
        delegates: {
            id: string;
            name: string;
        }[];
        documentKinds: {
            id: string;
            label: string;
        }[];
        authorizationNotice: {
            id: string;
            version: number;
        } | null;
    } | null>(null), [from, setFrom] = useState(''), [until, setUntil] = useState(''), [accepted, setAccepted] = useState(false), [error, setError] = useState('');
    useEffect(() => { let active = true; setOptions(null); setAccepted(false); void api.request<typeof records>(`/owners/${detail.id}/authorities`).then(v => { if (active)
        setRecords(v); }).catch(e => { if (active)
        setError(e.message); }); api.request<typeof options>(`/owners/${detail.id}/authority-options`).then(v => { if (active)
        setOptions(v); }).catch(e => { if (active)
        setError(e.message); }); return () => { active = false; }; }, [api, detail.id]);
    async function request() { try {
        if (!options?.authorizationNotice || !accepted)
            throw Error('请核对真实渠道授权范围及当前说明');
        await onAction(`/owners/${detail.id}/authorities`, { sealId: detail.seals.find(s => s.status === 'ACTIVE')?.id, accepted: true, idempotencyKey: crypto.randomUUID(), scope: { version: 2, delegates: options.delegates, documentKinds: options.documentKinds.map(d => d.id), validFrom: shanghaiSigningInstant(from), validUntil: shanghaiSigningInstant(until) }, consents: documents.filter(d => ['terms', 'privacy', 'owner-auto-sign'].includes(d.type)).map(d => ({ documentId: d.id, version: d.version })) });
        setAccepted(false);
    }
    catch (e) {
        setError((e as Error).message);
    } }
    return <section className="state-card">
<h2>法大大签章授权</h2>{!documents.some(d=>d.type==='owner-auto-sign')&&<p>自动用印授权说明尚未发布，暂不能申请自动授权；可继续逐份签署。</p>}
<p>授权法大大执行约定范围的签章，与独立用印授权分别管理。设置完成后仍需核验业务范围；可继续本人逐份签署。</p>{error && <p role="alert">{error}
</p>}
{records.map(r => <article key={r.id}>
<p>法大大签章授权 · {r.status} · {r.enabled?'技术权限已启用':'技术权限已暂停'}
</p>
<button className="secondary" disabled={busy||!r.enabled&&r.status!=='AUTHORIZED'} onClick={()=>{const command=technicalAuthoritySwitch(detail.id,r);void onAction(command.path,command.body);}}>{r.enabled?'本人暂停渠道技术授权':'本人启用渠道技术授权'}</button>
<button className="secondary" disabled={busy} onClick={() => void onAction(`/owners/${detail.id}/authorities/${r.id}/refresh`, {})}>查询原渠道授权结果</button>
<button className="secondary" disabled={busy} onClick={() => void onAction(`/owners/${detail.id}/authorities/${r.id}/resume`, {})}>接续原渠道授权</button>
<button className="secondary" disabled={busy} onClick={() => void onAction(`/owners/${detail.id}/authorities/${r.id}/revoke`, {})}>撤销渠道技术授权</button>
</article>)}
{options?.scopeVersion === 2 && options.authorizationMethod === 'PROVIDER_AUTO_GRANT' && detail.capabilities.canRequestAuthority && !records.some(r=>['PENDING','AUTHORIZED','UNKNOWN','AUTHORIZING'].includes(r.status)) ? <fieldset disabled={busy}>
<legend>本人办理渠道授权</legend>{documents.filter(d=>d.type==='owner-auto-sign').map(d=>
<button className="inline-link" key={d.id} onClick={()=>setLegal(d)}>{d.title} 第 {d.version} 版</button>)}
<p>被授权主体：{options.delegates.map(d => d.name).join('、')}
</p>
<p>文件范围：{options.documentKinds.map(d => d.label).join('、') || '缺少已批准模板，请联系运营'}
</p>
<label className="field">渠道授权起时（北京时间）<input type="datetime-local" value={from} onChange={e => { setFrom(e.target.value); setAccepted(false); }}/>
</label>
<label className="field">渠道授权止时（北京时间）<input type="datetime-local" value={until} onChange={e => { setUntil(e.target.value); setAccepted(false); }}/>
</label>
<label className="check">
<input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/>本人已阅读当前用印授权说明并确认本次渠道范围</label>
<button className="secondary" disabled={!accepted || !documents.some(d=>d.type==='owner-auto-sign') || !options.authorizationNotice || !options.documentKinds.length || !detail.readyForSigning} onClick={() => void request()}>本人办理渠道技术授权</button>
</fieldset> : <p>当前无需新申请，或申请条件尚未就绪。请先核对实名、有效证书、已启用印章和授权范围；已有授权可在上方查询管理。可继续本人逐份签署。</p>}
{legal&&<LegalDialog document={legal} close={()=>setLegal(null)}/>}
</section>;
}
export function LegalTechnical(props:ComponentProps<typeof LegacyLegalTechnical>&{onExpired?:()=>void}){return props.detail.authorizationScopeVersion===3?<PlatformLegalTechnical {...props}/>:<LegacyLegalTechnical {...props}/>;}
