import {Inject,Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {Db} from '../common/db';
import {ElectronicDocumentService} from './service';
import {reconcileElectronicCooperation} from './cooperation';
export async function reconcileElectronicBatch(db:any,service:Pick<ElectronicDocumentService,'advance'|'reconcileStopped'>,now=new Date()){
 const tasks=await db.electronicSigningTask.findMany({where:{status:{in:['SIGNING','SIGNED','FILING','ARCHIVING']},retiredAt:null,withdrawnAt:null,OR:[{processingUntil:null},{processingUntil:{lte:now}}]},select:{id:true},orderBy:{updatedAt:'asc'},take:20});
 let reconciled=0,failed=0;for(const task of tasks)try{await service.advance(task.id);reconciled++;}catch{failed++;}const stopped=await db.electronicSigningTask.findMany({where:{status:{in:['WITHDRAWN','RETIRED']},stoppedEvidenceId:null,OR:[{recoveryNextCheckAt:null},{recoveryNextCheckAt:{lte:now}}],parties:{some:{attemptedAt:{not:null}}}},select:{id:true},orderBy:[{recoveryNextCheckAt:{sort:'asc',nulls:'first'}},{updatedAt:'asc'},{id:'asc'}],take:20});for(const task of stopped)try{await db.electronicSigningTask.updateMany({where:{id:task.id},data:{recoveryNextCheckAt:new Date(now.getTime()+30000)}});await service.reconcileStopped(task.id);reconciled++;}catch{failed++;}return{reconciled,failed};
}
@Injectable()
export class ElectronicReconciler implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setInterval>;private running=false;private readonly logger=new Logger(ElectronicReconciler.name);
 constructor(@Inject(Db)private db:Db,@Inject(ElectronicDocumentService)private service:ElectronicDocumentService){}
 async onModuleInit(){if(process.env.NODE_ENV==='test')return;await this.service.secureExistingQuarantineArtifacts();this.timer=setInterval(()=>void this.tick(),30000);this.timer.unref();}
 private async tick(){if(this.running)return;this.running=true;try{await reconcileElectronicBatch(this.db,this.service);await reconcileElectronicCooperation(this.db);}catch{this.logger.warn('Electronic reconciliation unavailable; the next scheduled scan will retry.');}finally{this.running=false;}}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
}
