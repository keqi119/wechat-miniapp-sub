export type Draft={actualAt:string;readingKm:number|null;batteryPercent:number|null;place:string;accessories:string;condition:string;openItems:string;resolutionPlan:string;resolutionNote:string;fileIds:string[]};
export type FormValues=Record<Exclude<keyof Draft,'fileIds'>,string>;
export type Task={id:string;orderId:string;type:string;status:string;version:number;note:string;draft:Draft;files:{id:string;name:string;mimeType:string;size:number}[];vehicleTitle:string;handoverArrangement?:string;contextChanged?:boolean;plateNumber?:string;customerName:string;minReadingKm:number;canEdit:boolean;handover:{id:string;status:string;signatureStatus:string;manifestHash:string;revision:number;responseReason?:string}|null};
export const labels:Record<keyof FormValues,string>={actualAt:'实际交接时间（北京时间）',readingKm:'仪表累计里程（公里）',batteryPercent:'交接时电量（%）',place:'实际交接地点',accessories:'随车物品核对',condition:'车辆状况核对',openItems:'未结事项',resolutionPlan:'处理方案',resolutionNote:'异议处理说明'};
export function localTime(iso:string){if(!iso)return'';const n=Date.parse(iso);return Number.isFinite(n)?new Date(n+8*3600000).toISOString().slice(0,16):'';}
export function fromDraft(d:Partial<Draft>):FormValues{return Object.fromEntries(Object.keys(labels).map(k=>[k,k==='actualAt'?localTime(d.actualAt||''):String(d[k as keyof Draft]??'')])) as FormValues;}
export function toDraft(f:FormValues,fileIds:string[]):Draft{
 let actualAt='';if(f.actualAt){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(f.actualAt))throw new Error('实际交接时间无效');const dt=new Date(f.actualAt+':00+08:00');if(!Number.isFinite(dt.getTime())||localTime(dt.toISOString())!==f.actualAt)throw new Error('实际交接时间无效');actualAt=dt.toISOString();}
 const integer=(name:'readingKm'|'batteryPercent',max:number)=>{if(!f[name].trim())return null;const n=Number(f[name]);if(!/^\d+$/.test(f[name])||!Number.isSafeInteger(n)||n>max)throw new Error(labels[name]+'须填写有效非负整数');return n;};
 return{...f,actualAt,readingKm:integer('readingKm',2147483647),batteryPercent:integer('batteryPercent',100),fileIds};
}
export function canEdit(t:{status:string;canEdit:boolean;handover?:unknown}){return t.status==='ASSIGNED'&&t.canEdit;}
export function phase(t:{status:string;contextChanged?:boolean;handover?:{status:string;signatureStatus?:string}|null}){
 if(t.status==='CANCELLED')return'任务已取消';if(t.contextChanged)return'车辆已变化 · 待后台重新采集';const h=t.handover;
 if(!h)return'待采集现场材料';if(h.status==='PUBLISHED')return'已发布 · 等待客户核对';
 if(h.status==='OBJECTION_SUBMITTED')return'客户有异议 · 待修订';
 if(h.status==='CUSTOMER_CONFIRMED')return h.signatureStatus==='SIGNED'?'已签署 · 等待后台完成交接':'客户已确认 · 等待独立签署';
 if(h.status==='COMPLETED')return'交接已完成';return'交接版本已变化 · 请联系后台核对';
}
export function validateFile(file:{type:string;size:number}){if(!['image/jpeg','image/png','application/pdf'].includes(file.type))throw new Error('请选择 JPEG、PNG 或 PDF；HEIC 照片请先导出为 JPEG。');if(file.size>10*1024*1024)throw new Error('单份文件不可超过 10 MiB，请压缩后再上传。');}
