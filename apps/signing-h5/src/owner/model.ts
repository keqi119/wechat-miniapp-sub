export interface LegalDocument {id:string;type:string;version:number;title:string;content:string;contentHash?:string}
export interface Session {mode:'PARTNER_READONLY';viewer:{maskedMobile:string};scopes:{ownerId:string;accessVersion:number}[];csrfToken:string;expiresAt:string}
export interface VerificationDisplay {identity?:{complete:boolean;currentAttempt?:boolean;state:"COMPLETED"|"PROCESSING"|"PENDING"|"FAILED"|"NOT_STARTED"|"REAUTH_REQUIRED";previous?:{companyName:string;legalName:string;capturedAt:string};verifiedAt:string|null};state:'READY'|'REFRESH_REQUIRED'|'INCOMPLETE'|'PROCESSING';label:string;message:string;certification:{state:'VERIFIED'|'REFRESH_REQUIRED'|'INCOMPLETE';label:string;message:string};seal:{state:'READY'|'REFRESH_REQUIRED'|'NOT_SELECTED'|'UNAVAILABLE';label:string;message:string};checkedAt:string|null}
export function ownerVerificationLabel(owner:{verificationDisplay?:VerificationDisplay;readyForSigning?:boolean;certificationComplete?:boolean;status:string}) {
 if(owner.verificationDisplay)return owner.verificationDisplay.label;
 if(owner.readyForSigning)return '已核验';
 if(owner.status==='VERIFIED')return owner.certificationComplete===false?'待更新核验':'待完善核验';
 return '待认证';
}
export interface OwnerSummary {subjectType?:'ENTERPRISE'|'INDIVIDUAL';executionMode?:string;admissionStatus?:string;verificationDisplay?:VerificationDisplay;ownerId:string;name:string;status:string;accessVersion:number;memberStatus?:string;vehicleCount?:number}
export interface Seal {id:string;status:string;checkedAt:string|null;imageHash:string|null}
export type AuthorizationMethod='PROVIDER_AUTO_GRANT'|'UNILATERAL_LETTER';
export interface OwnerDetail {authorizationScopeVersion?:number;subjectType?:'ENTERPRISE'|'INDIVIDUAL';executionMode?:string;admissionStatus?:string;identityRelationship?:string;contactPhone?:string;verificationDisplay?:VerificationDisplay;id:string;name:string;creditCode:string;address:string;status:string;revision:number;memberStatus:string;realNameStatus:string;certStatus:string;certificationComplete?:boolean;readyForSigning:boolean;autoSigningEnabled:boolean;authorizationEntryEnabled:boolean;autoSigningExecutionEnabled:boolean;authorizationMethod?:AuthorizationMethod;seals:Seal[];legalRepresentative:{name:string;maskedMobile:string};capabilities:{canStartVerification:boolean;canRefreshVerification:boolean;canSelectSeal:boolean;canRequestAuthority:boolean;canManageAuthority:boolean;canEnableAuthority:boolean};blockers:string[]}
export interface AuthorityTemplate {id:string;version:number;hash:string;title:string}
export interface LegacyAuthorityOptions {scopeVersion?:1;vehicles:{vehicleId:string;vehicle:{title:string}}[];template:AuthorityTemplate|null}
export interface AuthorityOptionsV2 {scopeVersion:2;authorizationMethod?:AuthorizationMethod;delegates:{id:string;name:string}[];documentKinds:{id:string;label:string;template:AuthorityTemplate}[];authorizationNotice:{id:string;version:number;hash:string}|null;authorizationLetterTemplate?:AuthorityTemplate}
export type AuthorityOptions=LegacyAuthorityOptions|AuthorityOptionsV2;
export interface LegacyAuthorityScope {version:1;vehicleIds:string[];templateId:string;templateVersion:number;templateHash:string;validFrom:string;validUntil:string;minMonthlyFeeAmount:number;maxMonthlyFeeAmount:number;minDepositAmount:number;maxDepositAmount:number;minMonths:number;maxMonths:number}
export interface AuthorityScopeV2 {version:2;validFrom:string;validUntil:string;delegates:{id:string;name:string}[];documentKinds:string[]}
export type AuthorityScope=LegacyAuthorityScope|AuthorityScopeV2;
export interface Authority {id:string;ownerId:string;sealId:string;scope:AuthorityScope;scopeHash:string;status:string;enabled:boolean;revision:number;checkedAt:string|null;createdAt:string;method?:AuthorizationMethod;certificateMatchesCurrent?:boolean|null;document?:{state:string;bodyHash:string;sourceSha256?:string|null;signedPdfHash?:string|null;sourceAvailable:boolean;signedAvailable:boolean;withdrawnAt?:string|null;technicalAuthorizationStatus:'UNCONFIRMED'}}
export interface AuthorityForm {vehicleIds:string[];validFrom:string;validUntil:string;minMonthlyFee:string;maxMonthlyFee:string;minDeposit:string;maxDeposit:string;minMonths:string;maxMonths:string}
export interface AuthorityFormV2 {delegateIds:string[];documentKinds:string[];validFrom:string;validUntil:string}
export type AuthorityAction='refresh'|'enable'|'disable'|'revoke'|'resume';
export type AuthorityRequestResult=boolean|{closed:true};
export const loginDocumentTypes=['terms','privacy'];
export const verificationDocumentTypes=['terms','privacy','owner-identity'];
export const authorityDocumentTypes=['terms','privacy','owner-auto-sign'];
export const unilateralGrantee='上海宁达信息科技有限公司';
export const isUnilateralAuthority=(authority:Pick<Authority,'method'|'document'>)=>authority.method==='UNILATERAL_LETTER'||!!authority.document;
export const authorityRequestDocumentTypes=(options:AuthorityOptions|null)=>isAuthorityOptionsV2(options)&&options.authorizationMethod==='UNILATERAL_LETTER'?[...authorityDocumentTypes,'owner-authorization-letter']:authorityDocumentTypes;
export const authorityMethodMatches=(detail:Pick<OwnerDetail,'authorizationMethod'>,options:AuthorityOptions|null)=>(detail.authorizationMethod||'PROVIDER_AUTO_GRANT')===(isAuthorityOptionsV2(options)?options.authorizationMethod||'PROVIDER_AUTO_GRANT':'PROVIDER_AUTO_GRANT');
export const authorityKindLabel=(kind:string)=>kind==='SUBSCRIPTION_WITH_FEES'?'汽车订阅主合同及费用附件':'未支持的文件种类';
export const isAuthorityOptionsV2=(options:AuthorityOptions|null|undefined):options is AuthorityOptionsV2=>options?.scopeVersion===2;
export const documentLabel=(type:string)=>({'terms':'服务协议','privacy':'隐私政策','owner-identity':'企业认证说明','owner-auto-sign':'企业自动用印授权说明','owner-rental-contract':'企业车辆租赁合同模板','owner-authorization-letter':'企业车主单方用印授权书'}[type]||type);

