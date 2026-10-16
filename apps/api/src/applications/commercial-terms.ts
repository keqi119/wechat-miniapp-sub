import { z } from 'zod';
const agreedText = z.string().trim().min(1).max(5000).refine(value => !/\{\{|\}\}|待确认|另行通知/.test(value), '请填写双方确认的明确约定');
export const commercialTermsInput = z.object({
  vehicleIdentification: agreedText, permittedUse: agreedText, conditionDisclosure: agreedText,
  customerAddress: agreedText, mileageCarryRule: agreedText, excessMileageCalculation: agreedText,
  usageCosts: agreedText, insuranceDetails: agreedText, maintenanceRule: agreedText,
  serviceCoverage: agreedText, handoverArrangement: agreedText, earlyTerminationRule: agreedText,
  depositRefundRule: agreedText, otherFees: agreedText,
}).strict();
