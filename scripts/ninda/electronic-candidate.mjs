// Local review helper only. It cannot read credentials, write environments or deploy.
export const electronicChanges=Object.freeze({NEW_ORDER_CONTRACT_MODE:'ELECTRONIC',CUSTOMER_IDENTITY_POLICY:'SIGNING_REQUIRED',ESIGN_NEW_REQUESTS_ENABLED:'true',ELECTRONIC_SIGNING_ENABLED:'true',CUSTOMER_IDENTITY_ENABLED:'true',FADADA_ENABLED:'true',FADADA_ACCOUNT_REGISTER_ENABLED:'true',FADADA_REALNAME_VERIFY_ENABLED:'true',FADADA_SIGNING_ENABLED:'true',MINIAPP_SIGNING_ENABLED:'true',MINIAPP_FACE_BRIDGE_ENABLED:'false',OWNER_ONBOARDING_ENABLED:'true',OWNER_LEGAL_H5_ENABLED:'true',OWNER_LEGAL_H5_ONLY:'true'});
export function validateElectronicTransition(before,after,release){
 const require=(ok)=>{if(!ok)throw Error('ELECTRONIC_CANDIDATE_INVALID');};
 require(before && after && before.POSTGRES_DB==='ninda_prod' && before.POSTGRES_USER==='ninda_prod');
 for(const [key,value] of Object.entries(electronicChanges))require(after[key]===value);
 const allowed=new Set(Object.keys(electronicChanges));
 require(['OFFLINE','ELECTRONIC'].includes(before.NEW_ORDER_CONTRACT_MODE));
 require(after.OWNER_AUTO_SIGNING_ENABLED==='false');
 if(release!==undefined){require(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(release));require(after.BUILD_VERSION===release&&after.API_IMAGE==='ninda-api:'+release);allowed.add('BUILD_VERSION');allowed.add('API_IMAGE');}
 for(const [key,value] of Object.entries(before))if(!allowed.has(key))require(after[key]===value);
 for(const key of Object.keys(after))require(key in before || allowed.has(key));
 for(const key of ['FADADA_APP_ID','FADADA_APP_SECRET','FADADA_PLATFORM_CUSTOMER_ID','FADADA_PLATFORM_SIGNATURE_ID'])require(typeof after[key]==='string' && after[key].trim().length>0);
 require(after.FADADA_BASE_URL==='https://textapi17.fadada.com/api2/');
 require(Buffer.from(after.ESIGN_IDENTITY_ENCRYPTION_KEY||'','base64').length===32);
 const hosts=(after.MINIAPP_SIGNING_PROVIDER_HOSTS||'').split(',').map(v=>v.trim());
 require(['textapi17.fadada.com','realnameverify16.fadada.com'].every(v=>hosts.includes(v)) && hosts.every(v=>['textapi17.fadada.com','realnameverify16.fadada.com'].includes(v)));
 return true;
}

// Exact observed old -> candidate transitions; all other decoded values are immutable.
export const scopedVirtualChanges=Object.freeze({ESIGN_NEW_REQUESTS_ENABLED:'true',ELECTRONIC_SIGNING_ENABLED:'true',FADADA_SIGNING_ENABLED:'true',MINIAPP_SIGNING_ENABLED:'true',MINIAPP_FACE_BRIDGE_ENABLED:'false'});
export function validateScopedVirtualTransition(before,after,release){
 const require=ok=>{if(!ok)throw Error('SCOPED_VIRTUAL_CANDIDATE_INVALID');};
 require(before && after && before.POSTGRES_DB==='ninda_prod' && before.POSTGRES_USER==='ninda_prod');
 const prior={ESIGN_NEW_REQUESTS_ENABLED:'false',FADADA_SIGNING_ENABLED:'false',MINIAPP_SIGNING_ENABLED:'false',MINIAPP_FACE_BRIDGE_ENABLED:'true'};
 for(const [key,value] of Object.entries(prior))require(before[key]===value);
 require(!Object.hasOwn(before,'ELECTRONIC_SIGNING_ENABLED'));
 for(const [key,value] of Object.entries(scopedVirtualChanges))require(after[key]===value);
 const required={SWAP_CREDIT_PURCHASE_ENABLED:'true',NEW_ORDER_CONTRACT_MODE:'OFFLINE',CUSTOMER_IDENTITY_POLICY:'MANUAL_REVIEW',CUSTOMER_IDENTITY_ENABLED:'true',FADADA_ENABLED:'true',FADADA_ACCOUNT_REGISTER_ENABLED:'true',FADADA_REALNAME_VERIFY_ENABLED:'true',OWNER_ONBOARDING_ENABLED:'true',OWNER_LEGAL_H5_ENABLED:'true',PORTAL_SMS_ENABLED:'true',OWNER_AUTO_SIGNING_ENABLED:'false',H5_SIGNING_ENABLED:'false',OWNER_LEGAL_H5_ONLY:'false',FADADA_BASE_URL:'https://textapi17.fadada.com/api2/',MINIAPP_SIGNING_PROVIDER_HOSTS:'textapi17.fadada.com,realnameverify16.fadada.com'};
 for(const [key,value] of Object.entries(required))require(after[key]===value);
 const allowed=new Set(Object.keys(scopedVirtualChanges));
 if(release!==undefined){require(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(release));require(after.BUILD_VERSION===release&&after.API_IMAGE==='ninda-api:'+release);allowed.add('BUILD_VERSION');allowed.add('API_IMAGE');}
 for(const [key,value] of Object.entries(before))if(!allowed.has(key))require(after[key]===value);
 for(const key of Object.keys(after))require(Object.hasOwn(before,key)||allowed.has(key));
 for(const key of ['FADADA_APP_ID','FADADA_APP_SECRET','FADADA_PLATFORM_CUSTOMER_ID','FADADA_PLATFORM_SIGNATURE_ID','ALIYUN_SMS_ACCESS_KEY_ID','ALIYUN_SMS_ACCESS_KEY_SECRET','ALIYUN_SMS_SIGN_NAME','ALIYUN_SMS_LOGIN_TEMPLATE_CODE'])require(typeof after[key]==='string'&&after[key].trim().length>0);
 require((after.SESSION_SECRET||'').length>=32 && Buffer.from(after.ESIGN_IDENTITY_ENCRYPTION_KEY||'','base64').length===32);
 return true;
}

