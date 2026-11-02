import {Inject,Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {Db} from '../common/db';
import {ElectronicDocumentService} from './service';
export async function reconcileElectronicBatch(db:any,service:Pick<ElectronicDocumentService,'advance'>,now=new Date()){
 const tasks=await db.electronicSigningTask.findMany({where:{status:{in:['SIGNING','SIGNED','FILING','ARCHIVING']},retiredAt:null,withdrawnAt:null,OR:[{processingUntil:null},{processingUntil:{lte:now}}]},select:{id:true},orderBy:{updatedAt:'asc'},take:20});
 let reconciled=0,failed=0;for(const task of tasks)try{await service.advance(task.id);reconciled++;}catch{failed++;}return{reconciled,failed};
}
@Injectable()
export class ElectronicReconciler implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setInterval>;private running=false;private readonly logger=new Logger(ElectronicReconciler.name);
 constructor(@Inject(Db)private db:Db,@Inject(ElectronicDocumentService)private service:ElectronicDocumentService){}
 onModuleInit(){if(process.env.NODE_ENV==='test'||process.env.ELECTRONIC_SIGNING_ENABLED!=='true')return;this.timer=setInterval(()=>void this.tick(),30000);this.timer.unref();}
 private async tick(){if(this.running||process.env.ELECTRONIC_SIGNING_ENABLED!=='true')return;this.running=true;try{await reconcileElectronicBatch(this.db,this.service);}catch{this.logger.warn('Electronic reconciliation unavailable; the next scheduled scan will retry.');}finally{this.running=false;}}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
}
