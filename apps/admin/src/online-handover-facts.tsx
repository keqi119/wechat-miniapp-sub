import {api,date,type Entity} from './core';

export function OnlineHandoverFacts({record}:{record:Entity}){
 if(record.confirmationMode!=='ONLINE_RECORD')return null;
 const s=record.onlineRecordSnapshot as Record<string,any>|undefined,c=record.onlineConfirmation as Record<string,any>|undefined;
 return <section className="domain-section" aria-label="线上交接留存"><h3>线上交接记录</h3><p>本版通过现场证据、客户本人确认和后台完成记录留存；客户确认与实际交接完成分别记录。</p><p>交接版本 {String(record.revision)} · 客户确认 {date(record.confirmedAt)} · 后台完成 {date(record.completedAt)}</p>{s?.termsContent?<><details><summary>{String(s.termsTitle)} · 约定版本 {String(s.termsVersion)}</summary><p style={{whiteSpace:'pre-wrap'}}>{String(s.termsContent)}</p></details><dl><dt>本版证据摘要</dt><dd style={{overflowWrap:'anywhere'}}>{String(record.manifestHash)}</dd><dt>本人确认的版本</dt><dd>{c?.termsAccepted===true?`${String(c.termsVersion)} / ${String(c.revision)}`:'尚未确认'}</dd></dl><ul>{Array.isArray(s.evidence)?s.evidence.map((file:any)=><li key={file.fileId}><a href={api.fileUrl(file.fileId)} target="_blank" rel="noreferrer">查看本版证据 {String(file.fileId)}</a><small style={{display:'block',overflowWrap:'anywhere'}}>{String(file.sha256)} · {String(file.size)} 字节</small></li>):null}</ul></>:<p>现场资料尚未发布冻结。</p>}</section>;
}
