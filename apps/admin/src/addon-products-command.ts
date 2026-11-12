import {ApiError} from './core.ts';
import {CommandIdentity} from './domain-commands.ts';
type Requester=(path:string,options:{method:string;permission:string;body:Record<string,unknown>})=>Promise<unknown>;
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
export class AddonCommand{
 phase:'idle'|'unknown'|'readback'|'conflict'='idle';
 private identity=new CommandIdentity();
 private pending?:{path:string;method:string;body:Record<string,unknown>;productId?:string;committed:boolean};
 private running=false;private epoch=0;
 get hasPending(){return !!this.pending;}
 get canReadResult(){return !!this.pending?.productId;}
 dispose(){this.epoch++;this.pending=undefined;this.phase='idle';}
 async execute(path:string,method:string,body:Record<string,unknown>|undefined,productId:string|undefined,request:Requester,readback:(productId?:string)=>Promise<void>){
  if(this.running)return;if(this.phase==='conflict')throw Error('版本冲突，请先重新读取并核对当前版本');
  this.running=true;const epoch=this.epoch;
  const current=()=>{if(epoch!==this.epoch)throw new ApiError('登录或权限已变化，原操作已清理',0,'SESSION_CHANGED');};
  try{
   if(!this.pending){if(!body)throw Error('尚未准备操作资料');const snapshot=structuredClone(body);this.pending={path,method,body:{...snapshot,idempotencyKey:this.identity.for(path,snapshot)},productId,committed:false};}
   const pending=this.pending;
   if(!pending.committed){try{const result=await request(pending.path,{method:pending.method,permission:'addon-products.write',body:pending.body});current();pending.committed=true;if(!pending.productId&&result&&typeof result==='object'&&identifier((result as Record<string,unknown>).productId))pending.productId=(result as {productId:string}).productId;}catch(error){current();if(error instanceof ApiError&&error.status>=200&&error.status<300)pending.committed=true;else throw error;}}
   this.phase='readback';current();await readback(pending.productId);current();
   if(!pending.productId)throw Error('保存已成功，但响应没有可信商品编号。仅刷新列表核对，不重复提交。');
   this.pending=undefined;this.phase='idle';
  }catch(error){if(epoch===this.epoch){if(this.pending?.committed)this.phase='readback';else if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408){this.pending=undefined;this.phase=error.status===409?'conflict':'idle';}else if(this.pending)this.phase='unknown';}throw error;}finally{this.running=false;}
 }
}
