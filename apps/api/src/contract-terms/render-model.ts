import {hash} from '../common/data';
import {createHash} from 'node:crypto';
import {ensure} from '../common/errors';
import {validateV31Template,v31TemplateType,v31RoleLabels,paragraphs,type V31Node,type V31Paragraph} from './template-map';
export function productMinimumExpression(products:{id:string;minimumTermMonths:number}[]):string{
 ensure(products.length>0&&new Set(products.map(p=>p.id)).size===products.length&&products.every(p=>p.id&&Number.isInteger(p.minimumTermMonths)&&p.minimumTermMonths>=3),409,'V31_PRODUCT_MINIMUM_REQUIRED','请核对各产品最短期限');
 return products.map(p=>`${p.id}：${p.minimumTermMonths}个月`).join('；')+'（各产品均不得低于3个月）';
}
export interface V31RenderSnapshot{values:Record<string,string>;fixedTemplates?:{id:string;version:number;content:string;hash:string}[];grantReference?:{agreementNumber:string;agreementHash:string;attachmentOne:V31Node[]};}
// Private rendering adapter only: values must be derived by an authorized business-source adapter.
// It is deliberately not a public request DTO and must never be persisted in generic task JSON.
export function buildV31Document(context:{kind:string},snapshot:V31RenderSnapshot,template:any){
 ensure(template?.type===v31TemplateType(context.kind)&&template.status==='PUBLISHED'&&template.confirmedBy&&template.confirmedAt&&Number.isInteger(template.version)&&template.version>0,409,'LEGAL_NOT_APPROVED','请先审定并启用对应 V3.1 正文');
 const parsed=validateV31Template(JSON.parse(template.content));ensure(parsed.kind===context.kind,409,'V31_TEMPLATE_INVALID','模板类型不一致');
 let nodes:V31Node[]=JSON.parse(JSON.stringify(parsed.nodes));
 const signatureLocs=new Set(parsed.markers.filter(m=>m.category==='SIGNATURE').map(m=>m.loc));
 for(const p of paragraphs(nodes)){
  const mappings=parsed.markers.filter(m=>m.loc===p.loc);
  for(const m of mappings){
   if(m.category==='SIGNATURE'){replaceAcrossRuns(p,m.token,'');continue;}
   const value=snapshot.values[m.binding];ensure(!m.required||typeof value==='string'&&value.trim().length>0,409,'V31_SOURCE_REQUIRED',`合同缺少 ${m.binding}`);
   if(!m.required){p.runs=[{...p.runs[0],text:'联系人、押金及未明确变更的通用条款沿用原约定。'+(value?`本次已确认例外：${value}。`:'')}];continue;}
   ensure(!/【|】|待填写|自动带入|\{\{|\}\}/.test(value),409,'V31_SOURCE_INVALID','合同带入资料含未完成标记');
   if(context.kind==='COOPERATION'&&m.binding==='cooperation.minimumTerms'){
    replaceAcrossRuns(p,'首次及续期产品期限下限按产品配置，审阅值为【待填写】个月，当前产品设计不得低于三个月。',`首次及续期产品最短期限按本附件固定逐产品明细：${value}。当前产品设计不得低于三个月。`);
   }else replaceAcrossRuns(p,m.token,value);
  }
  if(context.kind==='COOPERATION'&&p.loc==='P071'){
   replaceAcrossRuns(p,'比例审阅值为','乙方租金分润比例为');replaceAcrossRuns(p,'，正式签署时从已确认合作条件生成。','。');
  }
 }
 const signatureNotes=nodes.filter(n=>n.type==='paragraph'&&n.runs.map(r=>r.text).join('').startsWith('签署涵盖正文及同时固定的交易摘要和附件。'));
 nodes=nodes.filter(n=>n.type!=='paragraph'||!signatureLocs.has(n.loc)&&!signatureNotes.includes(n)&&!/^(签署栏|独立授权签署栏)$/.test(n.runs.map(r=>r.text).join('')));
 if(context.kind==='COOPERATION'&&snapshot.values['cooperation.exceptions']){const at=nodes.findIndex(n=>n.loc==='P073');nodes.splice(at+1,0,{type:'paragraph',loc:'COOPERATION_EXCEPTIONS',alignment:'left',runs:[{text:'双方已确认例外：'+snapshot.values['cooperation.exceptions'],bold:true,italic:false,underline:false}]});}
 // No blank exception row; preserve the unchanged-contact sentence separately.
 for(const n of nodes)if(n.type==='table')n.rows=n.rows.filter(row=>!row.some(c=>c.loc==='T1R4C2'&&context.kind==='RENEWAL'&&c.paragraphs.every(p=>!p.runs.length)));
 if(context.kind==='COOPERATION_GRANT'){
  const reference=snapshot.grantReference;
  ensure(reference?.agreementNumber&&/^[a-f0-9]{64}$/.test(reference.agreementHash)&&reference.attachmentOne.length,409,'V31_GRANT_SCOPE_REQUIRED','独立授权须固定主协议及附件一完整范围');
  nodes.unshift({type:'paragraph',loc:'GRANT_REFERENCE',alignment:'left',runs:[{text:`引用合作协议编号：${reference.agreementNumber}；正文摘要：${reference.agreementHash}`,bold:true,italic:false,underline:false}]},...JSON.parse(JSON.stringify(reference.attachmentOne)));
 }
 if(context.kind==='COOPERATION'||context.kind==='COOPERATION_GRANT'){
  ensure(snapshot.fixedTemplates?.length,409,'V31_FIXED_TEMPLATE_REQUIRED','须固定获准订阅正文完整内容');
  for(const fixed of snapshot.fixedTemplates!){
   ensure(hash(fixed.content)===fixed.hash,409,'V31_TEMPLATE_CHANGED','获准正文摘要不一致');
   nodes.push(...fixedTemplateAppendix(fixed,snapshot.values['cooperation.minimumTerms']));
  }
 }
 ensure(!/【[^】]+】|待填写|\{\{|\}\}/.test(paragraphs(nodes).flatMap(p=>p.runs.map(r=>r.text)).join('')),409,'V31_TEMPLATE_INCOMPLETE','正文存在未完成标记');
 return{sections:nodes,signatureNotes,roles:Object.keys(v31RoleLabels(context.kind)),templateHash:hash(template.content),roleLabels:v31RoleLabels(context.kind)};
}
function fixedTemplateAppendix(fixed:{id:string;version:number;content:string;hash:string},minimums:string|undefined):V31Node[]{
 const source=validateV31Template(JSON.parse(fixed.content));ensure(source.kind==='SUBSCRIPTION'&&minimums,409,'V31_FIXED_TEMPLATE_REQUIRED','获准正文或逐产品最短期限范围不完整');
 const nodes:V31Node[]=JSON.parse(JSON.stringify(source.nodes));
 for(const p of paragraphs(nodes))for(const marker of source.markers.filter(m=>m.loc===p.loc)){
  if(marker.category==='SIGNATURE')replaceAcrossRuns(p,marker.token,'（未来逐单独立签署控制；不构成本次客户签署）');
  else if(marker.category==='PARAMETER')replaceAcrossRuns(p,'产品最短订阅期限为【待填写】个月',`产品最短订阅期限按本次授权产品明细确定（${minimums}）`);
  else replaceAcrossRuns(p,marker.token,'（获准逐单变量：'+marker.token.replace(/^【自动带入：/,'').replace(/】$/,'')+'）');
 }
 const heading:V31Node={type:'paragraph',loc:'FIXED_TEMPLATE_'+fixed.id,alignment:'left',runs:[{text:`获准订阅模板固定正文附件\n模板${fixed.id}，版本${fixed.version}，系统内容摘要：${fixed.hash}\n完整源字节SHA-256：${createHash('sha256').update(fixed.content,'utf8').digest('hex')}\n以下保留获准模板的固定条款；括注说明未来每单允许带入的资料范围。此附件用于固定用印范围，不是已成立或已签署的客户合同；每单仍须固定实际资料并由各方另行签署。`,bold:true,italic:false,underline:false}]};
 return[heading,...nodes.map(n=>({...n,loc:'FIXED_'+fixed.id+'_'+n.loc}))];
}
function replaceAcrossRuns(p:V31Paragraph,token:string,value:string){
 const all=p.runs.map(r=>r.text).join(''),start=all.indexOf(token);ensure(start>=0,409,'V31_TEMPLATE_INVALID','标记不存在');const end=start+token.length;let at=0;
 p.runs=p.runs.map(r=>{const left=at,right=at+r.text.length;at=right;if(right<=start||left>=end)return r;return{...r,text:r.text.slice(0,Math.max(0,start-left))+(left<=start?value:'')+r.text.slice(Math.max(0,end-left))};}).filter(r=>r.text.length);
}
