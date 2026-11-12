import {changeIdentityMaterials} from '../owner-signing/identity-materials';
import {z} from 'zod';
import {audit} from '../common/data';
import {ensure} from '../common/errors';
import {PartnerActor,partnerProfileInput,commandInput,requirePartnerOperator,lockPartner,partnerCommand} from './types';
import {CooperationService} from './cooperation';
export class PartnerAdmissionService extends CooperationService {
 async create(tx:any,ctx:PartnerActor,raw:unknown){const input=z.object({profile:partnerProfileInput,idempotencyKey:z.string().min(8).max(128)}).strict().parse(raw);return partnerCommand(tx,ctx,'NEW','PROFILE_CREATE',input,async()=>{const owner=await tx.vehicleOwner.create({data:{...input.profile,createdBy:ctx.id}});await audit(tx,ctx.id,'PARTNER_CREATED','partners',owner.id,{subjectType:owner.subjectType});return owner;});}
 async update(tx:any,ctx:PartnerActor,ownerId:string,raw:unknown){
  const input=z.object({...commandInput,profile:partnerProfileInput,contactKind:z.enum(['CONTRACT','ORDINARY']).default('CONTRACT'),contactRevision:z.number().int().nonnegative().optional()}).strict().superRefine((value,ctx)=>{if(value.contactKind==='ORDINARY'&&value.contactRevision===undefined)ctx.addIssue({code:'custom',path:['contactRevision'],message:'普通联系信息更新须提供当前联系版本'});}).parse(raw);
  await requirePartnerOperator(tx,ctx);const owner=await lockPartner(tx,ownerId);
  return partnerCommand(tx,ctx,ownerId,'PROFILE_UPDATE',input,async()=>{
   ensure(owner.revision===input.revision&&(input.contactRevision===undefined||owner.contactRevision===input.contactRevision),409,'REVISION_CONFLICT','合作商资料已变化');ensure(owner.subjectType===input.profile.subjectType,409,'PARTNER_SUBJECT_IMMUTABLE','主体类型不能原位修改，请建立新主体');
   const legalChanged=['name','creditCode','address'].some(k=>(owner[k]??null)!==((input.profile as any)[k]??null)),phoneChanged=input.contactKind==='CONTRACT'&&owner.contactPhone!==input.profile.contactPhone,businessChanged=legalChanged||phoneChanged;
   await changeIdentityMaterials(tx,ctx.id,ownerId,input.profile);
   const {contactPhone,...legal}=input.profile;
   const changed=await tx.vehicleOwner.updateMany({where:{id:ownerId,revision:input.revision,...(input.contactRevision!==undefined?{contactRevision:input.contactRevision}:{})},data:{...legal,...(input.contactKind==='CONTRACT'?{contactPhone}:{ordinaryContactPhone:contactPhone,contactRevision:{increment:1}}),...(businessChanged?{revision:{increment:1}}:{})}});ensure(changed.count===1,409,'REVISION_CONFLICT','合作商资料已变化');
   if(businessChanged)await tx.partnerIdentityBinding.updateMany({where:{ownerId,status:'APPROVED'},data:{status:'STALE',revision:{increment:1}}});await audit(tx,ctx.id,'PARTNER_PROFILE_UPDATED','partners',ownerId,{revision:owner.revision+(businessChanged?1:0),businessChanged,contactKind:input.contactKind});return{id:ownerId,revision:owner.revision+(businessChanged?1:0),contactRevision:(owner.contactRevision||0)+(input.contactKind==='ORDINARY'?1:0)};
  });
 }
}
