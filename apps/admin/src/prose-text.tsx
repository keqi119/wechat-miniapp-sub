import {paragraphs} from './prose';
export function ProseText({text}:{text:string}){return <span className="text-block">{paragraphs(text).map((part,index)=><span className="text-paragraph" key={index}>{part}</span>)}</span>;}
