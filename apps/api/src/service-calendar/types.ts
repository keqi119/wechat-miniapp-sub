/** V31 is opt-in. Historical inclusive dates must never be inferred as this calendar. */
export type MoneyCents = number;
export type ServiceAnchor = { firstStartDay: string; anchorDay: number; ruleVersion: 'V31' };
export type ServicePeriod = { index: number; startDay: string; endDayExclusive: string };
export type CalendarScope = { anchor: ServiceAnchor; startPeriod: number };
