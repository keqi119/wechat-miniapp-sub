import {billPublicationView} from './bill-publication';

export function BillPublicationNotice({bill,compact=false}:{bill:Record<string,unknown>;compact?:boolean}) {
 const publication=billPublicationView(bill);
 if(compact)return <div className="text-block"><strong>{publication.title}</strong>{publication.scheduledDate?<span className="text-paragraph">计划 {publication.scheduledDate}（北京时间）</span>:null}<span className="text-paragraph muted">{publication.message}</span></div>;
 return <section className="domain-section" aria-label="账单发布安排"><h3>{publication.title}</h3>{publication.scheduledDate?<p>计划发布：{publication.scheduledDate}（北京时间）</p>:null}<p>{publication.message}</p></section>;
}
