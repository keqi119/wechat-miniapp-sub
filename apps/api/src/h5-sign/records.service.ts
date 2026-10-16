import {Inject,Injectable} from '@nestjs/common';
import {Db} from '../common/db';
import {ESignGateway} from '../common/gateways';
import {ensure} from '../common/errors';
import {requireCurrentConsents} from '../auth/consents';
import {SignaturesController} from '../orders/signatures';
import {SignatureService} from '../orders/signature.service';
import {WorkflowsController} from '../operations/workflows';
import {DelaySigning} from '../order-changes/signing';
import {CustomerESignOnboardingService} from '../esign/customer-esign-onboarding.service';
import {ESIGN_SETTINGS} from '../esign/esign.controller';
import {FadadaSettings} from '../esign/esign.settings';
import {ContractPdfArtifactWriterService} from '../contract/contract-pdf-artifact-writer.service';
import {H5_RETURN,approvedProviderUrl,providerHosts} from './config';
export type H5Kind='SUBSCRIPTION'|'HANDOVER'|'AMENDMENT';
@Injectable()
export class H5RecordsService{
 private contracts:SignaturesController;private workflows:WorkflowsController;
 constructor(@Inject(Db)private db:Db,@Inject(ESignGateway)gateway:ESignGateway,@Inject(SignatureService)signatures:SignatureService,@Inject(DelaySigning)private delay:DelaySigning,@Inject(CustomerESignOnboardingService)private accounts:CustomerESignOnboardingService,@Inject(ESIGN_SETTINGS)private settings:FadadaSettings,@Inject(ContractPdfArtifactWriterService)private writer:ContractPdfArtifactWriterService){this.contracts=new SignaturesController(db,gateway,signatures);this.workflows=new WorkflowsController(db,gateway,signatures);}
 private async resource(kind:H5Kind,id:string,customerId:string){
  if(kind==='HANDOVER'){const item=await this.db.handover.findFirst({where:{id,customerId,status:{not:'DRAFT'}},include:{order:true}});ensure(item,404,'NOT_FOUND','签约记录不存在');return{item,hash:item.manifestHash,change:undefined};}
  if(kind==='AMENDMENT'){const change=await this.db.orderChange.findFirst({where:{id,customerId},include:{quotes:{include:{contract:{include:{order:true}}}}}});const quote=change?.quotes.find(q=>q.id===change.activeQuoteId);ensure(change&&quote&&['CONFIRMED','PUBLISHED'].includes(quote.status)&&quote.contract,404,'NOT_FOUND','补充协议尚未发布');return{item:quote.contract,hash:quote.contract.documentHash,change};}
  const item=await this.db.contract.findFirst({where:{id,customerId,kind:'SUBSCRIPTION'},include:{order:true}});ensure(item,404,'NOT_FOUND','签约记录不存在');return{item,hash:item.documentHash,change:undefined};
 }
 private async artifact(kind:H5Kind,item:any,hash:string){
  const task=await this.db.fadadaTask.findUnique({where:{kind_resourceId_documentHash:{kind,resourceId:item.id,documentHash:hash}}});
  const approval=task?await this.db.eSignApproval.findFirst({where:{id:task.approvalId,kind,resourceId:item.id,customerId:item.customerId,documentHash:hash,status:'APPROVED'}}):await this.db.eSignApproval.findFirst({where:{kind,resourceId:item.id,customerId:item.customerId,documentHash:hash,status:'APPROVED'},orderBy:{approvedAt:'desc'}});
  const source=task?.uploadedAt?{id:task.sourceFileId,hash:task.sourcePdfHash}:approval?{id:approval.sourceFileId,hash:approval.sourcePdfHash}:undefined;
  const sourceFile=source?await this.db.storedFile.findFirst({where:{id:source.id,customerId:item.customerId,sha256:source.hash,mimeType:'application/pdf'}}):null;
  const signedFile=item.signedFileId?await this.db.storedFile.findFirst({where:{id:item.signedFileId,customerId:item.customerId,mimeType:'application/pdf'}}):null;
  return{approval,task,sourceFile,signedFile};
 }
 async view(kind:H5Kind,id:string,customerId:string,detail=true){
  const{item,hash,change}=await this.resource(kind,id,customerId),readiness=await this.accounts.readiness(customerId),artifact=await this.artifact(kind,item,hash);
  const status=kind==='HANDOVER'?(item as any).signatureStatus:item.status;
  const eligible=kind==='HANDOVER'?item.status==='CUSTOMER_CONFIRMED'&&['DRAFT','PENDING'].includes(status):kind==='AMENDMENT'?change?.status==='AWAITING_SIGNATURE'&&['DRAFT','PENDING'].includes(status):['AWAITING_SIGNATURE','AWAITING_PAYMENT'].includes(item.order.status)&&['DRAFT','PENDING'].includes(status);
  const blockers:string[]=[];
  if(!eligible)blockers.push('当前业务状态不可发起签署');
  if(!readiness.readyForSigning)blockers.push('请先完成实名和签署资格核验');
  if(!artifact.sourceFile||!artifact.approval||!artifact.approval.approvedAt||!artifact.approval.approverId||artifact.approval.requesterId===artifact.approval.approverId||artifact.approval.expiresAt<=new Date())blockers.push('请等待运营准备文档及企业签章审批');
  if(!this.settings.enabled||!this.settings.signingEnabled||providerHosts().length===0)blockers.push('签约服务暂未开放');
  const result:any={kind,id,orderId:item.orderId,title:kind==='HANDOVER'?'车辆交接确认单':kind==='AMENDMENT'?(change?.kind==='VEHICLE_CHANGE'?'车辆更换补充协议':'延期交车补充协议'):'汽车订阅服务合同',status,createdAt:item.createdAt,canSign:blockers.length===0,canSync:Boolean(item.providerTaskId||artifact.task||status==='PENDING'),...(artifact.sourceFile?{sourceFileId:artifact.sourceFile.id}:{}),...(status==='SIGNED'&&artifact.signedFile?{signedFileId:artifact.signedFile.id}:{})};
  if(detail)Object.assign(result,{documentHash:hash,readiness,blockers,...(change?{revision:change.revision}:{}),...(kind==='HANDOVER'?{actualAt:(item as any).actualAt}:{}),...(artifact.sourceFile&&kind!=='HANDOVER'?{body:(item as any).body}:{})});
  return result;
 }
 async list(customerId:string){const[contracts,handovers,changes]=await Promise.all([this.db.contract.findMany({where:{customerId,kind:'SUBSCRIPTION'},select:{id:true},orderBy:{createdAt:'desc'},take:100}),this.db.handover.findMany({where:{customerId,status:{not:'DRAFT'}},select:{id:true},orderBy:{createdAt:'desc'},take:100}),this.db.orderChange.findMany({where:{customerId,quotes:{some:{status:{in:['PUBLISHED','CONFIRMED']},contract:{isNot:null}}}},select:{id:true},orderBy:{createdAt:'desc'},take:100})]);const items=[];for(const[kind,rows]of [['SUBSCRIPTION',contracts],['HANDOVER',handovers],['AMENDMENT',changes]]as const)for(const row of rows){try{items.push(await this.view(kind,row.id,customerId,false));}catch(e:any){if(e.getStatus?.()!==404)throw e;}}items.sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());return{items};}
 async action(kind:H5Kind,id:string,customer:any,input:{revision?:number},sync:boolean){
  const before=await this.view(kind,id,customer.id);if(kind==='AMENDMENT')ensure(input.revision!==undefined&&input.revision===before.revision,409,'VERSION_CONFLICT','补充协议已更新，请刷新');
  let result:any;
  if(!sync){await requireCurrentConsents(this.db,customer.id,['terms','privacy']);ensure(before.canSign,409,'SIGNING_NOT_READY',before.blockers.join('；'));}
  const request={customer,signingReturnUrl:H5_RETURN};
  if(kind==='SUBSCRIPTION')result=sync?await this.contracts.status(id,request):await this.contracts.send(id,customer.id,H5_RETURN);
  else if(kind==='HANDOVER')result=sync?await this.workflows.signStatus(id,request):await this.workflows.signHandover(id,request);
  else if(sync)await this.delay.sync(id,input,customer.id);else result=await this.delay.sign(id,input,customer.id,H5_RETURN);
  const record=await this.view(kind,id,customer.id);if(sync)return record;
  return{record,...(result?.url?{redirectUrl:approvedProviderUrl(result.url)}:{})};
 }
 async file(id:string,customerId:string){
  const file=await this.db.storedFile.findFirst({where:{id,customerId,mimeType:'application/pdf'}});ensure(file,404,'NOT_FOUND','签约文件不存在');
  const signed=await this.db.contract.count({where:{customerId,status:'SIGNED',signedFileId:id}})+await this.db.handover.count({where:{customerId,signatureStatus:'SIGNED',signedFileId:id}});
  const approved=await this.db.eSignApproval.count({where:{customerId,sourceFileId:id,sourcePdfHash:file.sha256,status:'APPROVED'}});
  const task=await this.db.fadadaTask.count({where:{customerId,sourceFileId:id,sourcePdfHash:file.sha256,uploadedAt:{not:null}}});ensure(signed||approved||task,404,'NOT_FOUND','签约文件尚未审核发布');
  return{file,bytes:await this.writer.readVerified(id,file.sha256)};
 }
}
