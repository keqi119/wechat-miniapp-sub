export type BaasPreviousCandidate={id:string;vehicleId:string;contractNumber:string;status:string;activatedAt?:string|null;provider?:string|null;effectiveFrom?:string|null;effectiveTo?:string|null};
type CandidatePage={items:BaasPreviousCandidate[];total:number;page:number;pageSize:number};

/** "无" was previously entered into a free-text field; it means no relation. */
export function normalizeBaasPreviousContract(value:unknown):string|null{
 if(value===undefined||value===null)return null;
 if(typeof value!=='string'||value.includes('\0')||value.length>500)throw Error('请从本车原合同中选择承接关系');
 const id=value.trim();return !id||id==='无'?null:id;
}

/** Read the complete scoped directory; an incomplete directory never becomes an
 * unscoped or first-page-only substitute. Selection remains optional. */
export async function readBaasPreviousCandidates(read:(path:string)=>Promise<CandidatePage>,vehicleId:string,currentId?:string):Promise<BaasPreviousCandidate[]>{
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(vehicleId))throw Error('请先选择实际车辆');
 const size=100,rows:BaasPreviousCandidate[]=[],seen=new Set<string>();let total:number|undefined,page=1;
 do{
  const result=await read('/admin/baas-contracts?'+new URLSearchParams({vehicleId,page:String(page),pageSize:String(size)}));
  if(!result||result.page!==page||result.pageSize!==size||!Number.isSafeInteger(result.total)||result.total<0||!Array.isArray(result.items)||total!==undefined&&result.total!==total)throw Error('本车原合同目录发生变化，请重新读取');
  total=result.total;
  if(result.items.length!==Math.min(size,Math.max(0,total-(page-1)*size)))throw Error('本车原合同目录不完整，请重新读取');
  for(const row of result.items){
   if(!row||typeof row.id!=='string'||!row.id||row.vehicleId!==vehicleId||seen.has(row.id)||typeof row.contractNumber!=='string')throw Error('本车原合同目录归属或记录不一致');
   seen.add(row.id);rows.push(row);
  }
  page++;
 }while(rows.length<total);
 return rows.filter(row=>row.id!==currentId&&['ACTIVE','SUSPENDED','TERMINATED','ARCHIVED'].includes(row.status)&&typeof row.activatedAt==='string'&&Number.isFinite(Date.parse(row.activatedAt)));
}
