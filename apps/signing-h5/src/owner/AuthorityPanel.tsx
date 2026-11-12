import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {authorityConfirmationKey,authorityMethodMatches,authorityPayload,authorityRequestDocumentTypes,authorityTemplateReady,isAuthorityOptionsV2,matchingAuthorizationLetter,matchingAuthorityNotice,unilateralGrantee} from './model';
import type {Authority,AuthorityAction,AuthorityForm,AuthorityFormV2,AuthorityOptions,AuthorityRequestResult,LegalDocument,OwnerDetail} from './model';
import {ActionFeedback,LegalLinks,Notice} from './Common';
import {AuthorityRecord} from './AuthorityRecord';
import {authoritySection} from './workspace';
import type {Feedback,FeedbackMap} from './workspace';

const emptyForm:AuthorityForm={vehicleIds:[],validFrom:'',validUntil:'',minMonthlyFee:'',maxMonthlyFee:'',minDeposit:'',maxDeposit:'',minMonths:'',maxMonths:''};
const emptyV2:AuthorityFormV2={delegateIds:[],documentKinds:[],validFrom:'',validUntil:''};
export function AuthorityPanel({detail,authorities,options,optionsError,documents,busy,onRequest,onManage,onPreview,onLegal,feedback,onRefresh}:{detail:OwnerDetail;authorities:Authority[];options:AuthorityOptions|null;optionsError:string;documents:LegalDocument[];busy:boolean;onRequest:(body:ReturnType<typeof authorityPayload>)=>Promise<AuthorityRequestResult>;onManage:(authority:Authority,action:AuthorityAction,confirmation?:string)=>Promise<boolean>;onPreview:(id:string)=>Promise<string|null>;onLegal:(type:string)=>void;feedback:FeedbackMap;onRefresh:(key?:string)=>void}){
 const [legacy,setLegacy]=useState<AuthorityForm>(emptyForm),[v2,setV2]=useState<AuthorityFormV2>(emptyV2),[accepted,setAccepted]=useState(false),[validation,setValidation]=useState<Feedback>();
 const [historyOpen,setHistoryOpen]=useState(false);
 const optionsV2=isAuthorityOptionsV2(options)?options:null,optionsV1=options&&!isAuthorityOptionsV2(options)?options:null,form=optionsV2?v2:legacy;
 const unilateral=detail.authorizationMethod==='UNILATERAL_LETTER',methodCurrent=authorityMethodMatches(detail,options),consentTypes=authorityRequestDocumentTypes(options);
 const attempt=useRef<{body:string;key:string}|null>(null);
 const documentVersion=documents.map(d=>`${d.id}:${d.version}:${d.contentHash||''}`).join(',');
 const scopeContext=JSON.stringify({owner:detail.id,revision:detail.revision,authorizationMethod:detail.authorizationMethod,options,seal:detail.seals.find(s=>s.status==='ACTIVE')});
 useEffect(()=>{setAccepted(false);},[documentVersion,scopeContext]);
 const templatesReady=authorityTemplateReady(documents,options);
 function change<K extends keyof AuthorityForm>(key:K,value:AuthorityForm[K]){setLegacy(old=>({...old,[key]:value}));setAccepted(false);}
 function changeV2<K extends keyof AuthorityFormV2>(key:K,value:AuthorityFormV2[K]){setV2(old=>({...old,[key]:value}));setAccepted(false);}
 function changeTime(key:'validFrom'|'validUntil',value:string){if(optionsV2)changeV2(key,value);else change(key,value);}
 async function submit(event:FormEvent){
  event.preventDefault();setValidation(undefined);
  try{
   if(!detail.capabilities.canRequestAuthority||!options)throw new Error('当前尚不满足发起授权的条件，请查看缺项说明。');
   if(!methodCurrent)throw new Error('授权办理方式已更新，请重新读取企业资料后核对。');
   if(!templatesReady)throw new Error('完整合同样本或授权说明未加载，请重新读取后核对。');
   const seal=detail.seals.find(s=>s.status==='ACTIVE');const serialized=JSON.stringify({form,sealId:seal?.id,options,documentVersion});
   if(attempt.current?.body!==serialized)attempt.current={body:serialized,key:crypto.randomUUID()};
   const submitted=attempt.current,body=authorityPayload(form,options,seal?.id||'',accepted,documents,submitted.key),result=await onRequest(body);
   if(typeof result==='object'&&result.closed&&attempt.current===submitted){attempt.current=null;setAccepted(false);setValidation({error:'上一份授权已撤回或关闭，请重新勾选确认后生成新授权书。'});}
   else if(result===true)setAccepted(false);
  }catch(e){setValidation({error:(e as Error).message});}
 }
 const missing=[...(!documents.some(d=>d.type==='owner-auto-sign')?['企业自动用印授权说明尚未发布。']:[]),...(!methodCurrent?['授权办理方式已更新，请重新读取企业资料。']:[]),...(optionsV2&&!matchingAuthorityNotice(documents,optionsV2)?['新版授权说明未加载或版本不一致，请重新读取企业资料。']:[]),...(unilateral&&optionsV2&&!matchingAuthorizationLetter(documents,optionsV2)?['单方授权书模板尚未发布或版本不一致，请重新读取企业资料。']:[]),...(unilateral&&optionsV2&&(optionsV2.delegates.length!==1||optionsV2.delegates[0].id!=='PLATFORM_OPERATOR'||optionsV2.delegates[0].name!==unilateralGrantee)?['被授权主体配置不一致，请联系平台核对。']:[]),...(options&&!templatesReady?['完整合同样本或授权文案未加载或与当前版本不一致，请重新读取企业资料。']:[]),...(optionsV1&&!optionsV1.vehicles.length?['尚无归属审核通过的车辆。']:[])];
 const canRequest=detail.capabilities.canRequestAuthority&&!!options&&templatesReady&&(!!optionsV2||!!optionsV1?.vehicles.length)&&!missing.length;
 const current=authorities.filter(item=>authoritySection(item)==='current'),attention=authorities.filter(item=>authoritySection(item)==='attention'),history=authorities.filter(item=>authoritySection(item)==='history');
 const historyFeedback=JSON.stringify(history.map(item=>[item.id,feedback[`${detail.id}:authority:${item.id}`]]));
 useEffect(()=>{if(history.some(item=>{const value=feedback[`${detail.id}:authority:${item.id}`];return value?.error||value?.note;}))setHistoryOpen(true);},[historyFeedback]);
 const records=(items:Authority[])=>items.map(authority=><AuthorityRecord key={authorityConfirmationKey(detail,authority)+documentVersion} detail={detail} authority={authority} options={options} documents={documents} busy={busy} onManage={onManage} onPreview={onPreview} onLegal={onLegal} feedback={feedback[`${detail.id}:authority:${authority.id}`]} onRefresh={()=>onRefresh(`authority:${authority.id}`)}/>);
 return <section className="owner-section">
  <div className="section-title"><h2>签约授权</h2><span className="tag">自动盖章未开放</span></div>
  <div className="signing-mode"><strong>业务合同签署方式：逐单手动确认</strong><p>授权宁达管理电子签流程后，具体订单仍由法人在“业务合同”中核对并签署。自动盖章需另行具备执行权限并明确启用，本期未开放。</p></div>
  <h3 className="subheading">当前已签授权</h3>{current.length?<div className="authority-list current-authorities">{records(current)}</div>:<div className="empty compact"><p>暂无当前已签的单方授权书</p></div>}
  {attention.length>0&&<><h3 className="subheading">待处理授权 <span className="tag">{attention.length} 份</span></h3><div className="authority-list attention-authorities">{records(attention)}</div></>}
  {history.length>0&&<details className="authority-history" open={historyOpen} onToggle={event=>setHistoryOpen(event.currentTarget.open)}><summary>历史渠道授权及已关闭记录（{history.length}）</summary><p className="fineprint">保留实际办理记录。撤销待确认的旧渠道授权请查询结果，不需要重复签署宁达授权书。</p><div className="authority-list">{records(history)}</div></details>}
  <h3 className="subheading">新授权办理</h3>
  <p className="muted">{optionsV2?'认证完成和选用印章不会自动产生用印授权。请选择授权期间、被授权主体和合同或文件种类。':'认证完成和选用印章不会自动产生用印授权。授权仅适用于您明确确认的车辆、合同模板、期限、金额和期数。'}</p>
  {unilateral&&<Notice>授权书正文中的被授权人固定为{unilateralGrantee}，由本企业法人代表车主企业单方签署。授权书签署与自动用印分别办理，当前自动用印尚未开放。</Notice>}
  {!unilateral&&detail.authorizationEntryEnabled&&!detail.autoSigningExecutionEnabled&&<Notice>授权可办理，自动用印尚未开放</Notice>}
  {optionsError&&<Notice>授权选项暂未读取完整，请重新读取企业资料后再办理。</Notice>}
  {missing.length>0&&<Notice><ul>{missing.map(item=><li key={item}>{item}</li>)}</ul></Notice>}
  {!detail.capabilities.canRequestAuthority&&<p className="fineprint">{!detail.authorizationEntryEnabled?'平台授权入口尚未开放，已取得的认证结果仍保留。':'当前还有授权条件未满足，请查看企业缺项说明。已完成的认证无需重复办理。'}</p>}
  {canRequest&&<details className="scope-editor"><summary>填写新的授权范围</summary>
   <form onSubmit={submit}><fieldset disabled={busy}>
    <div className="purpose"><h3>授权印章</h3><p>本企业当前使用中的印章。提交前请在“企业与印章”页签核对图样。</p></div>
    <div className="form-grid"><label className="field">授权开始时间<input type="datetime-local" value={form.validFrom} onChange={e=>changeTime('validFrom',e.target.value)} required/></label><label className="field">授权截止时间<input type="datetime-local" value={form.validUntil} onChange={e=>changeTime('validUntil',e.target.value)} required/></label></div>
    <p className="fineprint">时间使用当前设备时区；提交后将保存为明确的起止时间。</p>
    {optionsV2?<>
     <fieldset className="scope-options"><legend>被授权主体</legend>{optionsV2.delegates.map(item=><label className="check" key={item.id}><input type="checkbox" checked={v2.delegateIds.includes(item.id)} onChange={e=>changeV2('delegateIds',e.target.checked?[...v2.delegateIds,item.id]:v2.delegateIds.filter(id=>id!==item.id))}/><span>{item.name}</span></label>)}</fieldset>
     <fieldset className="scope-options"><legend>授权的合同／文件种类</legend>{optionsV2.documentKinds.map(item=><label className="check" key={item.id}><input type="checkbox" checked={v2.documentKinds.includes(item.id)} onChange={e=>changeV2('documentKinds',e.target.checked?[...v2.documentKinds,item.id]:v2.documentKinds.filter(id=>id!==item.id))}/><span>{item.label}</span></label>)}</fieldset>
     <div className="template-summary"><button className="text-button" type="button" onClick={()=>onLegal('owner-rental-contract')}>阅读当前合同样本</button><p className="fineprint">本期包含汽车订阅主合同及同份文件中的费用附件。同类经批准发布的新版本适用于后续订单；新增文件种类须另行授权。</p></div>
     {unilateral&&<button className="text-button" type="button" onClick={()=>onLegal('owner-authorization-letter')}>阅读单方授权书模板</button>}
     <div className="purpose"><h3>本次确认</h3><p>授权仅适用于上述期间、被授权主体及文件种类。每笔订单仍须核对实际出租企业、车辆归属及客户确认的完整交易条件。{unilateral?'提交后生成本企业单方授权书，由法人本人前往法大大核对正文并签署，返回后主动查询签署结果。':'发起后需本人前往法大大办理，并主动查询结果。'}</p></div>
    </>:optionsV1&&<>
     <fieldset className="vehicle-options"><legend>授权车辆（仅限已审核车辆）</legend>{optionsV1.vehicles.map(item=><label className="check" key={item.vehicleId}><input type="checkbox" checked={legacy.vehicleIds.includes(item.vehicleId)} onChange={e=>change('vehicleIds',e.target.checked?[...legacy.vehicleIds,item.vehicleId]:legacy.vehicleIds.filter(id=>id!==item.vehicleId))}/><span>{item.vehicle.title}</span></label>)}</fieldset>
     <div className="template-summary"><p>{optionsV1.template!.title} · v{optionsV1.template!.version}</p><p className="fineprint">模板 ID：{optionsV1.template!.id}</p><button className="text-button" type="button" onClick={()=>onLegal('owner-rental-contract')}>阅读完整合同模板</button><details className="hash-details"><summary>查看合同模板摘要</summary><code>{optionsV1.template!.hash}</code></details></div>
     <div className="form-grid">{([['minMonthlyFee','最低月费（元）'],['maxMonthlyFee','最高月费（元）'],['minDeposit','最低押金（元）'],['maxDeposit','最高押金（元）'],['minMonths','最少期数（月）'],['maxMonths','最多期数（月）']] as const).map(([key,label])=><label className="field" key={key}>{label}<input inputMode={key.includes('Months')?'numeric':'decimal'} autoComplete="off" value={legacy[key]} onChange={e=>change(key,e.target.value)} placeholder={key.includes('Months')?'1–60':'0.00'} required/></label>)}</div>
     <div className="purpose"><h3>本次确认</h3><p>已选择 {legacy.vehicleIds.length} 辆车。授权限定上述模板版本、起止时间、月费、押金及期数；范围外合同不能使用本次授权。发起后需本人前往法大大办理，并主动查询结果。</p></div>
    </>}
    <label className="check"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>我已核对上述完整授权范围，阅读并同意<LegalLinks types={consentTypes} onLegal={onLegal}/>，由本人办理本次授权。</span></label>
    <ActionFeedback value={validation} busy={busy}/><button className="primary full">{unilateral?'生成授权书并前往签署':'确认范围并前往授权'} <span aria-hidden="true">↗</span></button>

   </fieldset></form>
  </details>}
    <ActionFeedback value={feedback[`${detail.id}:authority-request`]} busy={busy} canRefresh={detail.capabilities.canRefreshVerification} onRefresh={()=>onRefresh('authority-request')}/>
 </section>;
}
