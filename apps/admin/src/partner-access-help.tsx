import {api,can} from './core';

export function PartnerPermissionHelp({portal=false}:{portal?:boolean}){
 const administrator=api.session?.user.role==='ADMIN'&&can(api.session.user.permissions,'users.read');
 return <section className={portal?'domain-section':'panel module-empty partner-permission-help'}>
  {portal?<><h3>手机号只读查看授权</h3><p>当前账号尚未获授查看授权的读取权限。</p></>:<><h2>尚未配置合作资料读取权限</h2><p>当前账号无合作资料读取能力。</p></>}
  <p>在“系统设置 → 人员管理 → 人员详情 → 合作业务能力与实际人员归属”中，按岗位配置：</p>
  <ul>{!portal?<li>合作资料与档案 → 读取资料：查看合作商档案。</li>:null}<li>手机号查看授权 → 读取资料、经办及提交：登记或更换查看手机号。</li></ul>
  <p className="muted">授权后重新登录。提交的查看手机号须由具备权限的人员复核后生效；管理员可自审普通资料并留痕，其他岗位仍须由另一位已核实实际人员复核。</p>
  {administrator?<a className="button" href="#users">前往人员管理配置</a>:<p>请联系平台管理员按岗位配置。</p>}
 </section>;
}

export function LegacyPartnerEntry(){
 return <><div className="page-heading"><div><h1>合作商办理入口已更新</h1><p>合作资料维护和手机号查看授权统一在“合作商档案”办理。</p></div></div><section className="panel module-empty"><a className="button primary" href="#partners">进入合作商档案</a><p>登记合作商管理员的姓名及手机号，无需创建平台员工账号或先注册小程序。</p>{can(api.session?.user.permissions??[],'contracts.read')?<a href="#contracts">查看历史电子合同</a>:null}</section></>;
}
