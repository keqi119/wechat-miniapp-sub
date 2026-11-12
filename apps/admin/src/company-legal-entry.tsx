import type {BusinessField} from './domain-commands';
import { useEffect, useState } from 'react';
import { api } from './core';
import { Command, CommandBoundary, FormFields, useCommandDisabled, type Row } from './domain-ui';
import { ErrorNotice } from './ui';
const legalFields:BusinessField[] = [{ key: 'name', label: '法人本人姓名', required: true },
 { key: 'mobile', label: '法人本人手机号', required: true },
 { key: 'evidenceFileId', label: '营业执照原始凭据', kind: 'files', uploadFields: { purpose: 'evidence' }, required: true },
 { key: 'accepted', label: '已核验原始凭据及当前法人本人', kind: 'check', required: true }];
export function CompanyLegalEntry({ ownerId,after,refreshKey }: {
    ownerId: string;after?:()=>Promise<void>;refreshKey?:unknown;
}) {
    const [record, setRecord] = useState<Row>(), [error, setError] = useState<unknown>(), [readFailed,setReadFailed]=useState(false), [tick, setTick] = useState(0), [mobile, setMobile] = useState(''), [link, setLink] = useState(''), [busy, setBusy] = useState(false);
    const disabled = useCommandDisabled(), base = `/admin/vehicle-owners/${ownerId}`;
    useEffect(() => { const abort = new AbortController(); setRecord(undefined); setLink(''); setError(undefined);setReadFailed(false); void api.request<Row>(base, { signal: abort.signal }).then(v => { if (!abort.signal.aborted)
        setRecord(v); }).catch(e => { if (!abort.signal.aborted){setError(e);setReadFailed(true);} }); return () => abort.abort(); }, [base, tick,refreshKey]);
    async function invite() { if(disabled||busy||readFailed||!record?.legalRepresentative||!mobile)return;setBusy(true); setLink(''); setError(undefined); try {
        const result = await api.request<Row>(`${base}/invitations`, { method: 'POST', body: { mobile } });
        const entry=new URL(result.entryUrl);entry.searchParams.set('purpose','legal');entry.searchParams.set('invitationToken',result.token);setLink(entry.toString());
    }
    catch (e) {
        setError(e);
    }
    finally {
        setBusy(false);
    } }
    return <CommandBoundary disabled={busy||readFailed||!record}><section className="partner-legal-entry"><p className="muted">运营登记法人后，将邀请链接交付本人办理企业认证与选章。</p>{error ? <ErrorNotice error={error} retry={()=>setTick(v=>v+1)}/> : null}{!record&&!error?<p className="muted">正在读取法人登记资料…</p>:null}{record && <><p>登记法人：{record.legalRepresentative?.name || '尚未登记'} · {record.legalRepresentative?.maskedMobile || ''}</p><Command label="维护登记法人本人" path={`${base}/legal-representative`} revision={record.legalRepresentative?.revision || 0} initial={{ name: record.legalRepresentative?.name || '' }} fields={legalFields} renderFields={({fields,values,setValues,disabled})=><FormFields fields={fields} values={values} setValues={setValues} disabled={disabled}/>} build={v => { const ids = v.evidenceFileId as string[]; if (ids.length !== 1)
        throw Error('请选择一份真实原始凭据'); return { ...v, evidenceFileId: ids[0] }; }} after={async()=>{setTick(v => v + 1);await after?.();}}/><label className="simple-field">当前法人本人手机号<input disabled={disabled||busy||readFailed} value={mobile} onChange={e => { setMobile(e.target.value); setLink(''); }}/></label><button className="button" disabled={disabled || busy || readFailed || !record.legalRepresentative || !mobile} onClick={() => void invite()}>生成本人邀请链接</button>{link && <p><a href={link} target="_blank" rel="noreferrer">本人办理入口（仅本次展示）</a><button className="text-button" onClick={() => void navigator.clipboard.writeText(link)}>复制邀请链接</button></p>}</>}<details className="partner-more"><summary>资料变更与本人办理说明</summary><p>公司资料查看管理员与登记法人分别管理。认证材料实际变更后需重新认证，新签署与自动用印暂停，原合同及档案保留。变更法人资料会使原本人会话失效。邀请链接由运营核对后交付本人。</p></details></section></CommandBoundary>;
}
