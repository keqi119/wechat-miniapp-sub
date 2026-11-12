import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {readRenewalCancellationPaper,requireCancellationPaperCurrent,cancellationScope,renderRenewalCancellationBody} from '../order-renewals/cancellation-paper';
import type {RenewalCancellationPaperSource} from '../order-renewals/cancellation-paper';

export type CancellationPrintContext={paper:RenewalCancellationPaperSource;sourceHash:string;scope:any};
export async function resolveRenewalCancellationContext(tx:any,archive:any,scope?:any){
 ensure(archive.kind==='RENEWAL_CANCELLATION'&&archive.subjectType==='ORDER_RENEWAL_CANCELLATION'&&!archive.quoteId&&!archive.handoverId,400,'VALIDATION','取消纸档必须关联真实续期取消事项');
 const{c,paper}=await readRenewalCancellationPaper(tx,archive.subjectId);await requireCancellationPaperCurrent(tx,c,paper);
 ensure((!archive.renewalCancellationId||archive.renewalCancellationId===c.id)&&(!archive.orderId||archive.orderId===c.orderId)&&(!archive.ownerId||archive.ownerId===c.ownerId),409,'RENEWAL_CANCELLATION_PAPER_SOURCE','取消纸档与事项归属不一致');
 const source=cancellationScope(c,paper);
 if(scope)ensure(scope.source&&canonicalHash(scope.source)===canonicalHash(source)&&scope.document&&typeof scope.document.content==='string'&&scope.document.bodyHash===hash(scope.document.content),409,'RENEWAL_CANCELLATION_PAPER_SOURCE','取消纸档冻结范围不一致');
 const scopeSnapshot=scope??{source};
 return{ownerId:c.ownerId,orderId:c.orderId,customerId:c.customerId,handoverId:null,renewalCancellationId:c.id,businessSnapshotHash:c.sourceHash,businessSnapshot:paper,partiesSnapshot:paper.parties,requiredSigners:['CUSTOMER','OWNER','PLATFORM'],scopeSnapshot,cancellationContext:{paper,sourceHash:c.sourceHash,scope:scopeSnapshot} as CancellationPrintContext,terminationContext:undefined};
}
export function freezeRenewalCancellationScope(context:Awaited<ReturnType<typeof resolveRenewalCancellationContext>>,template:any){
 const content=renderRenewalCancellationBody(template.content,context.cancellationContext.paper);
 return{source:context.scopeSnapshot.source,document:{templateId:template.id,templateVersion:template.version,templateHash:hash(template.content),content,bodyHash:hash(content)}};
}
