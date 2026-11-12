type Row=Record<string,any>;
export type PartnerStepKey='identity'|'seal'|'cooperation'|'authority';
export type PartnerStepState='DONE'|'WAITING'|'UNKNOWN'|'OPTIONAL'|'BLOCKED'|'NOT_APPLICABLE';
export interface PartnerStep {key:PartnerStepKey;title:string;state:PartnerStepState;label:string;summary:string;actor:string;actionLabel:string}
const labels:Record<string,string>={COMPLETED:'已认证',REAUTH_REQUIRED:'需重新认证',PROCESSING:'认证处理中',PENDING:'认证待完成',FAILED:'认证未通过',NOT_STARTED:'尚未认证',UNKNOWN:'待核实',NOT_APPLICABLE:'不适用'};
const text=(value:unknown)=>typeof value==='string'&&value.trim()?value:null;
const timestamp=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;

/** Presentation only: these facts never grant signing or automatic seal permissions. */
export function partnerIdentity(owner:Row){
 const dto=owner.enterpriseVerification,raw=dto?.identity,applicable=dto?.applicable!==false;
 const state=!applicable?'NOT_APPLICABLE':raw?.state==='COMPLETED'&&raw?.complete!==true?'UNKNOWN':Object.hasOwn(labels,raw?.state)&&raw.state!=='NOT_APPLICABLE'?raw.state:'UNKNOWN';
 const complete=applicable&&state==='COMPLETED'&&raw?.complete===true;
 const previous=state==='REAUTH_REQUIRED'&&raw?.previous?{companyName:text(raw.previous.companyName),legalName:text(raw.previous.legalName),capturedAt:timestamp(raw.previous.capturedAt)}:undefined;
 return {state,applicable,complete,label:labels[state],companyName:complete?text(raw.companyName):null,creditCode:complete?text(raw.creditCode):null,legalName:complete?text(raw.legalName):null,verifiedAt:complete?timestamp(raw.verifiedAt):null,previous};
}

function cooperationStep(owner:Row,applicable:boolean,now:number):PartnerStep {
 const base={key:'cooperation' as const,title:'合作协议与签署',actor:'运营准备 · 企业本人签署',actionLabel:'办理合作协议'};
 if(!applicable)return {...base,state:'BLOCKED',label:'企业模板不适用于个人主体',summary:'当前电子合作模板仅支持企业主体，请交由运营核对适用文书。',actor:'运营',actionLabel:'查看合作资料'};
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date(now));
 const dateState=(v:Row)=>{
  const valid=(value:unknown)=>value==null||value===''||typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  if(!valid(v.validFrom)||!valid(v.validUntil)||v.validFrom&&v.validUntil&&v.validFrom>v.validUntil)return 'UNKNOWN';
  if(v.validUntil&&v.validUntil<today)return 'EXPIRED';
  if(v.validFrom&&v.validFrom>today)return 'FUTURE';
  return 'CURRENT';
 };
 const agreements:Array<Row>=Array.isArray(owner.agreements)?owner.agreements:[];
 const declared=agreements.filter(a=>a.status==='ACTIVE'&&a.currentVersion?.executionMode==='ELECTRONIC'&&a.currentVersion?.status==='ACTIVE');
 const active=declared.filter(a=>dateState(a.currentVersion)==='CURRENT');
 const latest=agreements.map(a=>a.latestVersion||a.currentVersion).filter(v=>v?.executionMode==='ELECTRONIC');
 const signed=latest.filter(v=>v.status==='SIGNED'),draft=latest.some(v=>v.status==='DRAFT');
 const enabled=owner.allowedActions?.electronicCooperation,availability=enabled===false?'新增电子合作办理暂未开放，请联系平台责任人。':enabled!==true?'新增电子合作办理条件待核实，请刷新详情。':'';
 if(active.length)return {...base,state:'DONE',label:`${active.length} 份协议已生效`,summary:availability||'当前电子合作协议已生效；新签署仍须核对当次业务条件。',actionLabel:'查看合作协议'};
 if(signed.length)return {...base,state:'WAITING',label:signed.every(v=>dateState(v)==='EXPIRED')?'已签协议已到期':'协议已签署，待生效',summary:'请核对协议约定的期间与当前归档结果。'+availability};
 if(enabled===false)return {...base,state:'BLOCKED',label:'电子合作路径未开放',summary:'当前电子合作路径尚未开放，请联系平台责任人核对。',actor:'平台责任人',actionLabel:'查看合作资料'};
 if(enabled!==true)return {...base,state:'UNKNOWN',label:'办理条件待核实',summary:'电子合作办理条件尚未读取，请刷新详情。',actor:'运营',actionLabel:'查看合作资料'};
 if(draft)return {...base,state:'WAITING',label:'合作草稿待准备与签署',summary:'核对当前草稿后准备合作协议，由双方签署并核验归档。'};
 if(declared.some(a=>dateState(a.currentVersion)==='UNKNOWN'))return {...base,state:'UNKNOWN',label:'协议期间待核实',summary:'当前协议的适用日期不完整，请核对协议资料。'};
 if(declared.some(a=>dateState(a.currentVersion)==='FUTURE'))return {...base,state:'WAITING',label:'协议尚未到生效期',summary:'请核对协议约定的生效时间，当前不计入已生效协议。'};
 if(declared.length)return {...base,state:'WAITING',label:'合作协议已到期',summary:'既有协议期间已结束，请核对并办理适用的新协议。'};
 return {...base,state:'WAITING',label:'待登记合作条款',summary:'运营登记车辆、产品、模板及分润条款后，按当前条件准备合作协议。'};
}

