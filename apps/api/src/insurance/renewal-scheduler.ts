import {Inject,Injectable,OnModuleDestroy} from '@nestjs/common';
import type {Db as Database} from '../common/db';
import {Db} from '../common/db';
import {createRenewalReminders} from './reminders';

type SchedulerOptions={
 now?:()=>Date;
 schedule?:(callback:()=>void,milliseconds:number)=>NodeJS.Timeout;
 cancel?:(timer:NodeJS.Timeout)=>void;
 reportError?:(message:string)=>void;
};

/** Database work items only; no provider calls or external notifications. */
export function startInsuranceRenewalScheduler(db:Pick<Database,'serial'>,options:SchedulerOptions={}):()=>Promise<void>{
 const now=options.now||(()=>new Date()),schedule=options.schedule||setInterval,cancel=options.cancel||clearInterval;
 const reportError=options.reportError||((message:string)=>console.error(message));
 let stopped=false,pending:Promise<void>|undefined;
 const scan=()=>{
  if(stopped||pending)return;
  pending=Promise.resolve().then(()=>stopped?undefined:db.serial(tx=>createRenewalReminders(tx,now()))).then(()=>undefined).catch(()=>{
   // Do not pass ORM errors, connection strings, or policy data to logs.
   try{reportError('保单续保待办扫描失败，将在下次扫描重试。');}catch{/* Logging must not stop later scans. */}
  }).finally(()=>{pending=undefined;});
 };
 const timer=schedule(scan,60*60*1000);timer.unref();scan();
 return ()=>{if(!stopped){stopped=true;cancel(timer);}return pending||Promise.resolve();};
}

@Injectable()
export class InsuranceRenewalScheduler implements OnModuleDestroy {
 private stop?:()=>Promise<void>;
 constructor(@Inject(Db)private readonly db:Db){}
 start(options?:SchedulerOptions){if(!this.stop)this.stop=startInsuranceRenewalScheduler(this.db,options);}
 async onModuleDestroy(){await this.stop?.();}
}
