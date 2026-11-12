import {ApiClient,ApiError} from '../core';
export const fieldBase=import.meta.env?.VITE_API_BASE_URL||(import.meta.env?.PROD?'https://api.evsub.ndacar.com/api':'/api');
class FieldClient extends ApiClient{
 override async request<T=Record<string,unknown>>(path:string,options:Parameters<ApiClient['request']>[1]={}):Promise<T>{
  const session=this.session;
  try{return await super.request<T>(path,options);}catch(error){
   if(error instanceof ApiError&&error.code==='STAFF_SESSION_CHANGED'&&session&&this.session===session){this.setSession(null);this.onExpired?.();}
   throw error;
  }
 }
}
export const client=new FieldClient(fetch,fieldBase);
export const taskPath=(id:string)=>'/admin/field-tasks/'+encodeURIComponent(id);
export const fileUrl=(taskId:string,id:string)=>fieldBase+taskPath(taskId)+'/files/'+encodeURIComponent(id);
export const receiptFileUrl=(taskId:string,id:string)=>fieldBase+taskPath(taskId)+'/offline-receipt/files/'+encodeURIComponent(id);
