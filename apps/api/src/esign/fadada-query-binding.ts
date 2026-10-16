// API 4.6.4 returns status only: signer identity is bound by the signed request,
// not echoed in the response. Receipts exist only for the live, exact-host query.
type Identity = {contractId:string;customerId:string;transactionId:string};
const receipts = new WeakMap<object,{identity:Identity;body:string}>();
export function recordFadadaQuery(raw:object,identity:Identity){
 receipts.set(raw,{identity:{...identity},body:JSON.stringify(raw)});
}
function bound(raw:any,expected:Identity){
 const receipt=raw&&typeof raw==='object'?receipts.get(raw):undefined;
 return !!receipt&&JSON.stringify(raw)===receipt.body&&Object.entries(expected).every(([k,v])=>receipt.identity[k as keyof Identity]===v);
}
export function isFadadaQueryAbsent(value:any,expected:Identity){
 const raw=value?.raw;
 return bound(raw,expected)&&[1201,'1201'].includes(raw.code)&&raw.data===null&&raw.msg==='签署记录为空'&&value.status==='UNKNOWN'&&!value.resultCode&&!value.providerContractId&&!value.providerCustomerId&&!value.providerTransactionId;
}
export function matchesFadadaQuery(value:any,expected:Identity){
 const raw=value?.raw;
 if(!bound(raw,expected))return false;
 if(![1,'1'].includes(raw.code)||!raw.data||typeof raw.data!=='object'||Array.isArray(raw.data))return false;
 const statuses:Record<string,string>={'3000':'SIGNED','3001':'FAILED','3002':'FAILED','3003':'FAILED','9999':'UNKNOWN'};
 const result=raw.data.result;
 if(typeof result!=='string'||!statuses[result]||value.resultCode!==result||value.status!==statuses[result])return false;
 const aliases:Record<string,keyof Identity>={contract_id:'contractId',contractId:'contractId',customer_id:'customerId',customerId:'customerId',transaction_id:'transactionId',transactionId:'transactionId',transaction_no:'transactionId',transactionNo:'transactionId'};
 function echoesMatch(node:any,depth=0):boolean{
  if(!node||typeof node!=='object')return true;
  if(depth>5||Array.isArray(node))return false;
  return Object.entries(node).every(([key,val])=>aliases[key]?val===expected[aliases[key]]:echoesMatch(val,depth+1));
 }
 return echoesMatch(raw)&&(!value.providerContractId||value.providerContractId===expected.contractId)&&(!value.providerCustomerId||value.providerCustomerId===expected.customerId)&&(!value.providerTransactionId||value.providerTransactionId===expected.transactionId);
}
