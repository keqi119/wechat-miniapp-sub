import {ensure} from '../common/errors';
import {calendarDay} from '../service-calendar/rules';
/** Frozen planned day is authoritative. Prose holds the confirmed place/contact, never actual start. */
export function electronicDeliveryPlan(startDate:unknown,arrangement:unknown):string{
 const raw=startDate instanceof Date&&Number.isFinite(startDate.getTime())?startDate.toISOString():startDate;
 ensure(typeof raw==='string'&&/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/.test(raw),409,'ELECTRONIC_PLANNED_DATE_REQUIRED','缺少已冻结的有效计划交付日');
 const day=raw.slice(0,10);try{calendarDay(day);}catch{ensure(false,409,'ELECTRONIC_PLANNED_DATE_REQUIRED','计划交付日无效');}
 ensure(typeof arrangement==='string'&&arrangement.trim(),409,'V31_SOURCE_REQUIRED','请确认计划交付地点及联系人');
 const facts=arrangement.replace(/(?<!\d)(\d{4})\s*(?:[-/.]|年)\s*(\d{1,2})\s*(?:[-/.]|月)\s*(\d{1,2})日?(?!\d)/gu,(_match,y,m,d)=>{
  const explicit=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  ensure(explicit===day,409,'ELECTRONIC_PLANNED_DATE_CONFLICT','文字中的计划交付日期与已确认计划日不一致，请修正地点联系人事实');return '';
 }).replace(/(?<![\d年])(\d{1,2})月(\d{1,2})日(?!\d)/gu,(_match,m,d)=>{
  ensure(`${m.padStart(2,'0')}-${d.padStart(2,'0')}`===day.slice(5),409,'ELECTRONIC_PLANNED_DATE_CONFLICT','文字中的计划交付日期与已确认计划日不一致，请修正地点联系人事实');return '';
 }).replace(/(?:计划交付日期|计划交付日|计划日期)\s*[:：]?\s*(?=[;；，,\s]|$)/gu,'').split(/[;；]/u).map(p=>p.trim().replace(/^[，,、\s]+|[，,、\s]+$/gu,'')).filter(Boolean).join('；');
 ensure(facts,409,'V31_SOURCE_REQUIRED','请确认计划交付地点及联系人');
 return `计划交付日期：${day}；${facts}`;
}
