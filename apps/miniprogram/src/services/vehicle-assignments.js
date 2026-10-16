function beijingTime(value) { const time = typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN; return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') + '（北京时间）' : '待核对'; }
function assignmentView(value, invalid) {
  if (value == null) return null;
  const v = value.vehicle;
  if (typeof value.id !== 'string' || !value.id || !['ACTIVE', 'CLOSED'].includes(value.status) || typeof v?.id !== 'string' || !v.id || typeof v.title !== 'string' || !v.title || !Number.isSafeInteger(value.startReadingKm) || value.startReadingKm < 0 || (value.endReadingKm != null && (!Number.isSafeInteger(value.endReadingKm) || value.endReadingKm < value.startReadingKm))) invalid();
  return { id: value.id, vehicle: { id: v.id, title: v.title, plateNumber: typeof v.plateNumber === 'string' ? v.plateNumber : '', vin: typeof v.vin === 'string' ? v.vin : '' }, status: value.status, statusText: value.status === 'ACTIVE' ? '当前用车' : '已交还', startAt: value.startAt, endAt: value.endAt || null, startAtText: beijingTime(value.startAt), endAtText: value.endAt ? beijingTime(value.endAt) : '尚未交还', startReadingKm: value.startReadingKm, endReadingKm: value.endReadingKm ?? null };
}
function assignmentHistory(value, invalid) { if (value == null) return []; if (!Array.isArray(value)) invalid(); return value.map(row => { const a = assignmentView(row, invalid); if (!a) invalid(); return a; }); }
module.exports = { assignmentView, assignmentHistory, beijingTime };
