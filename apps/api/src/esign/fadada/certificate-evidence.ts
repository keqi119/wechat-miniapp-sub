import {canonicalHash} from '../../customers/types';

const starts=new Set(['startTime','start_time','validStartTime','valid_start_time']);
const ends=new Set(['endTime','end_time','validEndTime','valid_end_time']);
function timestamp(value:unknown):number{
 if(typeof value!=='string'&&typeof value!=='number')return NaN;
 const text=String(value),parts=text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)||text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/);
 if(parts){const numbers=parts.slice(1).map(v=>Number(v||0)),[year,month,day,hour,minute,second]=numbers,local=new Date(Date.UTC(year,month-1,day,hour,minute,second));if(year<1900||local.getUTCFullYear()!==year||local.getUTCMonth()!==month-1||local.getUTCDate()!==day||local.getUTCHours()!==hour||local.getUTCMinutes()!==minute||local.getUTCSeconds()!==second)return NaN;return local.getTime()-8*3600000;}
 if(/^\d{10}(?:\d{3})?$/.test(text))return Number(text)*(text.length===10?1000:1);
 return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)?Date.parse(text):NaN;
}
/** Retain the actual validity interval. Unknown or contradictory evidence never creates dates. */
export function certificateEvidence(raw:unknown,now=Date.now()):{validFrom:string;validUntil:string;evidenceHash:string}|null{
 const from:number[]=[],until:number[]=[];let invalid=false;
 const visit=(value:unknown,depth=0)=>{if(depth>5){invalid=true;return;}if(typeof value==='string'){try{visit(JSON.parse(value),depth+1);}catch{}return;}if(!value||typeof value!=='object')return;if(Array.isArray(value)){invalid=true;return;}for(const[k,v]of Object.entries(value)){if(starts.has(k))from.push(timestamp(v));else if(ends.has(k))until.push(timestamp(v));else if(v&&typeof v==='object'||typeof v==='string'&&v.startsWith('{'))visit(v,depth+1);}};
 visit(raw);if(invalid||!from.length||!until.length||[...from,...until].some(v=>!Number.isFinite(v))||new Set(from).size!==1||new Set(until).size!==1||!Number.isFinite(now)||from[0]>now||until[0]<=now)return null;
 return{validFrom:new Date(from[0]).toISOString(),validUntil:new Date(until[0]).toISOString(),evidenceHash:canonicalHash(raw)};
}
