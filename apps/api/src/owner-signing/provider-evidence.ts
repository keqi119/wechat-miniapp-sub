import {createHash} from 'node:crypto';

export class OwnerProviderError extends Error {
  constructor(readonly code:string){super(code);this.name='OwnerProviderError';}
}
export function requireEvidence(condition:unknown,code='OWNER_PROVIDER_EVIDENCE'):asserts condition {
  if(!condition)throw new OwnerProviderError(code);
}
export function record(value:unknown):Record<string,unknown> {
  let parsed=value;
  if(typeof parsed==='string'&&parsed.length<=2_000_000){try{parsed=JSON.parse(parsed);}catch{parsed=null;}}
  requireEvidence(parsed&&typeof parsed==='object'&&!Array.isArray(parsed));
  return parsed as Record<string,unknown>;
}
export function scalar(value:unknown):string|undefined {
  if(typeof value==='string'&&value.trim())return value.trim();
  if(typeof value==='number'&&Number.isSafeInteger(value))return String(value);
  return undefined;
}
export function requiredText(value:unknown,max=200):string {
  requireEvidence(typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value),'OWNER_PROVIDER_INPUT');return value.trim();
}
export function providerId(value:unknown,max=64):string {
  const result=requiredText(value,max);requireEvidence(/^[A-Za-z0-9]+$/.test(result),'OWNER_PROVIDER_IDENTIFIER');return result;
}
export function checkEcho(body:Record<string,unknown>,keys:string[],expected:string){
  for(const key of keys)if(body[key]!==undefined&&body[key]!==null)requireEvidence(scalar(body[key])===expected,'OWNER_PROVIDER_BINDING');
}
export function enterpriseEvidence(raw:unknown,input:{customerId:string;serialNo:string;name:string;creditCode:string}){
  const data=record(raw);checkEcho(data,['customer_id','customerId'],input.customerId);
  requireEvidence(scalar(data.transactionNo)===input.serialNo&&scalar(data.type)==='2','OWNER_COMPANY_BINDING');
  const company=record(data.company),manager=data.manager?record(data.manager):{};
  if(company.companyName!==undefined)requireEvidence(scalar(company.companyName)===input.name,'OWNER_COMPANY_BINDING');
  if(company.organization!==undefined)requireEvidence(scalar(company.organization)===input.creditCode,'OWNER_COMPANY_BINDING');
  const verified=scalar(company.status)==='4'&&scalar(company.organizationType)==='0'&&scalar(company.companyName)===input.name&&scalar(company.organization)===input.creditCode&&scalar(manager.status)==='2'&&['1','2'].includes(scalar(manager.type)||'')&&!!scalar(manager.personName)&&!!scalar(manager.idCard)&&/^1\d{10}$/.test(scalar(manager.mobile)||'');
  return {customerId:input.customerId,serialNo:input.serialNo,verified,status:scalar(company.status)||'UNKNOWN',name:input.name,creditCode:input.creditCode,
    // Server-side identity matching only. Controllers must not serialize this record.
    manager:verified?{name:scalar(manager.personName)!,mobile:scalar(manager.mobile)!,identityNo:scalar(manager.idCard)!,type:scalar(manager.type)!}:undefined};
}
export function authorizationEvidence(raw:unknown,input:{customerId:string;contractId:string;transactionId:string}){
  const data=record(raw);checkEcho(data,['customer_id','customerId'],input.customerId);
  const status=scalar(data.status)||'UNKNOWN';
  if(status!=='1'||scalar(data.authType)!=='1')return{...input,authorized:false,status};
  requireEvidence(scalar(data.contractId)===input.contractId,'OWNER_AUTH_BINDING');
  const transaction=scalar(data.transactionNo)||scalar(data.transactionId);
  requireEvidence(transaction===input.transactionId,'OWNER_AUTH_BINDING');
  checkEcho(data,['transactionNo','transactionId'],input.transactionId);
  return{...input,authorized:true,status};
}
export function sealEvidence(raw:unknown,customerId:string){
  let data=raw;if(typeof data==='string'){try{data=JSON.parse(data);}catch{data=null;}}
  requireEvidence(Array.isArray(data)&&data.length<=100,'OWNER_SEAL_RESPONSE');
  const seen=new Set<string>();return data.map(value=>{
    const seal=record(value);checkEcho(seal,['customer_id','customerId'],customerId);
    requireEvidence(scalar(seal.signature_type)==='2','OWNER_SEAL_TYPE');
    const signatureId=providerId(seal.signature_id);requireEvidence(!seen.has(signatureId),'OWNER_SEAL_DUPLICATE');seen.add(signatureId);
    const base64=requiredText(seal.signature_img_base64,2_000_000);requireEvidence(/^[A-Za-z0-9+/]+={0,2}$/.test(base64),'OWNER_SEAL_IMAGE');
    const bytes=Buffer.from(base64,'base64');requireEvidence(bytes.length>8&&bytes.toString('base64')===base64,'OWNER_SEAL_IMAGE');
    const isPng=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),isJpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    requireEvidence(isPng||isJpeg,'OWNER_SEAL_IMAGE');
    return{customerId,signatureId,isDefault:scalar(seal.signature_scope)==='1',source:scalar(seal.signature_source)||'UNKNOWN',imageBase64:base64,imageType:isPng?'image/png':'image/jpeg',imageHash:createHash('sha256').update(bytes).digest('hex')};
  });
}
