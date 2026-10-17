import type { Entity } from './core.ts';
export function handoverProposal(entity: Entity): string {
  const place = (entity.profile as { handoverLocation?: { name?: string; address?: string } } | undefined)?.handoverLocation;
  if (typeof place?.address !== 'string' || !place.address.trim()) return '';
  return `客户建议交车、还车使用同一地点：${typeof place.name === 'string' && place.name.trim() ? place.name.trim() + '，' : ''}${place.address.trim()}。须核对服务范围、时间和场地后再与客户确认。`;
}
export function prefillHandoverTerms(entity: Entity, input: unknown): Record<string, unknown> {
  const terms = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const proposal = handoverProposal(entity);
  if (typeof terms.handoverArrangement === 'string' && terms.handoverArrangement.trim() || !proposal) return { ...terms };
  return { ...terms, handoverArrangement: proposal + ' 具体交还安排与延迟处理待确认，请核对补全后再发布方案。' };
}
