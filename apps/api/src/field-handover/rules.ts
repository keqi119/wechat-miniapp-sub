import {z} from 'zod';
import {ensure} from '../common/errors';
export const versionInput=z.number().int().nonnegative();
const optionalText=z.string().trim().max(500).default('');
export const draftInput=z.object({
 actualAt:z.union([z.literal(''),z.string().datetime({offset:true})]).default(''),
 readingKm:z.number().int().min(0).max(2147483647).nullable().default(null),
 batteryPercent:z.number().int().min(0).max(100).nullable().default(null),
 place:optionalText,accessories:optionalText,condition:optionalText,openItems:optionalText,resolutionPlan:optionalText,
 resolutionNote:optionalText,fileIds:z.array(z.string().min(1).max(128)).max(20).default([])
}).strict();
export function publishFacts(raw:unknown,staffName:string,revision:boolean) {
 const d=draftInput.parse(raw);
 ensure(d.actualAt&&new Date(d.actualAt).getTime()<=Date.now()&&d.readingKm!==null&&d.batteryPercent!==null,400,'FACTS_INCOMPLETE','请填写真实交接时间、仪表里程与电量；时间不能在未来');
 ensure(d.place&&d.accessories&&d.condition&&d.openItems&&d.resolutionPlan&&d.fileIds.length>0,400,'FACTS_INCOMPLETE','请填齐全部核对项并至少上传一份现场材料，无事项请填写“无”');
 ensure(!revision||d.resolutionNote,400,'RESOLUTION_REQUIRED','请填写本次异议处理说明');
 const local=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(d.actualAt));
 return {actualAt:d.actualAt,readingKm:d.readingKm,fileIds:d.fileIds,checklist:[
  {label:'actualTimeAndPlace',value:`${local}（北京时间）；${d.place}`},{label:'batteryLevel',value:`${d.batteryPercent}%`},
  {label:'accessoriesChecklist',value:d.accessories},{label:'conditionChecklist',value:d.condition},
  {label:'openItems',value:d.openItems},{label:'resolutionPlan',value:d.resolutionPlan},{label:'staffName',value:staffName}
 ]};
}
