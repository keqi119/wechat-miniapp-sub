import {terminationReadiness} from './termination-details-model.ts';
import {contractWorkflow} from './contract-workflow-model.ts';
/** Read-only presentation. Business permissions, versions and transaction gates remain authoritative. */
export type ProcessState='DONE'|'CURRENT'|'BLOCKED'|'WAITING'|'NOT_APPLICABLE'|'UNKNOWN';
export type ProcessAction={key:string;label:string;kind:'OPEN_DETAIL'|'OPEN_FORM'|'WAIT'|'REFRESH';target?:{resource?:string;id?:string;section?:string;orderId?:string};enabled:boolean;disabledReason?:string;expectedRevision?:number};
export type ProcessCheck={code:string;label:string;state:ProcessState;description?:string;ownerLabel?:string;action?:ProcessAction};
export type ProcessStep={key:string;label:string;state:ProcessState;summary:string;checks:ProcessCheck[];actions:ProcessAction[]};
export type ProcessView={version:1;observedAt?:string;orderRevision?:number;currentStep:string;terminal?:unknown;steps:ProcessStep[];blockers:ProcessCheck[];attention:ProcessCheck[];primaryAction?:ProcessAction|null};
type Row=Record<string,any>;
const list=(value:unknown):Row[]=>Array.isArray(value)?value.filter(v=>v&&typeof v==='object'):[];
const current=(row:Row)=>[...list(row.versions)].sort((a,b)=>(Number(b.version)||0)-(Number(a.version)||0))[0]||{};
const wait=(label:string,description?:string):ProcessAction=>({key:'wait',label,kind:'WAIT',enabled:false,disabledReason:description});
const open=(key:string,label:string,resource:string,id:string,section=key,enabled=true):ProcessAction=>({key,label,kind:'OPEN_FORM',target:{resource,id,section},enabled,...(!enabled?{disabledReason:'当前账号仅可查看，请联系有权限的工作人员办理。'}:{})});
const detail=(key:string,label:string,resource:string,id?:string,orderId?:string):ProcessAction=>({key,label,kind:'OPEN_DETAIL',target:{resource,id,orderId},enabled:true});
const refresh:ProcessAction={key:'refresh',label:'重新读取进度',kind:'REFRESH',enabled:true};
function check(code:string,label:string,state:ProcessState,description:string,action?:ProcessAction,ownerLabel?:string):ProcessCheck{return{code,label,state,description,action,ownerLabel};}
function base(steps:[string,string][]):ProcessView{return{version:1,currentStep:steps[0][0],steps:steps.map(([key,label])=>({key,label,state:'WAITING',summary:'等待前置事项完成。',checks:[],actions:[]})),blockers:[],attention:[]};}
function stage(p:ProcessView,key:string,state:ProcessState,summary:string){const s=p.steps.find(s=>s.key===key)!;s.state=state;s.summary=summary;return s;}
function at(p:ProcessView,key:string,summary:string,action?:ProcessAction,state:ProcessState='CURRENT'){p.currentStep=key;stage(p,key,state,summary);p.primaryAction=action;if(action)p.steps.find(s=>s.key===key)!.actions=[action];return p;}
function unknown(p:ProcessView,message:string){return at(p,p.currentStep,message,refresh,'UNKNOWN');}

