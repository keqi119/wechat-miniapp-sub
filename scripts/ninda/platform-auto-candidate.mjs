// Authorization preparation only: the execution gate is deliberately closed.
export const platformAutoChanges=Object.freeze({OWNER_AUTHORIZATION_ENABLED:'true',OWNER_AUTHORIZATION_METHOD:'PROVIDER_AUTO_GRANT',OWNER_AUTHORIZATION_SCOPE_VERSION:'3',OWNER_AUTO_SIGNING_ENABLED:'false'});
export function parseProtectedEnv(raw){
 const values=Object.create(null);
 for(const line of raw.replace(/^\uFEFF/,'').split(/\r?\n/).map(v=>v.trim())){
  if(!line||line.startsWith('#'))continue;
  const m=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);if(!m||Object.hasOwn(values,m[1]))throw Error('PLATFORM_AUTO_ENV_INVALID');
  let value=m[2];if(value.startsWith('"'))value=JSON.parse(value);else if(value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);
  if(typeof value!=='string')throw Error('PLATFORM_AUTO_ENV_INVALID');values[m[1]]=value;
 }return values;
}
export function validatePlatformAutoTransition(before,after,release){
 const require=ok=>{if(!ok)throw Error('PLATFORM_AUTO_CANDIDATE_INVALID');};
 require(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(release));
 const fixed={POSTGRES_DB:'ninda_prod',POSTGRES_USER:'ninda_prod',NEW_ORDER_CONTRACT_MODE:'ELECTRONIC',ESIGN_NEW_REQUESTS_ENABLED:'true',ELECTRONIC_SIGNING_ENABLED:'true',OWNER_LEGAL_H5_ENABLED:'true',OWNER_LEGAL_H5_ONLY:'true',OWNER_AUTO_SIGNING_ENABLED:'false'};
 for(const[k,v]of Object.entries(fixed))require(before[k]===v);
 const changes={...platformAutoChanges,BUILD_VERSION:release,API_IMAGE:'ninda-api:'+release};
 for(const[k,v]of Object.entries(changes))require(after[k]===v);
 for(const[k,v]of Object.entries(before))if(!Object.hasOwn(changes,k))require(after[k]===v);
 for(const k of Object.keys(after))require(Object.hasOwn(before,k)||Object.hasOwn(changes,k));
 for(const key of ['FADADA_APP_ID','FADADA_APP_SECRET','FADADA_PLATFORM_CUSTOMER_ID','FADADA_PLATFORM_SIGNATURE_ID'])require(typeof after[key]==='string'&&after[key].trim().length>0);
 require(after.FADADA_BASE_URL==='https://textapi17.fadada.com/api2/');
 require(Buffer.from(after.ESIGN_IDENTITY_ENCRYPTION_KEY||'','base64').length===32);
 return true;
}
export function buildPlatformAutoCandidateEnv(raw,release){
 const before=parseProtectedEnv(raw),changes={...platformAutoChanges,BUILD_VERSION:release,API_IMAGE:'ninda-api:'+release},after={...before,...changes};
 validatePlatformAutoTransition(before,after,release);
 const seen=new Set(),eol=raw.includes('\r\n')?'\r\n':'\n';
 let result=raw.replace(/(^\uFEFF?|\n)([ \t]*)([A-Z][A-Z0-9_]*)=([^\r\n]*)(\r?)(?=\n|$)/g,(line,prefix,space,key,_v,cr)=>{
  if(!Object.hasOwn(changes,key))return line;seen.add(key);return prefix+space+key+'='+JSON.stringify(changes[key])+cr;
 });
 if(!result.endsWith('\n'))result+=eol;
 for(const[k,v]of Object.entries(changes))if(!seen.has(k))result+=k+'='+JSON.stringify(v)+eol;
 validatePlatformAutoTransition(before,parseProtectedEnv(result),release);return result;
}