export function partnerElectronicProgress(owner:Row,authorities?:{items:Row[];scopeVersion?:number;executionEnabled?:boolean}|null,now=Date.now()){

 const identity=partnerIdentity(owner),dto=owner.enterpriseVerification,rawSeal=dto?.seal;
 const selected=rawSeal?.selected===true,sealState=['READY','REFRESH_REQUIRED','NOT_SELECTED','UNAVAILABLE'].includes(rawSeal?.state)?rawSeal.state:'UNKNOWN';
 const sealReady=identity.complete&&dto?.certification?.state==='VERIFIED'&&selected&&sealState==='READY';
 const seal={selected,state:sealState,ready:sealReady,label:!identity.applicable?'不适用':sealReady?'已选用，已核验':selected?sealState==='UNAVAILABLE'?'已选用，需核对':'已选用，待更新核验':sealState==='NOT_SELECTED'?'尚未选用':sealState==='UNAVAILABLE'?'印章待核验':'待核实',selectedAt:timestamp(rawSeal?.selectedAt),checkedAt:timestamp(rawSeal?.checkedAt),certificationState:dto?.certification?.state||'UNKNOWN'};
 const identitySummary=identity.complete?'企业及当前法人实名认证已完成。':identity.state==='REAUTH_REQUIRED'?'认证资料已变更，请由当前法人按新资料重新认证。':identity.state==='PROCESSING'?'认证正在处理中，请由法人本人查询当前结果。':identity.state==='PENDING'?'请由法人本人继续认证并查询结果。':identity.state==='FAILED'?'请由法人本人核对认证结果并按提示处理。':identity.state==='NOT_STARTED'?'运营核对主体与法人资料后，由法人本人完成企业认证。':!identity.applicable?'个人主体不适用企业实名认证。':'实名证据尚未完整读取，请刷新详情核对。';
 const steps:PartnerStep[]=[{key:'identity',title:'企业实名',state:identity.complete?'DONE':!identity.applicable?'NOT_APPLICABLE':identity.state==='UNKNOWN'?'UNKNOWN':'WAITING',label:identity.complete?'认证已完成':identity.label,summary:identitySummary,actor:identity.complete?'已完成':identity.state==='UNKNOWN'?'运营':'运营登记 · 法人本人认证',actionLabel:identity.complete?'查看认证资料':'查看法人登记与认证入口'},
  {key:'seal',title:'企业印章',state:!identity.applicable?'NOT_APPLICABLE':sealReady?'DONE':sealState==='UNKNOWN'?'UNKNOWN':'WAITING',label:sealReady?'印章已选':seal.label,summary:sealReady?'已选用的企业印章已核验；签署仍按本单条件校验。':selected?sealState==='UNAVAILABLE'?'已选印章当前不可用或归属待核对，请由法人本人重新核验。':'法人本人需重新核验企业证书与已选印章，原选择仍保留。':'请由法人本人完成证书核验并选用企业印章。',actor:'法人本人',actionLabel:'查看印章与核验信息'}];
 steps.push(cooperationStep(owner,identity.applicable,now));
 const authorityEnabled=authorities?.items?.some(item=>item.enabled===true&&!item.revokedAt),platform=authorities?.scopeVersion===3||owner.authorizationScopeVersion===3;
 steps.push(platform?{key:'authority',title:'企业自动签授权',state:authorityEnabled?'DONE':authorities?'OPTIONAL':'UNKNOWN',label:authorityEnabled?(authorities?.executionEnabled?'自动签已就绪':'已授权，执行未开放'):authorities?.items?.some(item=>item.document?.signedAvailable&&item.scopeReviewStatus==='PENDING')?'授权范围待核验':authorities?'尚未有效授权':'授权状态待核实',summary:'客户订单由客户逐份签署、双方企业自动签；合作协议由合作商逐份签署、宁达自动签。实际执行须有有效授权，原业务约定继续有效。',actor:'企业本人办理 · 平台核验',actionLabel:'查看自动签授权'}:{key:'authority',title:'用印授权（可选）',state:authorityEnabled?'DONE':authorities?'OPTIONAL':'UNKNOWN',label:authorityEnabled?'企业已开启':authorities?'未开启自动用印':'授权状态待核实',summary:authorityEnabled?'企业已开启授权，具体用印仍须逐单校验范围与有效性。':'可继续逐份手签；自动用印须另行完成企业本人确认、渠道核验与启用。',actor:'企业本人确认 · 运营核验',actionLabel:'查看独立用印授权'});
 const current=steps.slice(0,3).find(step=>!['DONE','NOT_APPLICABLE'].includes(step.state))||null;
 return {identity,seal,steps,current};
}
