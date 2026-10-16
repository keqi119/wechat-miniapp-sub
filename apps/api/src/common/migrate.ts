import './config';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
if (process.argv.includes('--test')) {
  if (!process.env.TEST_DATABASE_URL || !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')) throw new Error('必须指定独立_test数据库');
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve(__dirname, '../../prisma/schema.prisma')], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
