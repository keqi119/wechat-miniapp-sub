import {ensure} from '../common/errors';
import {requireElectronicOwnerActor} from './identities';
export type ElectronicActor={kind:'ADMIN'|'CUSTOMER'|'OWNER';id:string;ownerId?:string};
export async function electronicAccess(tx:any,actor:ElectronicActor,task:any,write=false,ownerCheck= requireElectronicOwnerActor){
 if(actor.kind==='ADMIN'){
  const staff=await tx.adminUser.findUnique({where:{id:actor.id}});
  ensure(staff?.active&&(write?['ADMIN','OPERATIONS']:['ADMIN','OPERATIONS','FINANCE','SUPPORT']).includes(staff.role),403,'FORBIDDEN','当前岗位无电子合同办理权限');return{role:null,staff};
 }
 if(actor.kind==='CUSTOMER'){
  ensure(task.customerId===actor.id&&task.parties.some((p:any)=>p.role==='CUSTOMER'&&p.subjectId===actor.id),404,'NOT_FOUND','本人的电子合同不存在');return{role:'CUSTOMER' as const};
 }
 ensure(actor.kind==='OWNER'&&actor.ownerId&&(actor.ownerId===task.ownerId||actor.ownerId===task.platformSubjectId),404,'NOT_FOUND','本企业的电子合同不存在');
 await ownerCheck(tx,actor.id,actor.ownerId);return{role:actor.ownerId===task.platformSubjectId?'PLATFORM' as const:'OWNER' as const};
}
