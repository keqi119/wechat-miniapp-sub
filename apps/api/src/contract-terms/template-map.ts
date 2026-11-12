import {z} from 'zod';
import {ensure} from '../common/errors';
import {markerBindings} from './marker-bindings';
const families={SUBSCRIPTION:'01',COOPERATION:'02-main',COOPERATION_GRANT:'02-grant',VEHICLE_SWAP:'03',PRE_DELIVERY_CANCELLATION:'04',RENEWAL:'05',EARLY_TERMINATION:'06'} as const;
export const v31TemplateTypes=Object.keys(families).map(kind=>`ELECTRONIC_V31_${kind}`);
export function v31TemplateType(kind:string):string{ensure(kind in families,409,'V31_TEMPLATE_UNSUPPORTED','此场景尚无审定的 V3.1 正文');return `ELECTRONIC_V31_${kind}`;}
export function v31RoleLabels(kind:string):Record<string,string>{v31TemplateType(kind);return kind==='COOPERATION'?{PLATFORM:'甲方',OWNER:'乙方'}:kind==='COOPERATION_GRANT'?{OWNER:'授权人',PLATFORM:'受权人'}:{CUSTOMER:'甲方',OWNER:'乙方',PLATFORM:'丙方'};}
const run=z.object({text:z.string(),bold:z.boolean(),italic:z.boolean(),underline:z.boolean()}).strict();
const paragraph=z.object({type:z.literal('paragraph'),loc:z.string(),alignment:z.enum(['left','center','right','both']),runs:z.array(run)}).strict();
const table=z.object({type:z.literal('table'),loc:z.string(),widths:z.array(z.number().positive()),rows:z.array(z.array(z.object({loc:z.string(),span:z.number().int().positive(),paragraphs:z.array(paragraph)}).strict()))}).strict();
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const envelope=z.object({schema:z.literal('NINDA_V31_TEMPLATE'),artifact:z.enum(['01','02-main','02-grant','03','04','05','06']),kind:z.string(),status:z.literal('DRAFT'),source:z.object({zipSha256:digest,zipEntry:z.string().min(1),docxSha256:digest,textSha256:digest}).strict(),nodes:z.array(z.union([paragraph,table])).min(1),markers:z.array(z.object({id:z.string(),loc:z.string(),token:z.string(),category:z.enum(['BLOCK','PARAMETER','SIGNATURE']),binding:z.string().min(1),required:z.boolean()}).strict())}).strict();
export type V31Template=z.infer<typeof envelope>;
export type V31Paragraph=z.infer<typeof paragraph>;
export type V31Node=V31Template['nodes'][number];
export function paragraphs(nodes:V31Node[]):V31Paragraph[]{return nodes.flatMap(n=>n.type==='paragraph'?[n]:n.rows.flatMap(row=>row.flatMap(c=>c.paragraphs)));}
export function validateV31Template(value:unknown):V31Template{
 const result=envelope.parse(value);ensure(families[result.kind as keyof typeof families]===result.artifact,409,'V31_TEMPLATE_INVALID','正文类型不匹配');
 ensure(JSON.stringify(result.markers)===JSON.stringify(markerBindings[result.artifact]),409,'V31_TEMPLATE_INVALID','带入字段来源或签署控制映射已变化');
 const expected={'01':10,'02-main':8,'02-grant':2,'03':7,'04':6,'05':8,'06':6}[result.artifact];
 const occurrences=paragraphs(result.nodes).flatMap(p=>[...p.runs.map(r=>r.text).join('').matchAll(/【[^】]+】/g)].map(m=>({loc:p.loc,token:m[0]})));
 ensure(result.markers.length===expected&&occurrences.length===expected&&new Set(result.markers.map(m=>m.id)).size===expected,409,'V31_TEMPLATE_INVALID','正文带入块数量或标识不完整');
 for(const [index,occurrence] of occurrences.entries()){const m=result.markers[index];ensure(m.loc===occurrence.loc&&m.token===occurrence.token,409,'V31_TEMPLATE_INVALID','正文与带入映射不匹配');}
 const controls=result.markers.filter(m=>m.category==='SIGNATURE'),roles=Object.keys(v31RoleLabels(result.kind));
 ensure(controls.length===roles.length&&roles.every(role=>controls.filter(m=>m.binding===role).length===1),409,'V31_TEMPLATE_INVALID','签署区角色不完整');
 return result;
}
