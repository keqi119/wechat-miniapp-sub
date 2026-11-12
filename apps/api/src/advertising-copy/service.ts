import {Inject,Injectable} from '@nestjs/common';
import type {Prisma} from '@prisma/client';
import {Db} from '../common/db';
import {audit,hash} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import type {StaffActor} from '../auth/staff.types';
import {advertisingDraftInput,advertisingItems,advertisingPublishInput,advertisingReceiptInput} from './types';

const singleton='discovery',resourceId='advertising-copy:discovery';
function unavailable(value:unknown):asserts value {ensure(value,503,'ADVERTISING_COPY_UNAVAILABLE','广告词尚未初始化或数据不可用');}
function snapshot(items:unknown,contentHash:string){const result=advertisingItems.safeParse(items);unavailable(result.success);unavailable(hash(result.data)===contentHash);return result.data;}

@Injectable()
export class AdvertisingCopyService {
 constructor(@Inject(Db) private readonly db:Db){}

 private async state(tx:Prisma.TransactionClient){
  const set=await tx.advertisingCopySet.findUnique({where:{id:singleton},include:{publishedVersion:true}});unavailable(set?.publishedVersion);
  unavailable(Number.isSafeInteger(set.revision)&&set.revision>0&&Number.isSafeInteger(set.publishedVersion.version)&&set.publishedVersion.version>0);
  return {set,draftItems:snapshot(set.draftItems,set.draftHash),publishedItems:snapshot(set.publishedVersion.items,set.publishedVersion.contentHash)};
 }
 async detail(actor:StaffActor){return this.db.serial(async tx=>{
  await requireCurrentStaff(tx,actor,'advertising-copy',false);
  const {set,draftItems,publishedItems}=await this.state(tx),published=set.publishedVersion;
  const history=await tx.advertisingCopyPublication.findMany({orderBy:{version:'desc'},take:10,select:{version:true,contentHash:true,publishedAt:true,publishedBy:true}});
  return {id:singleton,revision:set.revision,draft:{items:draftItems,contentHash:set.draftHash,updatedAt:set.updatedAt,updatedBy:set.updatedBy},published:{version:published.version,items:publishedItems,contentHash:published.contentHash,publishedAt:published.publishedAt,publishedBy:published.publishedBy},history};
 });}
 async publicSnapshot(){return this.db.serial(async tx=>{
  // Public reads deliberately never inspect the editable draft. A valid
  // publication remains readable even if unrelated draft data is damaged.
  const set=await tx.advertisingCopySet.findUnique({where:{id:singleton},include:{publishedVersion:true}});unavailable(set?.publishedVersion);
  const p=set.publishedVersion;unavailable(Number.isSafeInteger(p.version)&&p.version>0);
  return {version:p.version,contentHash:p.contentHash,publishedAt:p.publishedAt,items:snapshot(p.items,p.contentHash)};
 });}
 async commandReceipt(raw:unknown,actor:StaffActor){const input=advertisingReceiptInput.parse(raw);return this.db.serial(async tx=>{
  // Recover only the current actor's command, with both current read and write
  // authority. Absence is explicit; transport failures never imply absence.
  await requireCurrentStaff(tx,actor,'advertising-copy',false);
  await requireCurrentStaff(tx,actor,'advertising-copy',true);
  const receipt=await tx.productCommand.findUnique({where:{actorId_resourceId_action_key:{actorId:actor.id,resourceId,action:input.action,key:input.key}}});
  return receipt?{found:true,requestHash:receipt.requestHash,result:receipt.resultSnapshot}:{found:false};
 });}
 async saveDraft(raw:unknown,actor:StaffActor){const input=advertisingDraftInput.parse(raw);return this.command(actor,'SAVE_DRAFT',input,async tx=>{
  const {set}=await this.state(tx);ensure(set.revision===input.revision,409,'REVISION_CONFLICT','广告词已更新，请重新读取核对');
  const draftHash=hash(input.items);
  const updated=await tx.advertisingCopySet.updateMany({where:{id:singleton,revision:input.revision},data:{draftItems:input.items,draftHash,revision:{increment:1},updatedBy:actor.id}});
  ensure(updated.count===1,409,'REVISION_CONFLICT','广告词已更新，请重新读取核对');
  const result={id:singleton,revision:input.revision+1,draftHash,publishedVersion:set.publishedVersion.version};
  await audit(tx,actor.id,'SAVE_DRAFT','advertising-copy',singleton,result);return result;
 });}
 async publish(raw:unknown,actor:StaffActor){const input=advertisingPublishInput.parse(raw);return this.command(actor,'PUBLISH',input,async tx=>{
  const {set,draftItems}=await this.state(tx);
  ensure(set.revision===input.revision,409,'REVISION_CONFLICT','广告词已更新，请重新读取核对');
  ensure(set.draftHash===input.draftHash,409,'DRAFT_CHANGED','已保存草稿已变化，请重新核对');
  ensure(set.draftHash!==set.publishedVersion.contentHash,409,'ADVERTISING_COPY_UNCHANGED','草稿与已发布内容一致');
  const latest=await tx.advertisingCopyPublication.findFirst({orderBy:{version:'desc'},select:{version:true}});unavailable(latest);
  const publication=await tx.advertisingCopyPublication.create({data:{version:latest.version+1,items:draftItems,contentHash:set.draftHash,publishedBy:actor.id}});
  const updated=await tx.advertisingCopySet.updateMany({where:{id:singleton,revision:input.revision},data:{publishedVersionId:publication.id,revision:{increment:1},updatedBy:actor.id}});
  ensure(updated.count===1,409,'REVISION_CONFLICT','广告词已更新，请重新读取核对');
  const result={id:singleton,revision:input.revision+1,version:publication.version,contentHash:publication.contentHash};
  await audit(tx,actor.id,'PUBLISH','advertising-copy',singleton,result);return result;
 });}
 private async command(actor:StaffActor,action:string,input:{idempotencyKey:string},operation:(tx:Prisma.TransactionClient)=>Promise<unknown>){
  const execute=()=>this.db.serial(async tx=>{
   // Recheck current authority before reading any old command receipt.
   await requireCurrentStaff(tx,actor,'advertising-copy');
   const where={actorId_resourceId_action_key:{actorId:actor.id,resourceId,action,key:input.idempotencyKey}},requestHash=hash(input);
   const previous=await tx.productCommand.findUnique({where});
   if(previous){ensure(previous.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','相同幂等键不得修改内容');return previous.resultSnapshot;}
   const resultSnapshot=JSON.parse(JSON.stringify(await operation(tx)));
   await tx.productCommand.create({data:{actorId:actor.id,resourceId,action,key:input.idempotencyKey,requestHash,resultSnapshot}});return resultSnapshot;
  });
  try{return await execute();}catch(error:any){if(error.code==='P2002')return execute();throw error;}
 }
}
