export type BaasPayerOption={id:string;name:string};
type PayerPage={items:BaasPayerOption[];total:number;page:number;pageSize:number};
export function sameBaasName(left:string,right:string){const clean=(value:string)=>value.normalize('NFKC').replace(/\s/gu,'');return !!clean(left)&&clean(left)===clean(right);}
export function baasPayerId(value:unknown):string|null{if(value===null||value===undefined||value==='')return null;if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.trim()))throw Error('请选择实际代付合作商记录');return value.trim();}
export async function readBaasPayerOptions(read:(path:string)=>Promise<PayerPage>):Promise<BaasPayerOption[]>{
 const rows:BaasPayerOption[]=[],seen=new Set<string>(),size=100;let page=1,total:number|undefined;
 do{const result=await read('/admin/baas-contracts/payer-options?'+new URLSearchParams({page:String(page),pageSize:String(size)}));
  if(!result||result.page!==page||result.pageSize!==size||!Number.isSafeInteger(result.total)||result.total<0||!Array.isArray(result.items)||total!==undefined&&total!==result.total)throw Error('合作商目录发生变化，请重新读取');total=result.total;
  if(result.items.length!==Math.min(size,Math.max(0,total-(page-1)*size)))throw Error('合作商目录不完整，请重新读取');
  for(const row of result.items){if(!row||!baasPayerId(row.id)||seen.has(row.id)||typeof row.name!=='string'||!row.name.trim())throw Error('合作商目录记录不一致');seen.add(row.id);rows.push({id:row.id,name:row.name});}page++;
 }while(rows.length<total);return rows;
}
