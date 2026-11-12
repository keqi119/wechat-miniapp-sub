import {z} from 'zod';
import {Controller,Get,Post,Inject,Param,Body,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {audit,key} from '../common/data';
import {ensure} from '../common/errors';
import {archiveCommand} from '../offline-documents/command';
import {authorizeWorkspace,workspaceVehicle,revision} from './service';

const input=z.object({revision,vehicleRevision:revision,idempotencyKey:key,fireDamage:z.boolean(),floodDamage:z.boolean(),structuralDamage:z.boolean(),reason:z.string().trim().min(2).max(1000).refine(v=>!v.includes('\0')).optional()}).strict();
const facts=(row:any)=>row?{fireDamage:row.fireDamage,floodDamage:row.floodDamage,structuralDamage:row.structuralDamage}:null;
function view(vehicle:any,row:any){return{vehicleId:vehicle.id,vehicleRevision:vehicle.revision,revision:row?.revision??0,registered:!!row,fireDamage:row?.fireDamage??null,floodDamage:row?.floodDamage??null,structuralDamage:row?.structuralDamage??null,assessedBy:row?.assessedBy??null,assessedAt:row?.assessedAt?.toISOString()??null};}
export class ConditionAssessmentService{
 constructor(private clock:()=>Date=()=>new Date()){}
 async read(tx:any,actor:any,vehicleId:string){
  await authorizeWorkspace(tx,actor);const vehicle=await workspaceVehicle(tx,vehicleId),row=await tx.vehicleConditionAssessment.findUnique({where:{vehicleId}});return view(vehicle,row);
 }
 async save(tx:any,actor:any,vehicleId:string,raw:unknown){
  const body=input.parse(raw);await authorizeWorkspace(tx,actor,true);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.id}:condition:${vehicleId}:${body.idempotencyKey}`},0))`;
  await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${vehicleId} FOR UPDATE`;
  const vehicle=await workspaceVehicle(tx,vehicleId);
  return archiveCommand(tx,actor,`condition:${vehicleId}`,'CONDITION_ASSESSMENT_SAVE',body,async()=>{
   const before=await tx.vehicleConditionAssessment.findUnique({where:{vehicleId}});
   ensure(body.vehicleRevision===vehicle.revision&&body.revision===(before?.revision??0),409,'REVISION_CONFLICT','车辆或基本车况已变化，请刷新后核对');
   ensure(!before||body.reason,400,'CONDITION_REASON_REQUIRED','修改基本车况须填写修改说明');
   const assessedAt=this.clock(),data={fireDamage:body.fireDamage,floodDamage:body.floodDamage,structuralDamage:body.structuralDamage,assessedBy:actor.id,assessedAt};
   if(before){const changed=await tx.vehicleConditionAssessment.updateMany({where:{vehicleId,revision:body.revision},data:{...data,revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','基本车况已变化，请重新核对');}
   else await tx.vehicleConditionAssessment.create({data:{vehicleId,...data,revision:1,createdBy:actor.id,createdAt:assessedAt}});
   const after=await tx.vehicleConditionAssessment.findUnique({where:{vehicleId}});
   await audit(tx,actor.id,'CONDITION_ASSESSMENT_SAVE','vehicles',vehicleId,{revision:body.revision+1,vehicleRevision:vehicle.revision,before:facts(before),after:facts(after),reason:body.reason??'首次登记',assessedAt});
   return view(vehicle,after);
  });
 }
}
@Controller()
export class VehicleConditionAssessmentController{
 private service=new ConditionAssessmentService();
 constructor(@Inject(Db)private db:Db){}
 @Get('admin/vehicles/:vehicleId/condition-assessment')read(@Param('vehicleId')id:string,@Req()request:any){return this.db.serial(tx=>this.service.read(tx,request.admin,id));}
 @Post('admin/vehicles/:vehicleId/condition-assessment')save(@Param('vehicleId')id:string,@Body()raw:unknown,@Req()request:any){return this.db.serial(tx=>this.service.save(tx,request.admin,id,raw));}
}
