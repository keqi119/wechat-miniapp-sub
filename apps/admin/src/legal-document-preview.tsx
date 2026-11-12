import {legalBody,legalBlocks} from './legal-document-text';
import './legal-document-preview.css';

/** Read-only presentation. Never rewrite the approved template or interpret its text as HTML. */
function Inline({text}:{text:string}){return <>{text.split(/(\*\*[^*\n]+\*\*)/g).map((part,index)=>part.startsWith('**')&&part.endsWith('**')?<strong key={index}>{part.slice(2,-2)}</strong>:part)}</>;}
export function LegalDocumentPreview({content,title}:{content:string;title?:string}){
 const blocks=legalBlocks(legalBody(content)),first=blocks[0]?.text.replace(/^#{1,6}\s*/, '');
 const shown=title&&first===title?blocks.slice(1):blocks;
 return <article className="legal-document-preview" aria-label="合同正文预览">
  {title?<h2 className="legal-document-title">{title}</h2>:null}
  {shown.length?shown.map((block,index)=>block.kind==='table'?<div className="legal-table-scroll" key={index}><table><thead><tr>{block.headers.map((cell,i)=><th scope="col" key={i}><Inline text={cell}/></th>)}</tr></thead><tbody>{block.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}><Inline text={cell}/></td>)}</tr>)}</tbody></table></div>:block.kind==='heading'?<h3 key={index}><Inline text={block.text}/></h3>:<p key={index} className={block.kind==='clause'?'legal-clause':undefined}><Inline text={block.text}/></p>):!title?<p className="muted">暂无正文</p>:null}
 </article>;
}
