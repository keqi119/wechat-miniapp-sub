import { createHash } from 'node:crypto';
import { z } from 'zod';
export const money = z.number().int().min(0).max(2147483647);
export const key = z.string().min(8).max(128);
export const text = z.string().trim().min(1).max(500);
export const fileIds = z.array(z.string().min(1)).max(20).default([]);
export const mobile = z.string().regex(/^1[3-9]\d{9}$/);
export function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function pagination(query: any) { const page = Math.max(1, Number(query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20)); return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }; }
export function fen(value: number | null | undefined) { return value == null ? '待确认' : `¥${(value / 100).toFixed(2)}`; }
export async function audit(tx: any, actorId: string, action: string, resourceType: string, resourceId: string, data: any = {}, actorType = 'ADMIN') { return tx.auditLog.create({ data: { actorId, actorType, action, resourceType, resourceId, data: JSON.parse(JSON.stringify(data)) } }); }
export async function notify(tx: any, customerId: string, title: string, content: string, resourceType: string, resourceId: string) { return tx.notification.create({ data: { customerId, title, content, resourceType, resourceId } }); }
