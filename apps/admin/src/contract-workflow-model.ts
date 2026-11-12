type Row=Record<string,any>;
export const contractStages=[{key:'template',label:'模板版本'},{key:'generate',label:'生成合同'},{key:'preview',label:'预览及打印'},{key:'signed',label:'上传并审核'},{key:'archive',label:'合同归档'}] as const;
export type ContractStage=typeof contractStages[number]['key'];
/** Derive the linear workflow from persisted facts; never invent approval from uploaded files. */
export function contractWorkflow(v:Row){
 const historic=['SUBMITTED','REVIEWED','ARCHIVED','REJECTED','INVALIDATED'].includes(v.status);
 const known=['DRAFT','SUBMITTED','REVIEWED','ARCHIVED','REJECTED','INVALIDATED','SUPERSEDED'].includes(v.status),superseded=v.status==='SUPERSEDED';
 const template=!!v.templateId||historic,generated=!!v.sourceFileId||historic,preview=v.printConfirmed===true||historic;
 const rejected=['REJECTED','INVALIDATED'].includes(v.status),archived=v.status==='ARCHIVED';
 const current:ContractStage=!template?'template':!generated?'generate':!preview?'preview':['REVIEWED','ARCHIVED'].includes(v.status)?'archive':'signed';
 const index=contractStages.findIndex(s=>s.key===current);
 const complete=!!(Array.isArray(v.files)&&v.files.length&&v.signedOn&&v.contractNumber&&Number(v.declaredPages)>0);
 return {current,known:known&&!!v.id,index,rejected,archived,superseded,materialsComplete:complete,
  steps:contractStages.map((s,i)=>({...s,enabled:known&&!!v.id&&i<=index,done:i<index||archived}))};
}
