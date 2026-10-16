import '../common/config';
import { Db } from '../common/db';
import { passwordHash } from './auth.service';
async function main() {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME; const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password || password.length < 16 || /changeme|password|demo/i.test(password)) throw new Error('请配置独立强密码管理员引导参数');
  const db = new Db();
  try { if (await db.adminUser.count()) throw new Error('已有管理员；引导命令拒绝覆盖'); await db.adminUser.create({ data: { username, passwordHash: passwordHash(password), name: '平台管理员', role: 'ADMIN' } }); console.log('独立管理员创建成功；凭据未输出。'); } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('管理员引导失败，请检查配置及现有账号。'); process.exitCode = 1; });
