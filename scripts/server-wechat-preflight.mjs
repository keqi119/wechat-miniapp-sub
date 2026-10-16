import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('/run/config.env', 'utf8').trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), JSON.parse(line.slice(i + 1))]; }));
try {
  const response = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credential', appid: env.WECHAT_MINIPROGRAM_APP_ID, secret: env.WECHAT_MINIPROGRAM_APP_SECRET, force_refresh: false }), signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  console.log(JSON.stringify({ origin: 'production-server', checkedAt: new Date().toISOString(), ok: response.ok && typeof result.access_token === 'string', providerCode: result.errcode || 0, phoneAuthorizationTested: false }));
} catch { console.log(JSON.stringify({ origin: 'production-server', ok: false, reason: 'NETWORK_ERROR' })); process.exitCode = 1; }