export function buildScopedVirtualCandidate(before,release){
 const after={...before,...scopedVirtualChanges,BUILD_VERSION:release,API_IMAGE:'ninda-api:'+release};
 validateScopedVirtualTransition(before,after,release);return after;
}

// Match the existing protected preflight's deliberately narrow dotenv grammar.
// Preserve every unrelated raw line; only approved ASCII release/gate values are written.
export function buildScopedVirtualCandidateEnv(raw,release){
 const before=Object.create(null);
 for(const rawLine of raw.replace(/^\uFEFF/,'').split(/\r?\n/)){
  const line=rawLine.trim();if(!line||line.startsWith('#'))continue;
  const match=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if(!match||Object.hasOwn(before,match[1]))throw Error('SCOPED_VIRTUAL_ENV_INVALID');
  let value=match[2];if(value.startsWith('"'))value=JSON.parse(value);else if(value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);
  if(typeof value!=='string')throw Error('SCOPED_VIRTUAL_ENV_INVALID');before[match[1]]=value;
 }
 const after=buildScopedVirtualCandidate(before,release),changes={...scopedVirtualChanges,BUILD_VERSION:release,API_IMAGE:after.API_IMAGE},seen=new Set();
 const eol=raw.includes('\r\n')?'\r\n':'\n';
 let result=raw.replace(/(^\uFEFF?|\n)([ \t]*)([A-Z][A-Z0-9_]*)=([^\r\n]*)(\r?)(?=\n|$)/g,(line,prefix,space,key,_value,cr)=>{
  if(!Object.hasOwn(changes,key))return line;seen.add(key);return prefix+space+key+'='+JSON.stringify(changes[key])+cr;
 });
 if(!result.endsWith('\n'))result+=eol;
 for(const [key,value] of Object.entries(changes))if(!seen.has(key))result+=key+'='+JSON.stringify(value)+eol;
 return result;
}

export function buildElectronicCandidateEnv(raw,release){
 const before=Object.create(null);
 for(const rawLine of raw.replace(/^\uFEFF/,'').split(/\r?\n/)){
  const line=rawLine.trim();if(!line||line.startsWith('#'))continue;
  const match=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if(!match||Object.hasOwn(before,match[1]))throw Error('ELECTRONIC_ENV_INVALID');
  let value=match[2];if(value.startsWith('"'))value=JSON.parse(value);else if(value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);
  if(typeof value!=='string')throw Error('ELECTRONIC_ENV_INVALID');before[match[1]]=value;
 }
 const after={...before,...electronicChanges,BUILD_VERSION:release,API_IMAGE:'ninda-api:'+release};validateElectronicTransition(before,after,release);const changes={...electronicChanges,BUILD_VERSION:release,API_IMAGE:after.API_IMAGE},seen=new Set();
 const eol=raw.includes('\r\n')?'\r\n':'\n';
 let result=raw.replace(/(^\uFEFF?|\n)([ \t]*)([A-Z][A-Z0-9_]*)=([^\r\n]*)(\r?)(?=\n|$)/g,(line,prefix,space,key,_value,cr)=>{
  if(!Object.hasOwn(changes,key))return line;seen.add(key);return prefix+space+key+'='+JSON.stringify(changes[key])+cr;
 });
 if(!result.endsWith('\n'))result+=eol;
 for(const [key,value] of Object.entries(changes))if(!seen.has(key))result+=key+'='+JSON.stringify(value)+eol;
 return result;
}
