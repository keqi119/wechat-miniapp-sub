import {moneyToCents} from './core.ts';
export type BusinessValue=string|number|boolean|null|BusinessValue[]|{[key:string]:BusinessValue};
export type BusinessValues=Record<string,BusinessValue>;
export type Choice={value:string;label:string};
export type BusinessField={onUploaded?:(file:{id:string;mimeType:string})=>Promise<void>|void;key:string;label:string;kind?:'text'|'textarea'|'number'|'money'|'signed-money'|'date'|'datetime-local'|'select'|'multi'|'check'|'files'|'rows';required?:boolean;requiredWhen?:{key:string;value:BusinessValue};hint?:string;choices?:Choice[];source?:string;sourceKind?:'record'|'published-document'|'benefit-version'|'product-version'|'requirement-version'|'archive-version'|'cooperation-version';fields?:BusinessField[];when?:{key:string;value:BusinessValue};uploadPath?:string;uploadFields?:Record<string,string>;filePath?:string;downloadAllowed?:boolean};
export class CommandIdentity {
 private fingerprint='';private key='';
 for(path:string,body:unknown){const fingerprint=JSON.stringify({path,body});if(fingerprint!==this.fingerprint){this.fingerprint=fingerprint;this.key=crypto.randomUUID();}return this.key;}
}
export function visibleFields(fields:BusinessField[],values:BusinessValues){return fields.filter(field=>!field.when||(Array.isArray(field.when.value)?field.when.value.includes(values[field.when.key]):values[field.when.key]===field.when.value));}
export function fieldRequired(field:BusinessField,values:BusinessValues){return field.requiredWhen?values[field.requiredWhen.key]===field.requiredWhen.value:field.required;}
export function readFields(fields:BusinessField[],values:BusinessValues):Record<string,unknown>{
 return Object.fromEntries(visibleFields(fields,values).map(field=>{
  const value=values[field.key],required=fieldRequired(field,values);let result:unknown=value;
  if(field.kind==='rows')result=(Array.isArray(value)?value:[]).map(row=>readFields(field.fields||[],row as BusinessValues));
  else if(field.kind==='money'||field.kind==='signed-money'){
   const input=String(value??'').trim();if(!input&&!required)result=null;else result=field.kind==='signed-money'&&input.startsWith('-')?-moneyToCents(input.slice(1)):moneyToCents(input);
  }else if(field.kind==='number'){if((value===''||value==null)&&!required)result=null;else {result=Number(value);if(!Number.isSafeInteger(result))throw new Error(`${field.label}请输入整数`);}}
  else if(field.kind==='multi'||field.kind==='files')result=Array.isArray(value)?value:[];
  else if(field.kind==='check')result=value===true;
  else if(field.kind==='datetime-local')result=value?new Date(`${value}:00+08:00`).toISOString():null;
  else result=typeof value==='string'?value.trim():value??'';
  if(required&&(result==null||result===''||Array.isArray(result)&&!result.length||field.kind==='check'&&result!==true))throw new Error(`请填写${field.label}`);
  return[field.key,result];
 }));
}
type SourceRow=Record<string,unknown>;
export function sourceChoices(data:unknown,kind:BusinessField['sourceKind']='record'):Choice[]{
 const rows=(Array.isArray(data)?data:(data as {items?:unknown[]})?.items)||[];
 return rows.flatMap(raw=>{const row=raw as SourceRow;const title=String(row.name||row.title||row.policyNumber||row.mobile||row.id||'');
  if(kind==='published-document')return row.status==='PUBLISHED'&&row.confirmedBy&&row.confirmedAt?[{value:String(row.id),label:title+' · 第'+row.version+'版'}]:[];
  if(kind==='record')return[{value:String(row.id),label:title+(row.plateNumber?` · ${row.plateNumber}`:'')}];
  const versions=Array.isArray(row.versions)?row.versions as SourceRow[]:[];
  return versions.filter(v=>kind!=='product-version'||v.status==='PUBLISHED').filter(v=>kind!=='archive-version'||v.status==='ARCHIVED').filter(v=>kind!=='cooperation-version'||['DRAFT','SUBMITTED','ARCHIVED'].includes(String(v.status))).map(v=>({value:String(v.id),label:`${String(v.name||title)} · 第${v.version}版`}));
 });
}
