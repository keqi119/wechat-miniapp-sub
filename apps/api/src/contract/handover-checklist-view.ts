export type HandoverChecklistRow={label:string;value:string};
const labels:Record<string,string>={actualTimeAndPlace:'实际交接时间与地点',batteryLevel:'交接时电量',accessoriesChecklist:'随车物品核对',conditionChecklist:'车辆状况核对',openItems:'未结事项',resolutionPlan:'处理方案',staffName:'现场工作人员',vehicleIdentification:'车辆身份'};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function label(value:unknown,fallback:string){return typeof value==='string'&&value.trim()?(Object.prototype.hasOwnProperty.call(labels,value.trim())?labels[value.trim()]:value):typeof value==='number'?String(value):fallback;}
function fact(value:unknown):string{
 if(value===null||value===undefined||typeof value==='string'&&!value.trim())return'未填写';
 if(typeof value==='string')return value.replace(/\r\n?/g,'\n');
 if(typeof value==='boolean')return value?'是':'否';
 if(Array.isArray(value))return value.length?value.map((item,index)=>`${index+1}. ${fact(item)}`).join('\n'):'未填写';
 if(object(value)){
  if('label'in value||'value'in value){const rest=Object.entries(value).filter(([key])=>!['label','value','factKey'].includes(key));return[`${label(value.label??value.factKey,'条目')}：${fact(value.value)}`,...rest.map(([key,item])=>`${label(key,'条目')}：${fact(item)}`)].join('\n');}
  return Object.entries(value).map(([key,item])=>`${label(key,'条目')}：${fact(item)}`).join('\n')||'未填写';
 }
 return String(value);
}
/** Display projection only: every saved fact remains present, and source JSON is never changed. */
export function handoverChecklistRows(input:unknown):HandoverChecklistRow[]{
 if(input===null||input===undefined)return[];
 const row=(value:unknown,index:number):HandoverChecklistRow[]=>{
  if(object(value)){
   if('label'in value||'value'in value){const rest=Object.entries(value).filter(([key])=>!['label','value','factKey'].includes(key));return[{label:label(value.label??value.factKey,`条目 ${index+1}`),value:fact(value.value)},...rest.map(([key,item])=>({label:label(key,'条目'),value:fact(item)}))];}
   return Object.entries(value).map(([key,item])=>({label:label(key,'条目'),value:fact(item)}));
  }
  return[{label:`条目 ${index+1}`,value:fact(value)}];
 };
 return Array.isArray(input)?input.flatMap(row):row(input,0);
}
