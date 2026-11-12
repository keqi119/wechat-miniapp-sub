import { createHmac } from 'node:crypto';
import { ensure } from '../common/errors';
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([name,item])=>[name,canonical(item)]));
  return value;
}
export function staffDigest(input:unknown,version?:string) {
  const current=process.env.STAFF_COMMAND_DIGEST_KEY_VERSION||'1';
  const keyVersion=version||current;
  let key=keyVersion===current?process.env.STAFF_COMMAND_DIGEST_KEY:undefined;
  if(!key&&process.env.STAFF_COMMAND_DIGEST_KEYS_JSON){
    try{key=JSON.parse(process.env.STAFF_COMMAND_DIGEST_KEYS_JSON)[keyVersion];}catch{/* Fail closed without exposing configuration. */}
  }
  ensure(typeof key==='string'&&Buffer.byteLength(key)>=32,503,'STAFF_COMMAND_NOT_READY','人员操作安全配置尚未就绪');
  return {digest:createHmac('sha256',key).update(JSON.stringify(canonical(input))).digest('hex'),keyVersion};
}
