export class OwnerApiError extends Error {
 status:number;code:string;
 constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}
const part='[A-Za-z0-9_-]+';
const readPath=new RegExp('^/owners(?:/'+part+'(?:/(?:workbench|vehicles|cooperation-vehicles|revenue|agreements(?:/'+part+'/files/'+part+')?|policies|revenue-rules|settlements(?:/'+part+')?|orders/'+part+'/workspace|offline-archives(?:/'+part+'(?:/versions/'+part+'/files/'+part+')?)?))?)?$');
const authWrites=['/auth/sms/request','/auth/login','/auth/logout','/auth/invitation/preview','/auth/invitation/confirm'];
const listPath=new RegExp('^/owners/'+part+'/(workbench|vehicles|cooperation-vehicles|revenue|policies|offline-archives|revenue-rules|settlements)$');
function queryAllowed(pathname:string,key:string,value:string){
 if(['page','pageSize'].includes(key))return /^[1-9][0-9]{0,5}$/.test(value)&&Number(value)<=(key==='pageSize'?100:999999);
 if(pathname.endsWith('/revenue'))return ['from','to'].includes(key)?/^\d{4}-\d{2}-\d{2}$/.test(value):['agreementId','modelId','vehicleId'].includes(key)?/^[A-Za-z0-9_-]+$/.test(value):key==='groupBy'&&['month','agreement','model','vehicle'].includes(value);
 if(pathname.endsWith('/cooperation-vehicles'))return ['agreementId','modelId'].includes(key)?/^[A-Za-z0-9_-]+$/.test(value):key==='status'&&['DRAFT','PUBLISHED','UNPUBLISHED','RESERVED','IN_USE'].includes(value);
 return ['vehicleId','orderId'].includes(key)?/^[A-Za-z0-9_-]+$/.test(value):key==='kind'&&value==='OWNER_COOPERATION'&&pathname.endsWith('/offline-archives');
}
export class OwnerClient {
 private csrf='';private generation=0;private transport:typeof fetch;private denied?: (status:number)=>void;
 constructor(transport:typeof fetch=(...args)=>fetch(...args)){this.transport=transport;}
 setCsrf(value:string){this.generation++;this.csrf=value;}
 clear(){this.generation++;this.csrf='';}
 onAccessDenied(listener:(status:number)=>void){this.denied=listener;return()=>{if(this.denied===listener)this.denied=undefined;};}
 async request<T>(path:string,body?:unknown):Promise<T> {
  const [pathname,query]=path.split('?'),write=body!==undefined;
  if(!path.startsWith('/')||/[\\%#\s]/.test(pathname)||path.split('?').length>2)throw new OwnerApiError(400,'PATH_DENIED','请求地址不允许。');
  if(write&&!authWrites.includes(path))throw new OwnerApiError(403,'PARTNER_READ_ONLY','合作商入口仅供查看，请联系运营办理。');
  if(write&&path==='/auth/logout'&&(body===null||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length))throw new OwnerApiError(400,'METHOD_DENIED','退出请求须为空对象。');
  if(!write&&authWrites.includes(path))throw new OwnerApiError(400,'METHOD_DENIED','请求方式不允许。');
  if(!write&&!readPath.test(pathname)&&!['/config','/legal','/auth/me'].includes(path))throw new OwnerApiError(400,'PATH_DENIED','请求地址不允许。');
  if(query!==undefined){
   const params=new URLSearchParams(query),keys=[...params.keys()];
   if(!listPath.test(pathname)||!query||new Set(keys).size!==keys.length||[...params].some(([key,value])=>!queryAllowed(pathname,key,value)))throw new OwnerApiError(400,'PATH_DENIED','列表条件不允许。');
  }
  if(write&&path==='/auth/logout'&&!this.csrf)throw new OwnerApiError(401,'SESSION_REQUIRED','请重新登录。');
  const generation=this.generation,documentRequest=/\/(?:offline-archives\/[^/]+\/versions\/[^/]+|agreements\/[^/]+)\/files\/[^/]+$/.test(path);
  const headers:Record<string,string>={Accept:documentRequest?'application/pdf,image/jpeg,image/png':'application/json'};
  if(write){headers['Content-Type']='application/json';if(this.csrf)headers['X-CSRF-Token']=this.csrf;}
  const current=()=>{if(generation!==this.generation)throw new OwnerApiError(0,'STALE_RESPONSE','查看范围已变化，请重新读取。');};
  let response:Response;
  try{response=await this.transport(`/owner/api${path}`,{method:write?'POST':'GET',headers,credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20_000),...(write?{body:JSON.stringify(body)}:{})});}
  catch{current();throw new OwnerApiError(0,'NETWORK','网络连接失败，请稍后重新读取。');}
  current();
  if([401,403].includes(response.status)&&!authWrites.filter(path=>path!=='/auth/logout').includes(path)){
   this.clear();if(path.startsWith('/owners')||path==='/auth/logout')this.denied?.(response.status);
   let value:any;try{value=await response.json();}catch{}
   const error=value?.error||value;
   throw new OwnerApiError(response.status,error?.code||'ACCESS_DENIED',error?.message||'查看授权已变化，请重新登录或联系运营。');
  }
  if(documentRequest&&response.ok){
   const mime=response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
   if(!['application/pdf','image/jpeg','image/png'].includes(mime||''))throw new OwnerApiError(response.status,'INVALID_DOCUMENT','文件响应异常，请重新查询原记录。');
   const blob=await response.blob();current();return blob as T;
  }
  let value:any;try{value=await response.json();}catch{current();throw new OwnerApiError(response.status,'INVALID_RESPONSE','服务响应异常，请稍后重试。');}
  current();
  if(!response.ok||value?.error){const error=value?.error||value;throw new OwnerApiError(response.status,typeof error?.code==='string'?error.code:'REQUEST_FAILED',typeof error?.message==='string'?error.message:'读取未完成，请稍后重试。');}
  return(value&&typeof value==='object'&&Object.hasOwn(value,'data')?value.data:value) as T;
 }
}