function fail(message:string):never {throw new Error(message);}
export function matchingAuthorityTemplate(documents:LegalDocument[],template:{id:string;version:number;hash:string}|null) {
 if(!template)return undefined;
 return documents.find(doc=>doc.type==='owner-rental-contract'&&doc.id===template.id&&doc.version===template.version&&doc.contentHash===template.hash&&!!doc.content.trim());
}
export function matchingAuthorityNotice(documents:LegalDocument[],options:AuthorityOptionsV2) {
 const notice=options.authorizationNotice;
 if(!notice)return undefined;
 return documents.find(doc=>doc.type==='owner-auto-sign'&&doc.id===notice.id&&doc.version===notice.version&&doc.version>=(options.authorizationMethod==='UNILATERAL_LETTER'?3:2)&&doc.contentHash===notice.hash&&!!doc.content.trim());
}
export function matchingAuthorizationLetter(documents:LegalDocument[],options:AuthorityOptionsV2) {
 const template=options.authorizationLetterTemplate,matching=documents.filter(doc=>doc.type==='owner-authorization-letter');
 if(!template||matching.length!==1||!Number.isInteger(template.version)||template.version<1||!/^[a-f0-9]{64}$/.test(template.hash))return undefined;
 const doc=matching[0];return doc.id===template.id&&doc.version===template.version&&doc.contentHash===template.hash&&!!doc.content.trim()?doc:undefined;
}
function validateV2Choices(scope:Pick<AuthorityScopeV2,'delegates'|'documentKinds'>,options:AuthorityOptionsV2) {
 if(scope.delegates.length!==1||scope.delegates.some(item=>item.id!=='PLATFORM_OPERATOR'||!item.name||!options.delegates.some(candidate=>candidate.id===item.id&&candidate.name===item.name)))fail('请勾选当前平台提供的被授权主体。');
 if(options.authorizationMethod==='UNILATERAL_LETTER'&&scope.delegates[0].name!==unilateralGrantee)fail('本次单方授权书的被授权人须为上海宁达信息科技有限公司，请重新读取资料。');
 if(scope.documentKinds.length!==1||scope.documentKinds.some(kind=>kind!=='SUBSCRIPTION_WITH_FEES'||!options.documentKinds.some(candidate=>candidate.id===kind)))fail('请选择当前支持的合同或文件种类。');
}
export function authorityTemplateReady(documents:LegalDocument[],options:AuthorityOptions|null) {
 if(!options)return false;
 return isAuthorityOptionsV2(options)?!!matchingAuthorityNotice(documents,options)&&(options.authorizationMethod!=='UNILATERAL_LETTER'||!!matchingAuthorizationLetter(documents,options))&&options.documentKinds.length>0&&options.documentKinds.every(kind=>!!matchingAuthorityTemplate(documents,kind.template)):!!matchingAuthorityTemplate(documents,options.template);
}
export function authorityConfirmationKey(detail:OwnerDetail,authority:Authority) {
 return JSON.stringify({ownerId:detail.id,ownerRevision:detail.revision,execution:detail.autoSigningExecutionEnabled,canEnable:detail.capabilities.canEnableAuthority,authority,seal:detail.seals.find(seal=>seal.id===authority.sealId)});
}
export function authorityEnablePayload(detail:OwnerDetail,authority:Authority,documents:LegalDocument[],confirmation:string|null,options?:AuthorityOptions|null) {
 if(isUnilateralAuthority(authority))fail('单方授权书签署不等于取得渠道自动签权限，自动用印尚未开放。');
 if(!detail.autoSigningExecutionEnabled||!detail.capabilities.canEnableAuthority||!detail.capabilities.canManageAuthority)fail('自动用印尚未开放或当前条件不满足，请重新读取企业资料。');
 if(authority.ownerId!==detail.id||authority.status!=='AUTHORIZED'||authority.enabled||!detail.seals.some(seal=>seal.id===authority.sealId&&seal.status==='ACTIVE'))fail('当前授权或印章状态已变化，请重新读取后核对。');
 if(authority.scope.version===2){if(!isAuthorityOptionsV2(options))fail('当前授权主体或文件种类未加载，请重新读取。');validateV2Choices(authority.scope,options);}
 else if(!matchingAuthorityTemplate(documents,{id:authority.scope.templateId,version:authority.scope.templateVersion,hash:authority.scope.templateHash}))fail('当前合同模板与这份授权不一致，请阅读当前模板并重新办理授权。');
 if(!confirmation||confirmation!==authorityConfirmationKey(detail,authority))fail('请重新核对这份已保存授权的完整范围，并单独确认启用。');
 return {enabled:true,revision:authority.revision,scopeHash:authority.scopeHash};
}
export function providerUrl(raw:string):string {
 if(typeof raw!=='string'||raw.length>16384||raw!==raw.trim()||/[\s\\#\u0000-\u001f\u007f]/.test(raw)) fail('供应商地址校验未通过，请联系平台。');
 const authority=/^https:\/\/([^/?#]+)(?:[/?]|$)/.exec(raw)?.[1];
 if(!['realnameverify16.fadada.com','textapi17.fadada.com'].includes(authority||'')) fail('供应商地址校验未通过，请联系平台。');
 let url:URL;try{url=new URL(raw);}catch{return fail('供应商地址校验未通过，请联系平台。');}
 if(url.protocol!=='https:'||url.username||url.password||!['https://realnameverify16.fadada.com','https://textapi17.fadada.com'].includes(url.origin)) fail('供应商地址校验未通过，请联系平台。');
 // The query is supplier-signed: validate without normalizing its bytes.
 return raw;
}
export function validInvitationToken(value:unknown):value is string {
 return typeof value==='string'&&(value.length===24||value.length===43)&&!/[^A-Za-z0-9_-]/.test(value);
}
export function readEntry(pathname:string,search:string) {
 const isReturn=pathname==='/owner/return/'||pathname==='/owner/return';
 return {isReturn,invitationToken:(()=>{const token=new URLSearchParams(search).get('invitationToken')||'';return /^(?:[A-Za-z0-9_-]{24}|[A-Za-z0-9_-]{43})$/.test(token)?token:'';})(),cleanPath:isReturn?'/owner/return/':'/owner/'};
}
export function consentRecords(documents:LegalDocument[],types:string[]) {
 return types.map(type=>{
  const matches=documents.filter(d=>d.type===type);
  if(matches.length!==1||!matches[0].id||!Number.isInteger(matches[0].version)||matches[0].version<1) fail(`当前${documentLabel(type)}未发布或未加载，请联系平台。`);
  return {documentId:matches[0].id,version:matches[0].version};
 });
}
export function documentsCurrent(previous:LegalDocument[],current:LegalDocument[],types:string[]) {
 return JSON.stringify(consentRecords(previous,types))===JSON.stringify(consentRecords(current,types));
}
export function smsPayload(mobile:string) {
 if(!/^1[3-9]\d{9}$/.test(mobile)) fail('请输入正确的 11 位登记手机号。');
 return {mobile};
}
export function loginPayload(mobile:string,code:string,challengeId:string,accepted:boolean,documents:LegalDocument[]) {
 const input=smsPayload(mobile);
 if(!/^[A-Za-z0-9_-]{1,256}$/.test(challengeId))fail('请先获取本次登录验证码。');
 if(!/^\d{6}$/.test(code)) fail('请输入 6 位短信验证码。');
 if(!accepted) fail('请先阅读并同意服务协议及隐私政策。');
 return {challengeId,...input,code,consents:consentRecords(documents,loginDocumentTypes)};
}
export function certificationPayload(accepted:Record<string,boolean>,documents:LegalDocument[]) {
 if(!verificationDocumentTypes.every(type=>accepted[type])) fail('请分别阅读并同意三份认证文案，由法人本人办理。');
 return {accepted:true as const,consents:consentRecords(documents,verificationDocumentTypes)};
}
export function toFen(value:string) {
 if(!/^\d+(?:\.\d{1,2})?$/.test(value)||value.length>14) fail('金额须为非负数字，最多两位小数。');
 const [whole,part='']=value.split('.'),amount=Number(whole)*100+Number(part.padEnd(2,'0'));
 if(!Number.isSafeInteger(amount)||amount>2147483647) fail('金额超出允许范围。');
 return amount;
}
export function authorityPayload(form:AuthorityForm|AuthorityFormV2,options:AuthorityOptions,sealId:string,accepted:boolean,documents:LegalDocument[],idempotencyKey:string) {
 if(!accepted) fail('请明确确认本次完整授权范围及授权文案。');
 if(!sealId) fail('请先选择已核验的企业印章。');
 if(idempotencyKey.length<8||idempotencyKey.length>128) fail('请求标识异常，请重新进入页面。');
 const from=new Date(form.validFrom),until=new Date(form.validUntil);
 if(!Number.isFinite(from.getTime())||!Number.isFinite(until.getTime())||from>=until||until.getTime()<=Date.now()) fail('请填写有效的授权起止时间，截止时间须晚于当前时间。');
 if(isAuthorityOptionsV2(options)){
  if(!('delegateIds' in form)||!Array.isArray(form.delegateIds)||!Array.isArray(form.documentKinds))fail('授权表单已更新，请重新读取。');
  if(!matchingAuthorityNotice(documents,options))fail('当前授权说明未加载或版本已变化，请重新阅读。');
  if(!authorityTemplateReady(documents,options))fail('当前合同样本未加载或版本已变化，请重新读取。');
  const delegates=form.delegateIds.map(id=>{const candidate=options.delegates.find(item=>item.id===id);if(!candidate)fail('请选择当前提供的被授权主体。');return{id:candidate.id,name:candidate.name};});
  const scope:AuthorityScopeV2={version:2,validFrom:from.toISOString(),validUntil:until.toISOString(),delegates,documentKinds:[...form.documentKinds]};
  validateV2Choices(scope,options);
  return {scope,sealId,accepted:true as const,consents:consentRecords(documents,authorityRequestDocumentTypes(options)),idempotencyKey};
 }
 if(!('vehicleIds' in form))fail('授权表单已更新，请重新读取。');
 const template=options.template;
 if(!template||!/^[a-f0-9]{64}$/.test(template.hash)||!Number.isInteger(template.version)||template.version<1) fail('尚无已发布并核实版本的合同模板。');
 if(!form.vehicleIds.length||form.vehicleIds.length>100||new Set(form.vehicleIds).size!==form.vehicleIds.length||form.vehicleIds.some(id=>!options.vehicles.some(v=>v.vehicleId===id))) fail('请选择本企业已审核的车辆。');
 if(!/^\d+$/.test(form.minMonths)||!/^\d+$/.test(form.maxMonths)) fail('期数须为 1 至 60 的整数。');
 const scope:AuthorityScope={version:1,vehicleIds:[...form.vehicleIds].sort(),templateId:template.id,templateVersion:template.version,templateHash:template.hash,validFrom:from.toISOString(),validUntil:until.toISOString(),minMonthlyFeeAmount:toFen(form.minMonthlyFee),maxMonthlyFeeAmount:toFen(form.maxMonthlyFee),minDepositAmount:toFen(form.minDeposit),maxDepositAmount:toFen(form.maxDeposit),minMonths:Number(form.minMonths),maxMonths:Number(form.maxMonths)};
 if(scope.minMonthlyFeeAmount>scope.maxMonthlyFeeAmount||scope.minDepositAmount>scope.maxDepositAmount||scope.minMonths<1||scope.maxMonths>60||scope.minMonths>scope.maxMonths) fail('授权范围下限不能高于上限，期数须为 1 至 60。');
 return {scope,sealId,accepted:true as const,consents:consentRecords(documents,authorityDocumentTypes),idempotencyKey};
}
export function authorityDocumentPath(ownerId:string,authorityId:string,kind:'source'|'signed') {
 if(!/^[A-Za-z0-9_-]+$/.test(ownerId)||!/^[A-Za-z0-9_-]+$/.test(authorityId)||!['source','signed'].includes(kind))fail('授权书地址校验未通过，请重新读取资料。');
 return `/owner/api/owners/${ownerId}/authorities/${authorityId}/document/${kind}`;
}
export function authorityLetterStatus(status:string) {return ({PENDING:'授权书待签署',UNKNOWN:'授权书待核验',SIGNED:'授权书已签署',WITHDRAWN:'本地授权已撤回',REJECTED:'授权书签署已终止'} as Record<string,string>)[status]||'授权书待核验';}
export function canResumeAuthority(detail:OwnerDetail,authority:Authority) {
 const document=authority.document;
 return detail.authorizationEntryEnabled===true&&detail.readyForSigning===true&&detail.capabilities.canManageAuthority===true&&authority.ownerId===detail.id&&authority.method==='UNILATERAL_LETTER'&&['PENDING','UNKNOWN'].includes(authority.status)&&!!document&&!document.withdrawnAt&&!document.signedAvailable&&!document.signedPdfHash&&['DRAFT','PREPARED','UPLOADING','UPLOAD_UNKNOWN','READY','SIGNING','UNKNOWN'].includes(document.state);
}
export function authorityResumePayload(detail:OwnerDetail,authority:Authority) {
 if(!canResumeAuthority(detail,authority))fail('本份授权书当前不能继续签署，请重新查询原记录及企业状态。');
 return {};
}
export function authorityLetterNotice(authority:Authority) {
 if(authority.status==='WITHDRAWN'||authority.document?.withdrawnAt)return '本地授权已撤回并停用，已有签署文件仍保留；此操作不作废已完成的电子签名。';
 if(authority.status==='REJECTED'||authority.document?.state==='REJECTED')return '本份授权书签署已终止，不能继续签署。请查看原文件及结果；如需重新办理，请联系平台核对。自动用印尚未开放。';
 if(authority.status==='SIGNED')return '本企业已签署单方授权书；自动用印尚未开放，当前不会自动盖章。';
 return '请由法人本人核对并签署本次授权书，返回后查询签署结果。自动用印尚未开放。';
}
export function sealImageUrl(image:{imageBase64:string;imageType:string}) {
 const type=image.imageType.toLowerCase().replace(/^image\//,'');
 if(!['png','jpeg','jpg','gif','webp'].includes(type)||image.imageBase64.length>3_000_000||!image.imageBase64||!/^[A-Za-z0-9+/]+={0,2}$/.test(image.imageBase64)) fail('印章预览格式不支持，请联系平台。');
 return `data:image/${type==='jpg'?'jpeg':type};base64,${image.imageBase64}`;
}
export const dateTime=(value:string|null|undefined)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚未核验';
export const money=(value:number)=>`¥${(value/100).toFixed(2)}`;
export function statusLabel(value:string) {return ({VERIFIED:'已核验',PENDING:'待处理',NOT_STARTED:'未开始',UNKNOWN:'待查询',BOUND:'有效',UNBOUND:'未绑定',DISCOVERED:'已发现',ACTIVE:'使用中',AUTHORIZED:'供应商已确认',REVOKING:'撤销待确认',REVOKED:'已撤销',SUSPENDED:'已停用',FAILED:'未通过',DRAFT:'待认证',INVITED:'待认证'} as Record<string,string>)[value]||'待平台核验';}
