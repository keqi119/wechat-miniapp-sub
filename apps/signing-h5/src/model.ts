export type Kind = 'SUBSCRIPTION'|'HANDOVER'|'AMENDMENT';
export interface Readiness { readyForSigning:boolean; signingEligible:boolean; state:string; realNameStatus:string; certBound:boolean; nextAction:string; }
export interface SigningRecord { kind:Kind; id:string; title:string; status:string; createdAt:string; orderId:string; canSign:boolean; canSync:boolean; sourceFileId?:string|null; signedFileId?:string|null; documentHash?:string; readiness?:Readiness; blockers?:string[]; revision?:number; actualAt?:string; body?:string; }
export interface Session { customer:{id:string;maskedMobile:string}; csrfToken:string; expiresAt:string; }
export interface LegalDocument { id:string; type:'terms'|'privacy'; version:number; title:string; content:string; }
export function verificationPayload(name:string,idCardNo:string,accepted:boolean,privacy:LegalDocument|undefined){
  if(!accepted)throw new Error('请先阅读并确认实名认证用途。');
  if(!privacy||privacy.type!=='privacy'||!privacy.id||!Number.isInteger(privacy.version))throw new Error('当前隐私政策未能加载，请刷新后重试。');
  return{name:name.trim(),idCardNo:idCardNo.toUpperCase(),consent:{accepted:true as const,documentId:privacy.id,version:privacy.version}};
}
export const kindLabels:Record<Kind,string>={SUBSCRIPTION:'订阅合同',HANDOVER:'交接确认',AMENDMENT:'延期补充协议'};
const statuses:Record<string,string>={DRAFT:'待准备',PENDING:'签署处理中',SIGNED:'已签署',AWAITING_SIGNATURE:'待签署',AWAITING_CONFIRMATION:'待确认',CUSTOMER_CONFIRMED:'已确认事实',PUBLISHED:'待核对事实',OBJECTION_SUBMITTED:'异议处理中',SUPERSEDED:'已被新版本替代',COMPLETED:'已完成',REJECTED:'已拒绝',EXPIRED:'已过期',CANCELLED:'已取消',AWAITING_FINANCE:'待资金核清',READY:'待生效',APPLIED:'已生效',REVIEW_PENDING:'待复核',REVIEWED:'已复核',NOT_STARTED:'未开始',UNKNOWN:'待查询',VERIFIED:'已核验',REALNAME_PENDING:'实名处理中',CERT_BINDING_PENDING:'待核验证书',SIGNING_ENABLED:'可签署'};
export const statusLabel=(value:string)=>statuses[value]||'状态待核对';
export const recordPath=(record:Pick<SigningRecord,'kind'|'id'>)=>`/records/${record.kind}/${encodeURIComponent(record.id)}`;
export const filePath=(id:string)=>`/miniapp-sign/api/files/${encodeURIComponent(id)}`;
export const dateTime=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'时间待查询':new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date)+'（北京时间）';};
export function navigation(search: string): {kind:Kind;id:string}|null {
  const query=new URLSearchParams(search),kind=query.get('kind'),id=query.get('id');
  return kind&&['SUBSCRIPTION','HANDOVER','AMENDMENT'].includes(kind)&&id&&/^[A-Za-z0-9_-]{1,160}$/.test(id)?{kind:kind as Kind,id}:null;
}
export function signingPayload(record: {kind:string;revision?:number}) {
  if(record.kind!=='AMENDMENT')return{};
  if(!Number.isInteger(record.revision)||(record.revision as number)<0)throw new Error('协议版本尚未取得，请刷新详情。');
  return {revision:record.revision};
}
export function externalUrl(value: string): string {
  let url:URL;try{url=new URL(value);}catch{throw new Error('签署链接无效，请刷新后重试。');}
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))throw new Error('签署链接未通过安全校验，请联系平台。');
  // Exact provider hosts are allowlisted by the server; never manufacture a signing URL here.
  return url.href;
}
