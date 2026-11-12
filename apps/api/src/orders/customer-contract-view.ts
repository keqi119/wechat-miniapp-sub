import {Db} from '../common/db';
import {fen,hash} from '../common/data';
import {periods} from '../usage/rules';
import {NINDA_PLATFORM_LEGAL_ENTITY} from '../common/platform-legal-entity';
import {newEsignRequestsEnabled} from '../esign/native-signing';
import {HttpException} from '@nestjs/common';
import {assertRenewalAgreementQuote} from '../order-changes/renewal-agreement';

const object=(value:any):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const text=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():'未提供';
const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const money=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=2147483647?fen(value):'未提供';
const day=(value:unknown)=>{const raw=value instanceof Date?value.toISOString():typeof value==='string'?value:'';const d=raw.slice(0,10),parsed=new Date(d+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(raw)&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===d?d:'未提供';};
function time(value:unknown){const d=value instanceof Date?value:new Date(typeof value==='string'?value:'');if(!Number.isFinite(d.getTime()))return'未提供';const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(part=>[part.type,part.value]));return`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}（北京时间）`;}
const phaseTexts={PREPARING:'合同准备中',REVIEWING:'合同复核中',READY_TO_SIGN:'待您签署',VERIFYING:'签署结果核验中',WAITING_OWNER:'等待车主签署',ARCHIVING:'双方已签待归档',ARCHIVED:'已签署归档',REJECTED:'签署未完成',EXPIRED:'签署已过期',CANCELLED:'合同已取消'} as const;
type Phase=keyof typeof phaseTexts;
const descriptions:Record<Phase,string>={PREPARING:'合同文件正在准备，签署入口就绪后会在此显示。',REVIEWING:'运营正在复核本份合同全文与签署区，请等待复核完成。',READY_TO_SIGN:'请先阅读本份合同全文，再由您本人完成签署。',VERIFYING:'原签署交易结果或文件绑定尚待核验，请查询结果；无需重复发起签署。',WAITING_OWNER:'您的签署已核实，正在等待实际出租方（车主）签署。',ARCHIVING:'双方签署已核实，签后合同文件正在核验归档。',ARCHIVED:'双方签署与签后文件已核验归档，可查看归档合同。',REJECTED:'本份签署未完成，请联系运营核对后续安排。',EXPIRED:'本份签署已过期，请联系运营核对后续安排。',CANCELLED:'本份合同已取消，可查看已有记录。'};
const terminal=(status:string):Phase|null=>['REJECTED','EXPIRED','CANCELLED'].includes(status)?status as Phase:null;
const proof=(p:any)=>!!(p?.attemptedAt&&p.verifiedAt&&p.queryEvidenceHash);
const signed=(p:any)=>p?.status==='SIGNED'&&proof(p);
const partyState=(p:any)=>!p?'UNAVAILABLE':signed(p)?'SIGNED':proof(p)&&['REJECTED','EXPIRED'].includes(p.status)?p.status:p.status==='PENDING'&&(!p.attemptedAt||proof(p))?'PENDING':'VERIFYING';

