import { readFileSync, writeFileSync, renameSync, chmodSync, chownSync, statSync } from 'node:fs';
import { createSign, createVerify, createDecipheriv, randomBytes, X509Certificate } from 'node:crypto';
const configPath = process.argv[2] || '.env.providers.local';
const env = Object.fromEntries(readFileSync(configPath, 'utf8').trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), JSON.parse(line.slice(i + 1))]; }));
async function refresh() {
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(16).toString('hex'), path = '/v3/certificates';
  const key = readFileSync(env.WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH);
  const signature = createSign('RSA-SHA256').update(`GET\n${path}\n${timestamp}\n${nonce}\n\n`).sign(key, 'base64');
  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${env.WECHAT_PAY_MCH_ID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${env.WECHAT_PAY_MERCHANT_SERIAL_NO}",signature="${signature}"`;
  const response = await fetch(`https://api.mch.weixin.qq.com${path}`, { headers: { Authorization: authorization, Accept: 'application/json', 'Accept-Language': 'zh-CN' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    let detail = String(problem.message || '').slice(0, 400);
    for (const value of Object.values(env)) if (typeof value === 'string' && value.length > 6) detail = detail.split(value).join('[redacted]');
    console.log(JSON.stringify({ status: response.status, providerCode: /^[A-Z_]{1,60}$/.test(problem.code) ? problem.code : 'UNKNOWN', detail }));
    throw new Error('CERTIFICATE_DOWNLOAD_REJECTED');
  }
  const raw = await response.text(), result = JSON.parse(raw);
  const apiKey = Buffer.from(env.WECHAT_PAY_API_V3_KEY || '');
  if (apiKey.length !== 32 || !Array.isArray(result.data) || !result.data.length) throw new Error('CERTIFICATE_CONFIG_INVALID');
  const certificates = result.data.map(item => {
    const data = item.encrypt_certificate;
    if (data?.algorithm !== 'AEAD_AES_256_GCM' || data.associated_data !== 'certificate') throw new Error('CERTIFICATE_ENCRYPTION_INVALID');
    const encrypted = Buffer.from(data.ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', apiKey, data.nonce);
    decipher.setAAD(Buffer.from(data.associated_data)); decipher.setAuthTag(encrypted.subarray(-16));
    const pem = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8');
    const cert = new X509Certificate(pem);
    if (cert.serialNumber.toUpperCase() !== item.serial_no.toUpperCase() || Date.parse(cert.validTo) <= Date.now()) throw new Error('CERTIFICATE_IDENTITY_INVALID');
    return { pem, cert };
  });
  // Bootstrap trust is authenticated by APIv3 AES-GCM over verified TLS. Also verify
  // the entire response with the newly authenticated certificate before writing it.
  const headerTime = response.headers.get('wechatpay-timestamp'), headerNonce = response.headers.get('wechatpay-nonce');
  const headerSerial = response.headers.get('wechatpay-serial'), headerSignature = response.headers.get('wechatpay-signature');
  const signer = certificates.find(item => item.cert.serialNumber.toUpperCase() === headerSerial?.toUpperCase());
  if (!signer || !headerSignature || !headerNonce || !/^\d{10}$/.test(headerTime || '') || Math.abs(Date.now() / 1000 - Number(headerTime)) > 300 || Date.parse(signer.cert.validFrom) > Date.now()) throw new Error('CERTIFICATE_RESPONSE_UNTRUSTED');
  if (!createVerify('RSA-SHA256').update(`${headerTime}\n${headerNonce}\n${raw}\n`).verify(signer.pem, headerSignature, 'base64')) throw new Error('CERTIFICATE_RESPONSE_UNTRUSTED');
  const target = env.WECHAT_PAY_PLATFORM_CERT_PATH;
  if (!target || !target.endsWith('.pem')) throw new Error('CERTIFICATE_OUTPUT_INVALID');
  const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temp, certificates.map(item => item.pem.trim()).join('\n') + '\n', { mode: 0o640 });
  chmodSync(temp, 0o640);
  if (process.platform !== 'win32') { const owner = statSync(target); chownSync(temp, owner.uid, owner.gid); }
  renameSync(temp, target);
  console.log(JSON.stringify({ certificateCount: certificates.length, responseVerified: true, updated: true, validity: certificates.map(item => ({ validFrom: item.cert.validFrom, validTo: item.cert.validTo })) }));
}
refresh().catch(error => { console.error(JSON.stringify({ updated: false, code: /^[A-Z_]+$/.test(error.message) ? error.message : 'CERTIFICATE_REFRESH_FAILED' })); process.exitCode = 1; });
