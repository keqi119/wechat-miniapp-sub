export function amount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw new Error('金额必须为有效非负整数分');
  return value;
}
export function dateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('日期无效');
  return date;
}
export function billSchedule(start: string, months: number, fee: number): { dueDate: string; amount: number; sequence: number }[] {
  const origin = dateOnly(start);
  if (!Number.isInteger(months) || months < 1 || months > 120) throw new Error('期限须为1至120个月');
  amount(fee);
  return Array.from({ length: months }, (_, index) => {
    const end = new Date(Date.UTC(origin.getUTCFullYear(), origin.getUTCMonth() + index + 1, 0));
    const due = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), Math.min(origin.getUTCDate(), end.getUTCDate())));
    return { dueDate: due.toISOString().slice(0, 10), amount: fee, sequence: index + 1 };
  });
}