function aTerminationIssue(row:Row,v:Row){return row.kind==='TERMINATION'?terminationReadiness(v.scopeSnapshot?.terminationDetails,row.terminationContext):'';}
export function archiveProcess(row:Row,actorId:string,writable:boolean,role='OPERATIONS'):ProcessView{
 const v=current(row),flow=contractWorkflow(v),p=base([['template','模板版本'],['generate','生成合同'],['preview','预览及打印'],['signed','上传并审核'],['archive','合同归档']]);
 const action=(key:string,label:string)=>open(`archive-${key}-${v.id||row.id}`,label,'offline-archives',row.id,`archive-${key}-${v.id||row.id}`,writable);
 if(!flow.known)return unknown(p,'当前合同版本未完整读取，请刷新核对。');
 for(const step of flow.steps)if(step.done)stage(p,step.key,'DONE','本步已完成，可查看记录。');
 if(flow.archived){at(p,'archive','合同已归档，保留版本、签字原件和审核记录。',action('files','查看归档原件'),'DONE');}
 else if(flow.rejected){at(p,'signed',v.status==='REJECTED'?'审核退回，请保留本版并建立补正版本。':'本版已失效，请保留历史并建立补正版本。',open(`archive-correct-${row.id}`,'建立补正版本','offline-archives',row.id,`archive-correct-${row.id}`,writable),'BLOCKED');p.blockers.push(check(v.status,'本版待补正','BLOCKED',v.reviewReason||v.invalidationReason||'请核对本版说明后建立新版。'));}
 else if(v.status==='REVIEWED')at(p,'archive','签字材料已审核通过；点击归档后才可继续关联业务。',action('archive','归档本版合同'));
 else if(v.status==='SUBMITTED'){const own=role!=='ADMIN'&&[row.createdBy,v.createdBy,v.submittedBy,...(v.editorIds||[]),...list(v.files).map(f=>f.uploadedBy)].includes(actorId);const text=own?'本账号参与录入、提交或上传，请由其他有权限人员审核。':'签字材料已锁定，管理员可审核本人普通资料并留痕；其他岗位须独立审核本版。';at(p,'signed',text,own?wait('等待其他人员审核',text):action('review','审核签字材料'));if(own)p.blockers.push(check('ARCHIVE_SELF_REVIEW','等待其他人员审核','WAITING',text));}
 else if(flow.current==='template')at(p,'template','当前合同尚未绑定已启用模板，请核对档案。',refresh,'UNKNOWN');
 else if(aTerminationIssue(row,v)&&['generate','preview'].includes(flow.current))at(p,flow.current,aTerminationIssue(row,v),row.terminationContext?action('termination','编辑终止安排'):refresh,'BLOCKED'); else if(flow.current==='generate')at(p,'generate','按本单已确认的交易条件与模板版本生成合同。',action('prepare','生成合同'));
 else if(flow.current==='preview')at(p,'preview','打开合同预览并打印；核对内容后确认，才能上传签字版。',action('confirm-print','确认预览及打印'));
 else if(!flow.materialsComplete){at(p,'signed','上传线下签字版，登记签署日期、合同编号及页数后提交审核。',action(list(v.files).length?'metadata':'upload',list(v.files).length?'登记签署信息':'上传签字版'));}
 else at(p,'signed','签字材料已齐备，可提交审核；管理员可审核本人普通资料，其他岗位须独立审核。',action('submit','提交签字材料审核'));
 const feedback=list(v.feedback).filter(f=>f.status==='OPEN');if(feedback.length)p.attention.push(check('ARCHIVE_FEEDBACK_OPEN','资料反馈待处理','BLOCKED',`本版有 ${feedback.length} 条未处理反馈。`,action('feedback','处理资料反馈')));
 return p;
}
export function insuranceProcess(row:Row,actorId:string,writable:boolean,now=new Date(),role='OPERATIONS'):ProcessView{
 const p=base([['details','保单资料'],['originals','本版原件'],['review','独立复核'],['result','核验结果']]),v=current(row),files=list(row.files);
 const action=(key:string,label:string)=>open(`insurance-${key}-${v.id}`,label,'insurance-policies',row.id,`insurance-${key}-${v.id}`,writable);
 if(!v.id||!['DRAFT','SUBMITTED','APPROVED','REJECTED'].includes(v.status))return unknown(p,'保单当前版本未完整读取，请刷新核对。');
 stage(p,'details','DONE',`当前办理第 ${v.version||'—'} 版，保单原件、主体、车辆及有效期须匹配。`);
 const selected=Array.isArray(v.fileIds)?v.fileIds:[];
 if(selected.length)stage(p,'originals','DONE',`已有 ${selected.length} 份原件选入本版。`);
 if(v.status==='APPROVED'){
  stage(p,'review','DONE','本版已完成逐车原件核验。');at(p,'result','核验结论已保存；实际保障仍按时间、车辆及保单原件核对。',action('files','查看保单原件'),'DONE');
  if(v.changeKind==='CANCELLATION')p.attention.push(check('POLICY_CANCELLED','退保版本','NOT_APPLICABLE','本版是退保记录，不能作为有效车辆保障。'));
  else if(Number.isFinite(Date.parse(v.startAt))&&Date.parse(v.startAt)>now.getTime())p.attention.push(check('COVERAGE_NOT_STARTED','保障尚未开始','WAITING','已复核不等于当前已生效；保障尚未开始。'));
  else if(Number.isFinite(Date.parse(v.endAt))&&Date.parse(v.endAt)<=now.getTime())p.attention.push(check('COVERAGE_ENDED','保障已结束','BLOCKED','请登记续保新保单并完成复核；原核验记录保留。',open(`insurance-renew-${row.id}`,'登记续保新保单','insurance-policies',row.id,`insurance-renew-${row.id}`,writable)));
 }else if(v.status==='SUBMITTED'){
  const own=role!=='ADMIN'&&(v.submittedBy===actorId||v.createdBy===actorId||(v.editedByIds||[]).includes(actorId)||files.some(f=>selected.includes(f.fileId)&&f.uploadedBy===actorId));
  const text=own?'本账号参与创建、编辑、上传或提交；请由其他具备权限的人员核验。':'请逐车核对原件、险种、额度、免赔及除外责任。';
  at(p,'review',text,own||!writable?wait('等待独立复核',text):action('review',role==='ADMIN'?'审核保单':'独立复核保单'));
  if(own)p.blockers.push(check('INSURANCE_SELF_REVIEW','需其他人员复核','WAITING',text,undefined,'其他审核人员'));
 }else if(v.status==='REJECTED'){at(p,'details','本版已退回；按复核说明补正，保留原版本。',action('edit','补正并另建草稿'),'BLOCKED');p.blockers.push(check('INSURANCE_REJECTED','待补正','BLOCKED',v.reviewReason||'请核对本版审核说明与原件。'));}
 else if(!selected.length){at(p,'originals','上传原件后，还需选择哪些附件属于当前保单版本。',action(files.length?'edit':'upload',files.length?'编辑并选择原件':'上传保单原件'));p.blockers.push(check('POLICY_FILES_REQUIRED','本版尚未选定原件','WAITING','已上传附件不会自动选入本版；请上传后编辑并选择本版原件。',action(files.length?'edit':'upload',files.length?'选择本版原件':'上传保单原件')));}
 else at(p,'review','核对本版资料与原件后提交复核。',action('submit','提交保单复核'));
 return p;
}
export function productProcess(row:Row,writable:boolean,benefits=false):ProcessView{
 const p=base([['draft','版本资料'],['publish','入库与启停']]),versions=list(row.versions),v=current(row),published=versions.filter(v=>v.status==='PUBLISHED');
 if(!v.id)return unknown(p,'产品版本尚未完整读取，请刷新。');
 if(benefits)return at(p,'publish','此处维护产品引用的服务配置版本；不代表客户已购买或权益已履约。',open(`product-new-${row.id}`,'新增配置版本','benefit-definitions',row.id,`product-new-${row.id}`,writable),'DONE');
 if(v.status==='DRAFT'){
  at(p,'draft',`第 ${v.version} 版为草稿，编辑完成后发布；生成草稿不会替换已发布版本。`,v.configurationVersion===2?open(`product-edit-${v.id}`,'编辑当前草稿','products',row.id,`product-edit-${v.id}`,writable):open(`product-new-${row.id}`,'新增模块化版本','products',row.id,`product-new-${row.id}`,writable));
  p.steps[1].actions=[open(`product-publish-${v.id}`,'发布产品','products',row.id,`product-publish-${v.id}`,writable)];
  if(published.length)p.attention.push(check('PRODUCT_EXISTING_VERSION','已有发布版本','DONE',`第 ${published.map(x=>x.version).join('、')} 版仍按当前状态使用；新草稿不改变历史订单。`));
 }else if(v.status==='PUBLISHED'){stage(p,'draft','DONE','本版条款与适用范围已冻结。');at(p,'publish',`第 ${v.version} 版已进入产品仓库。组合并发布商品后才对客开放；调整条款请另建版本，历史订单沿用原快照。`,open(`product-new-${row.id}`,'新增版本','products',row.id,`product-new-${row.id}`,writable),'DONE');}
 else if(v.status==='SUSPENDED')at(p,'publish','本版暂停新售；重新启用不自动重发已下架商品，历史订单保持。',open(`product-resume-${v.id}`,'重新启用','products',row.id,`product-resume-${v.id}`,writable),'WAITING');
 else if(v.status==='RETIRED')at(p,'publish','本版已停用，不再用于新申请；历史订单继续保留。',open(`product-new-${row.id}`,'新增版本','products',row.id,`product-new-${row.id}`,writable),'NOT_APPLICABLE');
 else return unknown(p,'当前产品状态无法确认，请重新读取。');return p;
}
export function partnerProcess(row:Row,company:Row|undefined,writable:boolean):ProcessView{
 const p=base([['agreement','合作协议与车辆'],['viewer','公司管理员查看']]),active=list(row.agreements).filter(a=>a.status==='ACTIVE'&&a.currentVersion?.fileIds?.length&&a.currentVersion?.partnerRateBps!=null&&a.currentVersion?.vehicleIds?.length);
 const agreement=open(`partner-agreement-${row.id}`,'登记合作协议','partners',row.id,`partner-agreement-${row.id}`,writable);
 if(active.length)stage(p,'agreement','DONE',`已登记 ${active.length} 份有效协议；按本版协议文件、比例和车辆用于新订单。`);
 else{at(p,'agreement','登记协议文件、合作商分润比例并关联车辆，其他事项可后续补充。',agreement);p.blockers.push(check('PARTNER_AGREEMENT_REQUIRED','待登记有效合作协议','WAITING','草稿不作为当前有效合作约定；请填写文件、明确比例和车辆。',agreement));}
 const viewer=open(`partner-viewer-${row.id}`,'查看管理员绑定','partners',row.id,`partner-viewer-${row.id}`,writable);
 const status=company?.status,summary=status==='BOUND'?'管理员已确认绑定，只读查看本公司车辆与分润。':status==='PENDING'?'邀请码已生成，等待指定手机号本人确认绑定。':status==='DISABLED'?'公司查看访问已停用，如需恢复请重新邀请并本人确认。':company?'尚未设置公司管理员，可登记手机号生成邀请码。':'管理员状态尚未读取，请打开绑定区域核对。';
 stage(p,'viewer',status==='BOUND'?'DONE':company?'WAITING':'UNKNOWN',summary).actions=[viewer];
 if(active.length)at(p,'viewer',summary,status==='PENDING'?wait('等待管理员本人绑定'):viewer,status==='BOUND'?'DONE':company?'WAITING':'UNKNOWN');
 p.attention.push(check('PARTNER_VIEWER_INDEPENDENT','查看授权独立办理','NOT_APPLICABLE','公司管理员绑定与协议登记是独立事项；未绑定不影响已登记协议使用，也不授予修改权限。'));
 return p;
}
const documentLabels:Record<string,string>={TERMINATION_REQUIRED:'提前还车终止文件待归档',RETURN_RECEIPT_REQUIRED:'还车确认单待完成',OFFLINE_ARCHIVE_REQUIRED:'纸质资料待归档',ARCHIVE_SNAPSHOT_MISMATCH:'资料与当前业务版本不一致',ARCHIVE_FEEDBACK_OPEN:'资料反馈待处理'};
export function returnProcess(row:Row):ProcessView{
 const p=base([['documents','还车与纸质资料'],['usage','里程核算'],['funds','费用与退款'],['complete','结算完成']]);
 if(!row.id||!['READINGS_REQUIRED','PENDING_PAYMENT','DISPUTED','COMPLETED'].includes(row.status))return unknown(p,'还车结算进度未完整读取，请刷新。');
 if(row.status==='COMPLETED'){p.steps.forEach(s=>{s.state='DONE';s.summary='服务端已完成本项核验。';});return at(p,'complete','本单退订结算已完成，原账单与审核记录保留。',undefined,'DONE');}
 const doc=Array.isArray(row.documentBlockers)?row.documentBlockers:null,periods=Array.isArray(row.unsettledPeriodIds)?row.unsettledPeriodIds:null,bills=Array.isArray(row.bills)?row.bills:null;
 if(doc?.length)for(const code of doc)p.blockers.push(check(code,documentLabels[code]||'资料条件待核对','BLOCKED',documentLabels[code]||'请查看对应档案或订单当前办理条件。',detail('return-documents','办理本单纸质资料','offline-archives',undefined,row.orderId)));
 if(doc?.length===0)stage(p,'documents','DONE','当前返回的纸质资料条件已满足。');
 if(periods?.length)for(const id of periods)p.blockers.push(check('USAGE_'+id,'订阅月待核算','WAITING','补齐本月真实读数及证据，再核对结算。',detail('return-usage-'+id,'办理该月里程','usage-periods',id,row.orderId)));
 if(periods?.length===0)stage(p,'usage','DONE','当前没有未结订阅月。');
 if(Number(row.depositRefundRequiredAmount)>0)p.blockers.push(check('DEPOSIT_REFUND_REQUIRED','押金尚待退清','WAITING',`应退押金尚余 ¥${(row.depositRefundRequiredAmount/100).toFixed(2)}，以渠道退款成功为准。`,detail('return-refunds','查看本单退款','refunds',undefined,row.orderId)));
 if(row.exceptionalCash===true)p.blockers.push(check('EXCEPTIONAL_CASH','异常到账待核对','BLOCKED','存在尚未核清的渠道到账，请核对原支付及退款结果。',detail('return-payments','查看支付记录','payments',undefined,row.orderId)));
 if(row.status==='DISPUTED')p.blockers.unshift(check('RETURN_DISPUTED','客户争议待处理','BLOCKED',row.disputeReason||'先核对并处理客户争议；解除挂起不等于资金已结清。',open('return-resolve','处理结算争议','return-settlements',row.id,'return-resolve')));
 if(row.canComplete===true&&row.status==='PENDING_PAYMENT'&&doc?.length===0&&periods?.length===0&&row.depositRefundRequiredAmount===0&&row.exceptionalCash!==true&&!p.blockers.length){stage(p,'funds','DONE','服务端已确认本次费用与退款条件满足。');return at(p,'complete','所有当前结算条件已核清，可提交完成；提交时服务端仍会重新核验。',open('return-complete','核清并完成退订结算','return-settlements',row.id,'return-complete'));}
 if(!p.blockers.length)p.blockers.push(check('RETURN_STATUS_CHECK','结算条件仍待核对','UNKNOWN','当前尚不可完成；可能存在在途支付、退款或其他未核清事项，请重新读取本单核账结果。',refresh));
 const first=p.blockers[0];at(p,row.status==='DISPUTED'?'complete':doc?.length?'documents':periods?.length?'usage':'funds',first.description||'仍有待办事项。',first.action||refresh,first.state==='UNKNOWN'?'UNKNOWN':'BLOCKED');
 if(bills?.length)p.attention.push(check('RETURN_BILL_SCOPE','逐项核对账单','WAITING','未来尚未履约账单由最终结算规则处理；不要仅因草稿或待支付标签要求客户付清全部未来租金。'));
 return p;
}
export function handoverProcess(row:Row,resource='handover-tasks'):ProcessView{
 const h=resource==='handovers'?row:row.handover,online=h?.confirmationMode==='ONLINE_RECORD',p=base([['field','现场材料'],['customer','客户确认'],['paper',online?'线上证据留存':'纸质单归档'],['complete','正式交接']]),offline=(row.contractMode||h?.executionMode)==='OFFLINE';
 if(row.status==='CANCELLED'||row.contextChanged)return at(p,'field',row.contextChanged?'车辆或任务批次已变化，请核对并重新派发采集。':'任务已取消，原现场材料保留。',detail('handover-order','返回关联订单','orders',row.orderId),'BLOCKED');
 if(!h||h.status==='DRAFT')return at(p,'field','现场人员按派单采集真实查验资料并发布；后台派单不代表已交车。',wait('等待现场人员采集'), 'WAITING');
 if(!['PUBLISHED','CUSTOMER_CONFIRMED','OBJECTION_SUBMITTED','COMPLETED','SUPERSEDED'].includes(h.status))return unknown(p,'交接当前版本状态待核对。');
 stage(p,'field','DONE','本版现场查验材料已发布。');
 if(h.status==='OBJECTION_SUBMITTED')return at(p,'customer','客户已提出异议，先核对事实并修订，再由客户重新确认。',wait('等待处理客户异议'),'BLOCKED');
 if(h.status==='SUPERSEDED')return at(p,'field','这是历史交接版本，请返回订单查看当前版本。',detail('handover-order','查看本单当前交接','orders',row.orderId),'NOT_APPLICABLE');
 if(h.status==='PUBLISHED')return at(p,'customer','客户在小程序查看全部证据后确认事实；不能由后台代客户确认。',wait('等待客户本人确认'),'WAITING');
 stage(p,'customer','DONE','客户已确认本版查验事实。');
 if(h.status==='COMPLETED'){stage(p,'paper','DONE','本次交接资料已通过完成条件校验。');return at(p,'complete','后台已确认完成本次交接。',detail('handover-order','查看关联订单','orders',row.orderId),'DONE');}
 if(online){stage(p,'paper','DONE','本版证据及客户线上确认已留存。');return at(p,'complete','客户确认与实际交接完成分别记录；后台仍须核验合同、资金、车辆和里程。',detail('handover-detail','打开本次交接办理','handovers',h.id,row.orderId));}
 if(!offline)return at(p,'paper','这是历史执行方式的交接，办理条件请查看本记录实际状态。',refresh,'UNKNOWN');
 const paper=row.offlineReceipt||h.offlineReceipt;
 if(paper?.manifestMatches===false)return at(p,'paper','纸质资料与当前查验版本不一致，请按当前现场事实重新准备交接资料。',detail('handover-paper','办理本单纸质资料','offline-archives',undefined,row.orderId),'BLOCKED');
 if(paper?.status==='ARCHIVED'){stage(p,'paper','DONE','当前纸质交接单已归档。');return at(p,'complete','还需由后台核验合同、资金及交接事实并确认完成。',detail('handover-detail','打开本次交接办理','handovers',h.id,row.orderId));}
 return at(p,'paper',paper?.status==='SUBMITTED'?'纸质单已提交，等待后台审核。':'客户确认不等于纸质单归档；请核对签署、原件上传及审核进度。',detail('handover-paper','办理本单纸质资料','offline-archives',undefined,row.orderId),'WAITING');
}
export async function runCommittedCommand<T>(commit:()=>Promise<T>,refresh?:()=>Promise<void>|void,onCommitted?:(value:T)=>void){
 const value=await commit();try{onCommitted?.(value);await refresh?.();return{committed:true as const,refreshed:true,value};}catch(refreshError){return{committed:true as const,refreshed:false,value,refreshError};}
}
