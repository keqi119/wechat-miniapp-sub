import {ApiClient} from '../core';
export const fieldBase=import.meta.env?.VITE_API_BASE_URL||(import.meta.env?.PROD?'https://mini-api.subauto.keybox.cloud/api':'/api');
export const client=new ApiClient(fetch,fieldBase);
export const taskPath=(id:string)=>'/admin/field-tasks/'+encodeURIComponent(id);
export const fileUrl=(taskId:string,id:string)=>fieldBase+taskPath(taskId)+'/files/'+encodeURIComponent(id);
