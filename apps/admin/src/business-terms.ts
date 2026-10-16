export const commercialTermLabels: Record<string, string> = {
  vehicleIdentification: '车辆识别信息（VIN / 牌照）', permittedUse: '允许用途与使用限制', conditionDisclosure: '逐单车况披露', customerAddress: '客户联系地址',
  mileageCarryRule: '里程累计与结转规则', excessMileageCalculation: '超里程计算与上限', usageCosts: '充电、停车、通行及违章责任', insuranceDetails: '保险机构、保单与保障责任',
  maintenanceRule: '保养与磨损责任', serviceCoverage: '权益区域、时间、次数与电话', handoverArrangement: '交还车安排与延迟处理', earlyTerminationRule: '提前解约计算、上限与退费', depositRefundRule: '押金结算与退款期限', otherFees: '其他收费项目',
};
export const handoverFactLabels: Record<string, string> = { actualTimeAndPlace: '实际交接时间与地点', batteryLevel: '交接时电量', accessoriesChecklist: '随车物品核对', conditionChecklist: '车辆状况核对', openItems: '未结事项', resolutionPlan: '处理方案', staffName: '现场工作人员' };
export function parseCommercialTerms(input: string): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { throw new Error('请完整填写逐单商业条款'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请完整填写逐单商业条款');
  const source = parsed as Record<string, unknown>, result: Record<string, string> = {};
  for (const [key, label] of Object.entries(commercialTermLabels)) {
    const value = source[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`请明确填写${label}；不适用的项目请明确写明`);
    if (/\{\{|\}\}|待确认|另行通知|待填写|待补齐/.test(value)) throw new Error(`${label}仍含待定或模板占位内容`);
    result[key] = value.trim();
  }
  return result;
}
export function normaliseHandoverChecklist(input: unknown): { label: string; value: string }[] {
  const rows = Array.isArray(input) ? input.filter(row => row && typeof row.label === 'string').map(row => ({ label: row.label, value: typeof row.value === 'string' ? row.value : '' })) : input && typeof input === 'object' ? Object.entries(input).map(([label, value]) => ({ label, value: typeof value === 'string' ? value : '' })) : [];
  return [...Object.keys(handoverFactLabels).map(label => ({ label, value: rows.find(row => row.label === label)?.value ?? '' })), ...rows.filter(row => !Object.hasOwn(handoverFactLabels, row.label))];
}
