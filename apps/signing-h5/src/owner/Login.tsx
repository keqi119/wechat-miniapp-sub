import {useEffect,useState} from 'react';
import type {FormEvent} from 'react';
import {loginPayload,smsPayload} from './model';
import type {Feedback} from './workspace';
import type {LegalDocument} from './model';
import type {SmsChallenge} from './App';
import {ActionFeedback,LegalLinks} from './Common';
import {invitationConfirmPayload,invitationPreviewPayload,validateInvitationPreview} from './simple-model';
import type {InvitationPreview} from './simple-model';
export function Login({documents,busy,onLogin,onSms,onLegal,onPreview,onConfirm,bindOnly=false,onCancel,initialInvitation='',onReload}:{documents:LegalDocument[];busy:boolean;onLogin:(body:ReturnType<typeof loginPayload>,invitationToken?:string)=>Promise<boolean>;onSms:(body:ReturnType<typeof smsPayload>,invitationToken?:string)=>Promise<SmsChallenge|null>;onLegal:(type:string)=>void;onPreview:(body:ReturnType<typeof invitationPreviewPayload>)=>Promise<InvitationPreview|null>;onConfirm:(body:ReturnType<typeof invitationConfirmPayload>)=>Promise<boolean>;bindOnly?:boolean;onCancel?:()=>void;initialInvitation?:string;onReload?:()=>void}){
 const [mode,setMode]=useState<'invitation'|'sms'>('invitation'),[mobile,setMobile]=useState(''),[code,setCode]=useState(''),[invitationCode,setInvitationCode]=useState(initialInvitation),[legalInvitation,setLegalInvitation]=useState(''),[preview,setPreview]=useState<InvitationPreview|null>(null),[challenge,setChallenge]=useState<{id:string;mobile:string;expiresAt:number}|null>(null),[agreed,setAgreed]=useState(false),[validation,setValidation]=useState<Feedback>(),[cooldown,setCooldown]=useState(0);
 const legalVersion=documents.filter(d=>['terms','privacy'].includes(d.type)).map(d=>`${d.id}:${d.version}`).join(',');
 useEffect(()=>setAgreed(false),[legalVersion]);
 useEffect(()=>{if(!cooldown)return;const timer=setTimeout(()=>setCooldown(c=>c-1),1000);return()=>clearTimeout(timer);},[cooldown]);
 useEffect(()=>{if(!preview)return;const timer=setTimeout(()=>{setPreview(null);setAgreed(false);setValidation({error:'本次确认已过期，请重新输入手机号及邀请码。'});},Math.max(0,Date.parse(preview.expiresAt)-Date.now()));return()=>clearTimeout(timer);},[preview]);
 function changeMode(next:'invitation'|'sms'){setMode(next);setLegalInvitation('');setPreview(null);setInvitationCode('');setCode('');setChallenge(null);setAgreed(false);setValidation(undefined);}
 async function request(){try{setValidation(undefined);setChallenge(null);setCode('');const requestedMobile=mobile,value=await onSms(smsPayload(mobile),legalInvitation||undefined);if(value){
  if(value.accepted!==true||!/^[A-Za-z0-9_-]{1,256}$/.test(value.challengeId)||!Number.isSafeInteger(value.expiresInSeconds)||value.expiresInSeconds<=0||!Number.isSafeInteger(value.resendAfterSeconds)||value.resendAfterSeconds<0)throw Error('验证码响应异常，请重新获取。');
  setChallenge({id:value.challengeId,mobile:requestedMobile,expiresAt:Date.now()+value.expiresInSeconds*1000});setCooldown(value.resendAfterSeconds);setValidation({note:'验证码已提交短信通道，不代表手机已收到。若未收到，请稍后重试或联系运营核对登记手机号。',tone:'info'});
 }}catch(e){setValidation({error:(e as Error).message});}}
 async function submit(event:FormEvent){event.preventDefault();try{
  setValidation(undefined);
  if(mode==='invitation'&&preview?.mode!=='ELECTRONIC_LEGAL'){
   if(preview){const body=invitationConfirmPayload(preview,agreed,documents);setPreview(null);setAgreed(false);if(await onConfirm(body)){setMobile('');setInvitationCode('');}return;}
   const body=invitationPreviewPayload(mobile,invitationCode);const result=await onPreview(body);if(result){setPreview(validateInvitationPreview(result));setLegalInvitation(result.mode==='ELECTRONIC_LEGAL'?invitationCode:'');setInvitationCode('');setAgreed(false);}return;
  }
  if(!challenge||challenge.mobile!==mobile||challenge.expiresAt<=Date.now())throw Error('请重新获取本次登录验证码。');const body=loginPayload(mobile,code,challenge.id,agreed,documents);setCode('');if(await onLogin(body,legalInvitation||undefined)){setChallenge(null);setMobile('');}
 }catch(e){setValidation({error:(e as Error).message});}}
 const legalReady=['terms','privacy'].every(type=>{const rows=documents.filter(d=>d.type===type);return rows.length===1&&!!rows[0].id&&Number.isInteger(rows[0].version)&&rows[0].version>0;});
 return <section className="login-card simple-login">{bindOnly&&<button className="text-button" disabled={busy} onClick={onCancel}>‹ 返回我的公司</button>}<div className="section-kicker"><span>企业服务</span><span className="hero-line"/><span>宁达汽车</span></div><h1>{bindOnly?'绑定其他公司':'进入企业服务'}</h1><p className="muted">首次使用手机号和邀请码确认公司，<br/>绑定后可随时用短信验证码登录。</p>
 {!bindOnly&&<nav className="login-methods" aria-label="登录方式"><button type="button" aria-pressed={mode==='invitation'} disabled={busy} onClick={()=>changeMode('invitation')}>首次绑定</button><button type="button" aria-pressed={mode==='sms'} disabled={busy} onClick={()=>changeMode('sms')}>短信登录</button></nav>}
 {!legalReady&&<p role="alert">登录协议未完整加载。<button type="button" onClick={onReload}>重新加载协议</button></p>}<ActionFeedback value={validation} busy={busy}/><form onSubmit={submit}><fieldset disabled={busy}>
 {preview?<section className="invitation-company"><span className="eyebrow">请确认您的公司</span><h2>{preview.companyName}</h2><p>{preview.maskedMobile}</p><p>{preview.mode==='ELECTRONIC_LEGAL'?'请由当前登记法人本人获取短信验证码，完成绑定后办理实名与签章。':'绑定后仅可查看本公司的合作车辆、合作协议与分润统计。'}</p><p className="fineprint">本次确认不代表签署合作协议，也不授予业务修改或电子签章权限。</p><button className="text-button" type="button" onClick={()=>{setPreview(null);setLegalInvitation('');setChallenge(null);setCode('');setAgreed(false);}}>返回修改绑定信息</button></section>:<><label className="field">登记手机号<input type="tel" inputMode="numeric" autoComplete="off" maxLength={11} value={mobile} onChange={e=>{setMobile(e.target.value.replace(/\D/g,''));setChallenge(null);setCode('');setPreview(null);}} placeholder="请输入 11 位手机号" required/></label>
 {mode==='invitation'?<label className="field">邀请码<input autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={43} value={invitationCode} onChange={e=>setInvitationCode(e.target.value.trim())} placeholder="运营提供的完整邀请码" required/></label>:<label className="field">短信验证码<span className="code-field"><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} placeholder="6 位验证码" required/><button type="button" className="text-button" disabled={cooldown>0} onClick={()=>void request()}>{cooldown?`${cooldown} 秒后重试`:'获取验证码'}</button></span></label>}</>}
 {preview?.mode==='ELECTRONIC_LEGAL'&&<label className="field">短信验证码<span className="code-field"><input inputMode="numeric" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} required/><button type="button" className="text-button" disabled={cooldown>0} onClick={()=>void request()}>{cooldown?`${cooldown} 秒后重试`:'获取验证码'}</button></span></label>}
 {(preview||mode==='sms')&&<label className="check"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} aria-label="同意登录服务协议及隐私政策"/><span>我已阅读并同意<LegalLinks types={['terms','privacy']} onLegal={onLegal}/></span></label>}
 <button className="primary full" disabled={!legalReady}>{busy?'正在处理…':preview?'确认绑定并进入':mode==='invitation'?'查看受邀公司':'登录企业服务'}<span aria-hidden="true">↗</span></button></fieldset></form>
 <p className="fineprint">{mode==='invitation'?'邀请码由运营提供，默认 7 天有效，重发后旧码立即失效。已绑定或未收到确认结果时，请使用短信登录。':'短信仅用于验证持号人。只有已独立绑定或已开通的公司会显示在本次登录范围内。'}</p></section>;
}
