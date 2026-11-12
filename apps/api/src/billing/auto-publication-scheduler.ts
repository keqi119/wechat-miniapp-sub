import {Inject,Injectable,OnModuleDestroy} from '@nestjs/common';
import {Db} from '../common/db';
import {scanAutomaticBills,type AutomaticBillScan} from './auto-publication';

export type BillAutoPublicationScanReport=AutomaticBillScan&{startedAt:string;finishedAt:string;stopped:boolean};

type SchedulerOptions={
 env?:NodeJS.ProcessEnv;
 now?:()=>Date;
 schedule?:(callback:()=>void,milliseconds:number)=>NodeJS.Timeout;
 cancel?:(timer:NodeJS.Timeout)=>void;
 reportError?:(message:string)=>void;
 reportScan?:(report:BillAutoPublicationScanReport)=>void;
};

/** Only local bill state and in-app notifications change; no payment/provider requests. */
export function startBillAutoPublicationScheduler(db:Pick<Db,'serial'|'bill'>,options:SchedulerOptions={}):()=>Promise<void>{
 if((options.env||process.env).BILL_AUTO_PUBLISH_ENABLED!=='true')return()=>Promise.resolve();
 const now=options.now||(()=>new Date()),schedule=options.schedule||setInterval,cancel=options.cancel||clearInterval;
 const reportError=options.reportError||((message:string)=>console.error(message));
 const reportScan=options.reportScan||((result:BillAutoPublicationScanReport)=>console.info(`BILL_AUTO_PUBLICATION_SCAN ${JSON.stringify(result)}`));
 const report=()=>{try{reportError('账单自动发布扫描未全部完成，将在下次扫描重试。');}catch{/* Logging must not prevent retries. */}};
 let stopped=false,pending:Promise<void>|undefined;
 const scan=()=>{
  if(stopped||pending)return;
  pending=Promise.resolve().then(async()=>{
   if(stopped)return;
   const startedAt=now(),result=await scanAutomaticBills(db,startedAt,{shouldStop:()=>stopped});
   // Keep this projection explicit: logs must never acquire bill IDs or exception details.
   const summary:BillAutoPublicationScanReport={scanned:result.scanned,published:result.published,blocked:result.blocked,failed:result.failed,startedAt:startedAt.toISOString(),finishedAt:now().toISOString(),stopped};
   try{reportScan(summary);}catch{report();}
   if(result.failed)report();
  }).catch(report).finally(()=>{pending=undefined;});
 };
 const timer=schedule(scan,60000);timer.unref();scan();
 return()=>{if(!stopped){stopped=true;cancel(timer);}return pending||Promise.resolve();};
}

@Injectable()
export class BillAutoPublicationScheduler implements OnModuleDestroy{
 private stop?:()=>Promise<void>;
 constructor(@Inject(Db)private readonly db:Db){}
 start(options?:SchedulerOptions){if(!this.stop)this.stop=startBillAutoPublicationScheduler(this.db,options);}
 async onModuleDestroy(){await this.stop?.();}
}
