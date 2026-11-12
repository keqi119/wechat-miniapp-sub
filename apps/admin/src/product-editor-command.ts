import {ApiError} from './core.ts';
import {CommandIdentity} from './domain-commands.ts';
type Requester=(path:string,options:{method:string;permission:string;body:Record<string,unknown>})=>Promise<unknown>;
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
export class ProductDraftCommand{
 phase:'idle'|'unknown'|'readback'|'conflict'='idle';
 private identity=new CommandIdentity();
 private pending?:{path:string;method:string;body:Record<string,unknown>;productId?:string;committed:boolean};
 private running=false;
 private epoch=0;
 get hasPending(){return !!this.pending;}
 dispose(){this.epoch++;this.pending=undefined;this.identity=new CommandIdentity();this.phase='idle';}
 get canReadResult(){return !!this.pending?.productId;}
 async execute(path:string,method:string,body:Record<string,unknown>|undefined,productId:string|undefined,request:Requester,readback:(productId:string)=>Promise<void>){
  if(this.running)return;this.running=true;const epoch=this.epoch;
  const current=()=>{if(epoch!==this.epoch)throw new ApiError('登录或权限已变化，原命令已清理',0,'SESSION_CHANGED');};
  try{
   if(!this.pending){if(!body)throw Error('产品配置尚未准备');const snapshot=structuredClone(body);this.pending={path,method,body:{...snapshot,idempotencyKey:this.identity.for(path,snapshot)},productId,committed:false};}
   const pending=this.pending;
   if(!pending.committed){try{const result=await request(pending.path,{method:pending.method,permission:'products.write',body:pending.body});current();pending.committed=true;if(!pending.productId&&result&&typeof result==='object'&&identifier((result as Record<string,unknown>).productId))pending.productId=(result as {productId:string}).productId;}catch(error){current();if(error instanceof ApiError&&error.status>=200&&error.status<300)pending.committed=true;else throw error;}}
   this.phase='readback';
   if(!pending.productId)throw Error('保存请求已返回成功，但未提供产品编号。请到产品仓库核对结果，不要重复保存。');
   current();await readback(pending.productId);current();this.pending=undefined;this.phase='idle';
  }catch(error){if(epoch===this.epoch){if(this.pending?.committed)this.phase='readback';else if(error instanceof ApiError&&error.status>=400&&error.status<500){this.pending=undefined;this.phase=error.status===409?'conflict':'idle';}else if(this.pending)this.phase='unknown';}throw error;}finally{this.running=false;}
 }
}
