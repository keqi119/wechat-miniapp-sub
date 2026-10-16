import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
export function passwordHash(password: string) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function passwordMatches(password: string, stored: string) { const [salt, encoded] = stored.split(':'); if (!salt || !encoded) return false; const expected = Buffer.from(encoded, 'hex'); const actual = scryptSync(password, salt, 64); return expected.length === actual.length && timingSafeEqual(expected, actual); }
export function token() { return randomBytes(32).toString('hex'); }
export function tokenHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
