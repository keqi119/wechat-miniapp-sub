import { config } from 'dotenv';
import { resolve } from 'node:path';
export const projectRoot = resolve(__dirname, '../../../..');
config({ path: resolve(projectRoot, '.env'), quiet: true });
export function validateConfig() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL未配置');
  if (process.env.NODE_ENV === 'production') {
    for (const name of ['JWT_SECRET', 'SESSION_SECRET', 'ADMIN_ORIGIN']) {
      const value = process.env[name] || '';
      if (value.length < (name === 'ADMIN_ORIGIN' ? 8 : 32) || /changeme|default|demo|example/i.test(value)) throw new Error(`${name}生产配置无效`);
    }
    if (!process.env.ADMIN_ORIGIN!.startsWith('https://')) throw new Error('生产后台Origin必须HTTPS');
  }
}
