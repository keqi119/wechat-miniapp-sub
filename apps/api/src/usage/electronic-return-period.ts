import {terminationSource} from '../orders/termination-source';
import {ensure} from '../common/errors';
import {shanghaiDay} from './rules';
/** Live source excludes voided/corrected05 rows; custody time remains on the receipt. */
export async function electronicReturnPeriod(tx:any,order:any,rows:any[],actualAt:Date){
 const source=await terminationSource(tx,order.id),live=rows.filter(p=>source.pin.periods.some((s:any)=>s.sequence===p.sequence&&(s.stageId===p.serviceStageId||s.stageKind==='INITIAL'&&!p.serviceStageId)&&s.startDate===p.startDate.toISOString().slice(0,10)&&s.endDate===p.endDate.toISOString().slice(0,10)));
 ensure(live.length===source.pin.periods.length,409,'TERMINATION_PERIOD_SOURCE');
 const end=live.at(-1).endDate,date=new Date(shanghaiDay(actualAt)),effectiveDate=date>end?end:date,last=live.find(p=>p.startDate<=effectiveDate&&effectiveDate<p.endDate)||live.find(p=>p.endDate.getTime()===effectiveDate.getTime());ensure(last,409,'RETURN_OUTSIDE_TERM');return{live,last,effectiveDate};
}
