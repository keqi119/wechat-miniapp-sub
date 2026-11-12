import {useEffect,useRef,useState} from 'react';
import {ApiError} from '../core';
type Pending={send:()=>Promise<unknown>;after?:()=>void;written:boolean};
export const fieldAccessLost=(error:unknown)=>error instanceof ApiError&&([401,403,404].includes(error.status)||error.code==='SESSION_CHANGED');

/** Keep one exact command closure (including FormData bytes) until its outcome is known. */
export function useFieldCommand(reload:(preserve?:boolean)=>Promise<void>,failed:(error:unknown)=>void){
 const[busy,setBusy]=useState(false),[mode,setMode]=useState<'idle'|'unknown'|'readback'>('idle'),[error,setError]=useState('');
 const alive=useRef(false),working=useRef(false),pending=useRef<Pending|null>(null),latest=useRef({reload,failed});latest.current={reload,failed};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;pending.current=null;};},[]);
 const clear=()=>{pending.current=null;if(alive.current){setMode('idle');setError('');}};
 const execute=async(next?:Pending)=>{
  if(working.current)return false;
  if(next){if(pending.current)return false;pending.current=next;}
  const item=pending.current;if(!item)return false;working.current=true;setBusy(true);setError('');
  try{
   if(!item.written){await item.send();if(!alive.current||pending.current!==item)return false;item.written=true;setMode('readback');}
   await latest.current.reload();if(!alive.current||pending.current!==item)return false;
   pending.current=null;setMode('idle');item.after?.();return true;
  }catch(e){
   if(!alive.current||pending.current!==item)return false;
   setError(e instanceof Error?e.message:'操作未完成');latest.current.failed(e);
   if(fieldAccessLost(e)){pending.current=null;setMode('idle');}
   else if(item.written)setMode('readback');
   else if(e instanceof ApiError&&(e.status===0||e.status>=500||e.code==='INVALID_RESPONSE'))setMode('unknown');
   else{pending.current=null;setMode('idle');if(e instanceof ApiError&&e.status===409){try{await latest.current.reload(true);}catch(readError){if(alive.current){latest.current.failed(readError);setError(readError instanceof Error?readError.message:'请重新读取当前任务');}}}}
   return false;
  }finally{working.current=false;if(alive.current)setBusy(false);}
 };
 return{busy,mode,error,frozen:busy||mode!=='idle',run:(send:()=>Promise<unknown>,after?:()=>void)=>execute({send,after,written:false}),retry:()=>execute(),clear};
}