// The relation is always selected through the customer-owned contract, never from a client snapshot.
export const contractInclude={order:{select:{id:true,customerId:true,status:true,contractMode:true,finalPlanSnapshot:true}},delayQuote:{select:{id:true,changeId:true,commercialHash:true,status:true,revision:true,snapshot:true,confirmedAt:true,change:{select:{id:true,kind:true,status:true,orderId:true,customerId:true,priorTerms:true,priorTermsHash:true,priorTermsVersionId:true,originalContractId:true,originalArchiveVersionId:true,targetVehicleId:true}}}}} as const;
async function verifiedFile(db:Db,id:unknown,expected:unknown,customerId:string){
 if(typeof id!=='string'||!id||!sha(expected))return false;
 const f=await db.storedFile.findFirst({where:{id,customerId,sha256:expected as string,purpose:{in:['contract','amendment']},mimeType:'application/pdf'},select:{id:true,customerId:true,sha256:true,purpose:true,mimeType:true}});
 return !!(f&&f.id===id&&f.customerId===customerId&&f.sha256===expected&&['contract','amendment'].includes(f.purpose)&&f.mimeType==='application/pdf');
}
function rows(terms:any){let end='未提供';const start=day(terms.startDate??terms.newStartDate);try{const schedule=periods(start,terms.months);end=day(new Date(schedule.at(-1)!.endDate.getTime()-86400000));}catch{/* Historical data remains visibly unavailable. */}if(day(terms.newEndDate)!=='未提供')end=day(terms.newEndDate);
 return[{label:'月度订阅费',value:Array.isArray(terms.periods)&&terms.periods.length?'按本份协议逐期结算':money(terms.monthlyFeeAmount)},{label:'订阅押金',value:money(terms.depositAmount)},{label:'订阅期限',value:Number.isSafeInteger(terms.months)&&terms.months>0?`${terms.months} 个月`:'未提供'},{label:'订阅起止日期',value:`${start} 至 ${end}`}];
}
function progress(phase:Phase,customerSigned:boolean,ownerSigned:boolean){
 const ids=['prepare','review','customer','owner','archive'],titles=['准备合同','复核全文','您本人签署','出租方签署','签后归档'];
 const step:Record<Phase,number>={PREPARING:0,REVIEWING:1,READY_TO_SIGN:2,VERIFYING:2,WAITING_OWNER:3,ARCHIVING:4,ARCHIVED:5,REJECTED:2,EXPIRED:2,CANCELLED:0};
 const current=(phase==='VERIFYING'||terminal(phase))&&customerSigned?(ownerSigned?4:3):step[phase];
 return ids.map((id,i)=>({id,title:titles[i],state:(i<current?'DONE':terminal(phase)&&i===current?'STOPPED':i===current?'CURRENT':'PENDING') as 'DONE'|'CURRENT'|'PENDING'|'STOPPED'}));
}
/** Read-only, owner-bound projection. Draft uploads and storage locations never leave the server. */
export async function customerOfflineArchiveView(db:Db,customerId:string,input:{orderId:string;kind:string;archiveId?:string|null;handoverId?:string;quoteId?:string;businessHash:string}){
 const empty={archiveId:null as string|null,currentVersionId:null as string|null,state:'MISSING',ready:false,feedbackOpen:false,documents:[] as Array<{id:string;kind:'SIGNED';title:string;url:string}>,versions:[] as Array<{id:string;version:number;status:string;current:boolean;contractNumber:string|null;signedOn:unknown;documents:Array<{id:string;kind:'SIGNED';title:string;url:string}>}>};
 const owned=await db.order.findFirst({where:{id:input.orderId,customerId},select:{id:true,customerId:true,contractMode:true}});
 if(!owned||owned.id!==input.orderId||owned.customerId!==customerId||owned.contractMode!=='OFFLINE')return{...empty,state:'UNAVAILABLE'};
 if(!input.archiveId||!sha(input.businessHash))return empty;
 if(input.kind==='ORDER_AMENDMENT'&&(!input.quoteId||input.handoverId))return empty;
 const subject=input.kind==='ORDER_AMENDMENT'?{quoteId:input.quoteId,subjectType:'ORDER_CHANGE_QUOTE',subjectId:input.quoteId}:input.handoverId?{handoverId:input.handoverId,subjectType:'HANDOVER',subjectId:input.handoverId}:{subjectType:'ORDER',subjectId:input.orderId};
 const archive=await db.documentArchive.findFirst({where:{id:input.archiveId,orderId:input.orderId,kind:input.kind,...subject},include:{versions:{orderBy:{version:'desc'},include:{files:{include:{file:true}},feedback:true}}}});
 if(!archive||archive.id!==input.archiveId||archive.orderId!==input.orderId||archive.kind!==input.kind||input.handoverId&&archive.handoverId!==input.handoverId)return empty;
 if(input.kind==='ORDER_AMENDMENT'&&(archive.quoteId!==input.quoteId||archive.subjectType!=='ORDER_CHANGE_QUOTE'||archive.subjectId!==input.quoteId))return empty;
 const current=archive.versions.find(v=>v.id===archive.currentApprovedVersionId),latest=archive.versions[0],ready=!!current&&current.status==='ARCHIVED'&&current.businessSnapshotHash===input.businessHash;
 const versions=archive.versions.filter(v=>['ARCHIVED','INVALIDATED'].includes(v.status)).map(v=>({id:v.id,version:v.version,status:v.status,current:ready&&v.id===current?.id,contractNumber:v.contractNumber,signedOn:v.signedOn,documents:v.files.filter(f=>f.versionId===v.id&&f.fileId===f.file.id&&f.file.purpose==='offline-archive').sort((a,b)=>a.position-b.position).map(f=>({id:f.fileId,kind:'SIGNED' as const,title:f.file.name,url:`/api/customer/offline-archives/${encodeURIComponent(archive.id)}/versions/${encodeURIComponent(v.id)}/files/${encodeURIComponent(f.fileId)}`}))}));
 return{archiveId:archive.id,currentVersionId:ready?current!.id:null,state:ready?'ARCHIVED':current?.status==='ARCHIVED'?'MISMATCH':latest?.status||'DRAFT',ready,feedbackOpen:archive.versions.some(v=>v.feedback.some(f=>f.status==='OPEN')),documents:versions.find(v=>v.current)?.documents||[],versions};
}
async function offlineContractRecord(db:Db,customerId:string,c:any,order:any,orderBound:boolean){
 const amendment=c.kind==='AMENDMENT',q=c.delayQuote,document=q?.snapshot?.document;
 const quoteBound=!!(q&&q.id===c.delayQuoteId&&q.changeId===q.change?.id&&q.change.orderId===c.orderId&&q.change.customerId===customerId&&['PUBLISHED','CONFIRMED','SUPERSEDED'].includes(q.status)&&sha(q.commercialHash)&&q.commercialHash===c.documentHash&&document?.type==='OFFLINE_ORDER_AMENDMENT'&&document.id===c.documentId&&document.version===c.templateVersion&&typeof c.body==='string'&&c.body.trim()&&document.content===c.body&&document.bodyHash===hash(c.body));
 const renewal=amendment&&q?.change?.kind==='SUBSCRIPTION_EXTENSION';let renewalBound=!renewal;
 if(renewal&&orderBound&&quoteBound)try{assertRenewalAgreementQuote(q.change,q,c,order,q.status==='CONFIRMED'||q.confirmedAt!=null);renewalBound=true;}catch(error){if(!(error instanceof HttpException))throw error;}
 const readable=orderBound&&['SUBSCRIPTION','RENTAL','AMENDMENT'].includes(c.kind)&&(!amendment||quoteBound)&&renewalBound;
 const terms=readable?object(amendment?renewal?q.snapshot.renewalTerms:q.change.priorTerms:order.finalPlanSnapshot):{},lessor=object(terms.lessorSnapshot),businessHash=amendment?(readable?q.commercialHash:''):terms.commercialHash;
 const archive=await customerOfflineArchiveView(db,customerId,{orderId:readable?c.orderId:'__unavailable__',kind:amendment?'ORDER_AMENDMENT':'RENTAL',archiveId:readable?c.offlineArchiveId:null,...(amendment&&readable?{quoteId:q.id}:{}),businessHash});
 const phase=archive.ready?'OFFLINE_ARCHIVED':['SUBMITTED','REVIEWED','MISMATCH'].includes(archive.state)?'OFFLINE_REVIEWING':['REJECTED','INVALIDATED'].includes(archive.state)?'OFFLINE_NEEDS_UPDATE':'OFFLINE_PREPARING';
 const phaseText=archive.ready?'纸质合同已审核归档':archive.state==='REVIEWED'?'纸质合同已审核待归档':phase==='OFFLINE_REVIEWING'?'纸质合同审核中':phase==='OFFLINE_NEEDS_UPDATE'?'纸质合同资料待更新':'等待线下签署归档';
 const guidance={title:phaseText,description:archive.feedbackOpen?'您提交的合同资料异议正在核对，请留意处理进度。':archive.ready?'三方纸质合同已由平台审核归档，可查看归档文件。':'请按工作人员安排完成客户、实际出租方和宁达平台的纸质签署；平台上传、审核并归档后显示合同文件。'};
 const parties=[{role:'CUSTOMER',label:'订阅客户',name:'您本人'},{role:'OWNER',label:'实际出租方',name:text(lessor.name)},{role:'PLATFORM',label:'平台服务方',name:text(terms.partiesSnapshot?.find?.((p:any)=>p.role==='PLATFORM')?.name||NINDA_PLATFORM_LEGAL_ENTITY)}].map(p=>({...p,status:archive.ready?'MANUALLY_REVIEWED':'PENDING',statusText:archive.ready?'纸质签署已人工核验':'待人工归档核验'}));
 const reviewed=archive.state==='REVIEWED',submitted=archive.state==='SUBMITTED';
 const progress=[{id:'offline-sign',title:'线下三方签署',state:archive.ready||reviewed||submitted?'DONE':'CURRENT'},{id:'offline-review',title:'上传与审核',state:archive.ready||reviewed?'DONE':phase==='OFFLINE_REVIEWING'?'CURRENT':'PENDING'},{id:'offline-archive',title:'合同归档',state:archive.ready?'DONE':reviewed?'CURRENT':'PENDING'}];
 const summaryRows=amendment?(readable?[{label:'变更事项',value:renewal?'原单续期':q.change.kind==='DELIVERY_DELAY'?'交付延期':q.change.kind==='VEHICLE_CHANGE'?'车辆更换':'订单变更'},{label:'报价版本',value:String(q.revision)},{label:'变更进度',value:q.change.status==='APPLIED'?'已生效':renewal&&q.change.status==='SCHEDULED'?'待到期生效':'以变更办理进度为准'},...(renewal?[{label:'续期起止日期',value:`${day(q.snapshot.startDate)} 至 ${day(q.snapshot.newEndDate)}`},{label:'续期月费',value:money(q.snapshot.monthlyFeeAmount)},{label:'原押金保持',value:money(q.snapshot.depositAmount)},{label:'续期期限',value:`${q.snapshot.months} 个月`},{label:'生效说明',value:'纸档归档及提前缴费不提前改变当前费率或赠送；生效日前仍按原期规则。'}]:[])]:[]):rows(terms);
 const d={version:2,executionMode:'OFFLINE',contractId:c.id,orderId:c.orderId,kind:c.kind,status:c.status,phase,phaseText,guidance,vehicle:{title:text(amendment&&readable?q.snapshot.targetVehicleIdentification||object(terms.commercialTerms).vehicleIdentification:object(terms.commercialTerms).vehicleIdentification)},lessor:{name:text(lessor.name)},summaryRows,parties,progress,documents:archive.documents,archive,canSign:false,canQuery:false,primaryAction:null,createdAtText:time(c.createdAt),updatedAtText:time(c.updatedAt),templateVersion:Number.isSafeInteger(c.templateVersion)?c.templateVersion:null};
 return{id:c.id,type:'contracts',title:amendment?'订阅变更补充协议':'汽车订阅服务合同',subtitle:d.vehicle.title,status:archive.state,statusText:phaseText,amountText:'',createdAtText:d.createdAtText,details:[],timeline:[],actions:[],documents:archive.documents,contractDetail:d};
}
async function electronicContractRecord(db:Db,customerId:string,c:any,order:any,orderBound:boolean){
 const found=orderBound?await db.electronicSigningTask.findFirst({where:{contractId:c.id,orderId:order.id,customerId,parties:{some:{role:'CUSTOMER',subjectId:customerId}}},include:{parties:true,archiveVersion:true}}):null;
 const task=found&&found.contractId===c.id&&found.orderId===order.id&&found.customerId===customerId&&found.parties.some((p:any)=>p.role==='CUSTOMER'&&p.subjectId===customerId)?found:null;
 const allSigned=!!task&&task.parties.length===3&&['CUSTOMER','OWNER','PLATFORM'].every(role=>task.parties.filter((p:any)=>p.role===role&&p.status==='SIGNED').length===1);
 const archived=allSigned&&task.status==='ARCHIVED'&&task.archivedAt&&task.finalFileId&&task.archiveVersion?.status==='ARCHIVED';
 const stopped=task&&['WITHDRAWN','DECLINED','EXPIRED','RETIRED'].includes(task.status);
 const phase=stopped?'CANCELLED':archived?'ARCHIVED':allSigned?'ARCHIVING':task?'READY_TO_SIGN':'PREPARING';
 const phaseText=stopped?'已关闭':archived?'已归档':allSigned?'待归档':task?'待签署':'合同准备中';
 const workspaceUrl='/pages/electronic-contracts/index?orderId='+encodeURIComponent(c.orderId)+(task?'&taskId='+encodeURIComponent(task.id):'');
 const guidance={title:phaseText,description:stopped?'本版合同已停止办理，可在合同与协议中查看原有记录。':archived?'三方签署及归档已完成，可在合同与协议中阅读签后文件。':allSigned?'三方已签署，正在核验签后文件与归档结果。':'请进入合同与协议，查看本单文件及当前签署进度。'};
 const terms=orderBound?object(order.finalPlanSnapshot):{},vehicle={title:text(object(terms.commercialTerms).vehicleIdentification)};
 const d={version:3,executionMode:'ELECTRONIC' as const,contractId:c.id,orderId:c.orderId,taskId:task?.id??null,kind:c.kind,status:c.status,phase,phaseText,guidance,workspaceUrl,vehicle,lessor:{name:text(object(terms.lessorSnapshot).name)},summaryRows:rows(terms),parties:[],progress:[],documents:[],canSign:false,canQuery:false,primaryAction:null,createdAtText:time(c.createdAt),updatedAtText:time(c.updatedAt),templateVersion:c.templateVersion??null};
 return{id:c.id,type:'contracts',executionMode:'ELECTRONIC',contractMode:'ELECTRONIC',orderId:c.orderId,title:c.kind==='AMENDMENT'?'订阅补充协议':'汽车订阅合同',subtitle:vehicle.title,status:c.status,statusText:phaseText,amountText:'',createdAtText:d.createdAtText,details:[],timeline:[],actions:[],documents:[],contractDetail:d};
}
/** Pure customer display capabilities. No provider clients, signing, mutations or side effects. */
export async function customerContractRecord(db:Db,customerId:string,c:any,selectedOrder?:any){
 const order=selectedOrder||c.order,orderBound=!!(c.customerId===customerId&&order?.id===c.orderId&&order.customerId===customerId);
 if(c.executionMode==='ELECTRONIC'||order?.contractMode==='ELECTRONIC')return electronicContractRecord(db,customerId,c,order,orderBound);
 if(c.executionMode==='OFFLINE'||order?.contractMode==='OFFLINE')return offlineContractRecord(db,customerId,c,order,orderBound);
 const original=orderBound?object(order.finalPlanSnapshot):{},owner=Object.prototype.hasOwnProperty.call(original,'lessorSnapshot');
 const lessor=object(original.lessorSnapshot),amendment=c.kind==='AMENDMENT',kindKnown=['SUBSCRIPTION','AMENDMENT'].includes(c.kind);
 const scope={id:c.providerTaskId,resourceId:c.id,customerId,kind:c.kind,documentHash:c.documentHash,sourceFileId:c.sourceFileId};
 let task:any=null,approval:any=null;
 if(orderBound&&kindKnown&&c.providerTaskId&&typeof c.sourceFileId==='string'&&c.sourceFileId&&sha(c.documentHash))task=owner?await db.ownerSigningTask.findFirst({where:scope,include:{parties:true}}):await db.fadadaTask.findFirst({where:scope});
 if(orderBound&&kindKnown&&!owner&&!c.providerTaskId&&c.sourceFileId&&sha(c.documentHash))approval=await db.eSignApproval.findFirst({where:{resourceId:c.id,customerId,kind:c.kind,documentHash:c.documentHash,sourceFileId:c.sourceFileId,status:{in:['PENDING','APPROVED']}},orderBy:{createdAt:'desc'}});
 const same=(t:any)=>!!(t&&t.customerId===customerId&&t.resourceId===c.id&&t.kind===c.kind&&t.documentHash===c.documentHash&&t.sourceFileId===c.sourceFileId);
 const taskBound=!!(orderBound&&kindKnown&&task&&task.id===c.providerTaskId&&same(task));
 const ownerParties=Array.isArray(task?.parties)?task.parties:[],cp=ownerParties.find((p:any)=>p.role==='CUSTOMER'),op=ownerParties.find((p:any)=>p.role==='OWNER'),taskLessor=object(object(task?.snapshot).lessor);
 const partiesBound=!owner||!!(ownerParties.length===2&&cp&&op&&ownerParties.every((p:any)=>p.taskId===task.id)&&task.ownerId===lessor.ownerId&&taskLessor.ownerId===lessor.ownerId&&op.providerCustomerId&&op.providerCustomerId===taskLessor.providerCustomerId&&op.providerSignatureId&&op.providerSignatureId===taskLessor.providerSignatureId&&cp.providerCustomerId&&cp.providerCustomerId!==op.providerCustomerId);
 const sourceHash=owner?task?.sourceSha256:task?.sourcePdfHash??approval?.sourcePdfHash;
 const sourceBound=!!((taskBound&&partiesBound||same(approval))&&await verifiedFile(db,c.sourceFileId,sourceHash,customerId));
 const bound=!!(taskBound&&partiesBound&&sourceBound);
 const knownTask=owner?['PREPARED','READY','SIGNING','UPLOADING','UPLOAD_UNKNOWN','ARCHIVED','REJECTED','EXPIRED','CANCELLED'].includes(task?.status):['PREPARED','PENDING','SIGNED','REJECTED','EXPIRED','CANCELLED'].includes(task?.status);
 const customerSigned=bound&&(owner?signed(cp):!!task.customerSignedAt),ownerSigned=bound&&(owner?signed(op):!!task.platformSignedAt);
 const archiveState=bound&&task.uploadedAt&&(owner?task.status==='ARCHIVED'&&task.archivedAt&&task.ownerDispatchAt&&task.reviewedAt&&task.reviewedBy:task.status==='SIGNED');
 const archiveBound=!!(archiveState&&customerSigned&&ownerSigned&&task.signedFileId&&task.signedFileId===c.signedFileId&&sha(task.signedPdfHash)&&task.signedPdfHash!==sourceHash&&await verifiedFile(db,task.signedFileId,task.signedPdfHash,customerId));
 let phase:Phase='VERIFYING';
 if(terminal(c.status))phase=terminal(c.status)!;
 else if(!orderBound||!kindKnown||!['DRAFT','PENDING','SIGNED'].includes(c.status))phase='VERIFYING';
 else if(!task&&!approval&&!c.providerTaskId&&!c.sourceFileId&&c.status==='DRAFT')phase='PREPARING';
 else if(sourceBound&&approval&&!task)phase=c.status!=='DRAFT'?'VERIFYING':approval.status==='APPROVED'&&approval.approvedAt&&approval.approverId&&approval.expiresAt>new Date()?'READY_TO_SIGN':'REVIEWING';
 else if(bound&&knownTask){
  const partyTerminal=owner?[cp,op].find(p=>proof(p)&&terminal(p.status)):null;
  if(terminal(task.status)||partyTerminal)phase=(terminal(task.status)||terminal(partyTerminal.status))!;
  else if(archiveBound)phase='ARCHIVED';
  else if(c.status==='SIGNED'||['ARCHIVED','SIGNED'].includes(task.status))phase='VERIFYING';
  else if(ownerSigned&&!customerSigned||owner&&(partyState(cp)==='VERIFYING'||partyState(op)==='VERIFYING')||['UPLOADING','UPLOAD_UNKNOWN'].includes(task.status)||task.processingUntil&&task.processingUntil>new Date())phase='VERIFYING';
  else if(customerSigned&&ownerSigned)phase='ARCHIVING';
  else if(customerSigned)phase='WAITING_OWNER';
  else if(owner&&(!task.reviewedAt||!task.reviewedBy)||!owner&&!task.uploadedAt)phase='REVIEWING';
  else if(owner&&partyState(cp)==='PENDING'||!owner&&task.status==='PREPARED')phase='READY_TO_SIGN';
 }
 const currentOrder=owner?order?.status==='AWAITING_SIGNATURE':['AWAITING_SIGNATURE','AWAITING_PAYMENT'].includes(order?.status);
 const newSigningAllowed=newEsignRequestsEnabled(),canSign=!!(newSigningAllowed&&!amendment&&phase==='READY_TO_SIGN'&&currentOrder&&['DRAFT','PENDING'].includes(c.status));
 // Query for amendments stays in the existing order-change flow; unknown or misbound tasks never escape here.
 const canQuery=!!(owner&&!amendment&&bound&&knownTask&&task.uploadedAt&&!['ARCHIVED','REJECTED','EXPIRED','CANCELLED'].includes(phase));
 const primaryAction=canSign?{id:'sign',label:'签署合同'}:canQuery&&['VERIFYING','WAITING_OWNER','ARCHIVING'].includes(phase)?{id:'query',label:'查询签署结果'}:null;
 const documents:Array<{id:string;kind:'SOURCE'|'SIGNED';title:string}>=[];
 if(sourceBound)documents.push({id:c.sourceFileId,kind:'SOURCE',title:'合同原文'});
 if(archiveBound)documents.push({id:task.signedFileId,kind:'SIGNED',title:'签后归档合同'});
 const partyStatusText:Record<string,string>={PENDING:'待签署',SIGNED:'已核实签署',VERIFYING:'结果核验中',REJECTED:'签署未完成',EXPIRED:'签署已过期',UNAVAILABLE:'状态未提供'};
 const reviewedPreparation=!!(!owner&&!task&&sourceBound&&approval&&phase==='READY_TO_SIGN');
 const states=bound?(owner?[partyState(cp),partyState(op)]:[customerSigned?'SIGNED':task.uploadedAt?'VERIFYING':'PENDING',ownerSigned?'SIGNED':'PENDING']):reviewedPreparation?['PENDING','PENDING']:['UNAVAILABLE','UNAVAILABLE'];
 const terms=amendment?object(c.delayQuote?.snapshot):original;
 const targetVehicle=amendment&&(c.delayQuote?.change?.kind==='VEHICLE_CHANGE'||Object.prototype.hasOwnProperty.call(terms,'targetVehicleIdentification'));
 const vehicleTitle=text(targetVehicle?terms.targetVehicleIdentification:object(original.commercialTerms).vehicleIdentification);
 const phaseText=phase==='WAITING_OWNER'&&!owner?'等待平台签署':phaseTexts[phase],guidance={title:phaseText,description:!newSigningAllowed&&['PREPARING','REVIEWING','READY_TO_SIGN'].includes(phase)?'本版已关闭新增电子签办理，已有文件与状态保留；后续安排请联系平台。':phase==='WAITING_OWNER'&&!owner?'您的签署已核实，正在等待平台出租方完成签署。':descriptions[phase]};
 const d={version:1,contractId:c.id,orderId:c.orderId,kind:c.kind,status:c.status,phase,phaseText,guidance,vehicle:{title:vehicleTitle},lessor:{name:text(lessor.name)},summaryRows:rows(terms),parties:[{role:'CUSTOMER',label:'订阅客户',name:'您本人',status:states[0],statusText:partyStatusText[states[0]]},{role:owner?'OWNER':'PLATFORM',label:'实际出租方',name:text(lessor.name),status:states[1],statusText:partyStatusText[states[1]]}],progress:progress(phase,customerSigned,ownerSigned),documents,canSign,canQuery,primaryAction,createdAtText:time(c.createdAt),updatedAtText:time(c.updatedAt),templateVersion:Number.isSafeInteger(c.templateVersion)&&c.templateVersion>0?c.templateVersion:null};
 const change=c.delayQuote?.change,changeBound=orderBound&&amendment&&change?.orderId===c.orderId&&change.customerId===customerId&&typeof change.id==='string';
 return{id:c.id,type:'contracts',title:amendment?'订阅变更补充协议':'汽车订阅服务合同',subtitle:d.vehicle.title,status:c.status,statusText:phaseText,amountText:'',createdAtText:d.createdAtText,details:[],timeline:[],actions:[...(canSign?[{id:'sign',label:'签署合同'}]:[]),...(changeBound?[{id:'change',label:'查看订单变更',url:`/pages/record/index?type=orderchanges&id=${encodeURIComponent(change.id)}`}]:[])],documents:documents.map(file=>({...file,url:`/api/customer/files/${encodeURIComponent(file.id)}`})),contractDetail:d};
}
/** A generic mapper has no persisted evidence and must never infer signing rights. */
export function unavailableContractRecord(c:any){return{id:c.id,type:'contracts',title:c.kind==='AMENDMENT'?'订阅变更补充协议':'汽车订阅服务合同',subtitle:'',status:c.status,statusText:'签署结果核验中',amountText:'',createdAtText:time(c.createdAt),details:[],timeline:[],actions:[],documents:[]};}
