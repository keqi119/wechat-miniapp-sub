import {useEffect,useState} from 'react';
import {Facts,type Row} from './domain-ui';
import {CompanyLegalEntry} from './company-legal-entry';
import {ElectronicCooperation,ElectronicAuthorities,CollectionAccount} from './electronic-source-forms';
import {partnerIdentity,partnerElectronicProgress,type PartnerStepKey} from './partner-electronic-progress-model';
import './partner-electronic-workspace.css';

export function PartnerIdentityBadge({owner}:{owner:Row}){
 const identity=partnerIdentity(owner);
 return <span className={'status '+(identity.complete?'green':identity.state==='REAUTH_REQUIRED'||identity.state==='FAILED'?'orange':'neutral')}><i/>{identity.label}</span>;
}

export function PartnerEnterpriseIdentity({owner}:{owner:Row}){
 const identity=partnerIdentity(owner);
 return <section className="partner-identity-summary" aria-label="企业实名认证"><div className="partner-stage-heading"><h3>企业实名认证</h3><PartnerIdentityBadge owner={owner}/></div>
  {!identity.applicable?<p className="muted">个人主体不适用企业实名认证。</p>:<><Facts items={[["认证企业",identity.companyName],["统一社会信用代码",identity.creditCode],["认证法人",identity.legalName],["认证完成时间",identity.verifiedAt,'date']]}/>
   {identity.previous?<details className="partner-more"><summary>查看此前认证材料</summary><Facts items={[["此前企业名称",identity.previous.companyName],["此前法人姓名",identity.previous.legalName],["材料记录时间",identity.previous.capturedAt,'date']]}/><p className="muted">此前材料不代表当前资料已通过认证。</p></details>:null}
   {!identity.complete?<p className="muted">{identity.state==='REAUTH_REQUIRED'?'主体或法人认证资料已变更，需由当前法人重新认证。':identity.state==='UNKNOWN'?'认证资料尚未核实，请刷新详情后查看。':'认证完成后显示已核验的企业与法人信息。'}</p>:null}
  </>}
 </section>;
}

export function PartnerElectronicWorkspace({owner,after}:{owner:Row;after:()=>Promise<void>}){
 const [authorities,setAuthorities]=useState<{items:Row[];scopeVersion?:number;executionEnabled?:boolean}|null|undefined>();
 const progress=partnerElectronicProgress(owner,authorities),{identity,seal,current}=progress;
 const [legalOpen,setLegalOpen]=useState(!identity.complete);
 useEffect(()=>setLegalOpen(!identity.complete),[identity.complete]);
 const sectionId=(key:PartnerStepKey)=>`partner-${owner.id}-${key}`;
 const jump=(key:PartnerStepKey)=>{if(key==='identity')setLegalOpen(true);document.getElementById(sectionId(key))?.scrollIntoView({block:'start',behavior:'smooth'});};
 return <section className="partner-electronic-workspace" aria-label="电子签约办理进度">
  <div className="partner-flow-heading"><div><h3>电子签约办理进度</h3><p className="muted">实名认证、印章、协议与用印授权分别核验。</p></div></div>
  <ol className="partner-progress-steps">{progress.steps.map((step,index)=><li key={step.key} className={`is-${step.state.toLowerCase()}${current?.key===step.key?' is-current':''}`}><button type="button" onClick={()=>jump(step.key)} aria-current={current?.key===step.key?'step':undefined}><span className="partner-step-number">{step.state==='DONE'?'✓':index+1}</span><span><strong>{step.title}</strong><small>{step.label}</small></span></button></li>)}</ol>
  <section className={'partner-current-step'+(!current?' is-complete':'')} aria-label="当前办理提示"><div><span>{current?'下一步':'当前进度'}</span><strong>{current?.label||'合作协议已生效'}</strong><p>{current?.summary||progress.steps[2].summary}</p>{current?<small>办理人：{current.actor}</small>:null}</div>{current?<button className="button" type="button" onClick={()=>jump(current.key)}>{current.actionLabel}</button>:null}</section>
  <section className="partner-stage-card" id={sectionId('identity')}><PartnerEnterpriseIdentity owner={owner}/>{identity.applicable?<details className="partner-more" open={legalOpen} onToggle={event=>setLegalOpen(event.currentTarget.open)}><summary>法人登记与认证入口</summary><CompanyLegalEntry ownerId={owner.id} after={after} refreshKey={owner}/></details>:null}</section>
  <section className="partner-stage-card" id={sectionId('seal')}><div className="partner-stage-heading"><h3>企业印章</h3><span className={'status '+(seal.ready?'green':'neutral')}><i/>{seal.label}</span></div>
   {identity.applicable?<><Facts items={[["选用状态",seal.selected?'已选用':'尚未确认选用'],["选用时间",seal.selectedAt,'date'],["印章核验时间",seal.checkedAt,'date'],["企业证书核验",({VERIFIED:'已核验',REFRESH_REQUIRED:'待更新核验',INCOMPLETE:'待完善核验'} as Record<string,string>)[seal.certificationState]||'待核实']]}/><p className="muted">{progress.steps[1].summary}</p>{!seal.ready?<button className="text-button" type="button" onClick={()=>jump('identity')}>查看法人本人办理入口</button>:null}</>:<p className="muted">当前企业印章流程不适用于个人主体。</p>}
  </section>
  <section className="partner-stage-card" id={sectionId('cooperation')}><div className="partner-stage-heading"><h3>合作协议与签署</h3><span className="partner-stage-label">{progress.steps[2].label}</span></div><p className="muted">{progress.steps[2].summary}</p>{identity.applicable?<ElectronicCooperation owner={owner} after={after}/>:null}</section>
  <section className="partner-stage-card" id={sectionId('authority')}><div className="partner-stage-heading"><h3>{owner.authorizationScopeVersion===3?'企业自动签授权':'独立用印授权'} <small>可选</small></h3><span className="partner-stage-label">{progress.steps[3].label}</span></div><p className="muted">{progress.steps[3].summary}</p><details className="partner-more"><summary>查看授权记录与核验操作</summary><ElectronicAuthorities ownerId={owner.id} refreshKey={owner} onState={setAuthorities}/></details></section>
  <details className="partner-stage-card partner-more"><summary>收款账户来源 <span>独立维护，不影响实名状态</span></summary><CollectionAccount ownerId={owner.id}/></details>
  <p className="partner-flow-footnote">认证通过、印章已选或合作草稿已保存，均不等于已获得自动用印授权或可以发起本次签署。</p>
 </section>;
}
