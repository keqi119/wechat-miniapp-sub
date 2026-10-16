import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { signAliyunRequest } from '../apps/api/src/integrations/aliyun-sms';
const domain = 'keybox.cloud';
const records = ['mini-admin.subauto', 'mini-api.subauto'];
const profile = JSON.parse(readFileSync('C:/Users/keqi_119/.aliyun/config.json', 'utf8')).profiles.find((p: any) => p.name === 'stage1-keqi119');
async function call(action: string, parameters: Record<string, string>) {
  if (!profile?.access_key_id || !profile.access_key_secret || profile.sts_expiration * 1000 < Date.now()) throw new Error('Aliyun CLI profile credentials expired or unavailable');
  const request = signAliyunRequest({ host: 'alidns.aliyuncs.com', action, version: '2015-01-09', parameters, keyId: profile.access_key_id, keySecret: profile.access_key_secret, securityToken: profile.sts_token });
  const response = await fetch(request.url, { method: 'POST', headers: request.headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
  const data: any = await response.json();
  if (!response.ok || data.Code) throw new Error(`DNS API ${action}: ${data.Code || response.status}`);
  return data;
}
async function main() {
  const evidence: any[] = [];
  for (const rr of records) {
    const data = await call('DescribeDomainRecords', { DomainName: domain, RRKeyWord: rr, PageSize: '100' });
    const exact = (data.DomainRecords?.Record || []).filter((r: any) => r.RR === rr);
    if (process.argv.includes('--apply') && exact.length === 0) {
      const created = await call('AddDomainRecord', { DomainName: domain, RR: rr, Type: 'A', Value: '139.196.227.195', TTL: '600' });
      evidence.push({ domain: `${rr}.${domain}`, recordId: created.RecordId, value: '139.196.227.195', created: true });
    } else {
      if (process.argv.includes('--apply') && !exact.some((r: any) => r.Type === 'A' && r.Value === '139.196.227.195' && r.Status === 'ENABLE')) throw new Error(`Existing DNS record conflict at ${rr}; no changes made to it`);
      evidence.push({ domain: `${rr}.${domain}`, records: exact.map((r: any) => ({ id: r.RecordId, type: r.Type, value: r.Value, status: r.Status })) });
    }
  }
  mkdirSync('docs/evidence', { recursive: true }); writeFileSync('docs/evidence/dns-preflight.json', JSON.stringify({ checkedAt: new Date().toISOString(), evidence }, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
