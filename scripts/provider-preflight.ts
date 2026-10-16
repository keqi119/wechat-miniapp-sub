import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomBytes, X509Certificate } from 'node:crypto';
import { WechatPaymentGateway, wechatPaySettings } from '../apps/api/src/integrations/wechat-payment';
import { fadadaSettings } from '../apps/api/src/esign/esign.settings';
import { FadadaApiClient } from '../apps/api/src/esign/fadada/fadada-api.client';
import { FadadaHttpClient } from '../apps/api/src/esign/fadada/fadada-http-client';
const requireFromApi = createRequire(resolve('apps/api/package.json'));
const env = requireFromApi('dotenv').parse(readFileSync('.env.providers.local'));
function code(error: any) { const value = error?.getResponse?.()?.error?.code || error?.code || error?.name || 'UNKNOWN'; return /^[A-Z_a-z0-9]{1,80}$/.test(value) ? value : 'UNKNOWN'; }
async function main() {
  const evidence: any = { checkedAt: new Date().toISOString(), origin: 'local', scope: 'credential-and-read-only-provider-queries', noChargesNoSmsNoSigning: true };
  try {
    const response = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credential', appid: env.WECHAT_MINIPROGRAM_APP_ID, secret: env.WECHAT_MINIPROGRAM_APP_SECRET, force_refresh: false }), signal: AbortSignal.timeout(20000) });
    const result: any = await response.json();
    evidence.wechatMiniapp = { ok: response.ok && typeof result.access_token === 'string', providerCode: result.errcode || 0, phoneAuthorizationTested: false };
  } catch (error) { evidence.wechatMiniapp = { ok: false, errorCode: code(error) }; }
  if (env.WECHAT_PAY_PLATFORM_CERT_PATH) { const cert = new X509Certificate(readFileSync(env.WECHAT_PAY_PLATFORM_CERT_PATH)); evidence.wechatCertificate = { validFrom: cert.validFrom, validTo: cert.validTo, currentlyValid: Date.now() > Date.parse(cert.validFrom) && Date.now() < Date.parse(cert.validTo) }; }
  try {
    const gateway = new WechatPaymentGateway(wechatPaySettings({ ...env, WECHAT_PAY_ENABLED: 'true' }), async (url, options) => {
      const response = await fetch(url, options); const body: any = await response.clone().json().catch(() => ({}));
      evidence.wechatPayResponse = { status: response.status, providerCode: body.code, hasSignature: !!response.headers.get('wechatpay-signature'), verifierId: response.headers.get('wechatpay-serial') };
      return response;
    });
    await gateway.query(`preflight${randomBytes(10).toString('hex')}`);
    evidence.wechatPay = { ok: false, errorCode: 'UNEXPECTED_EXISTING_ORDER' };
  } catch (error) { const result = code(error); evidence.wechatPay = { ok: result === 'PAYMENT_ORDER_NOT_EXIST', errorCode: result, miniappMerchantBindingTested: false }; }
  try {
    const settings = fadadaSettings({ ...env, FADADA_ENABLED: 'true', FADADA_SIGNING_ENABLED: 'false' });
    if (!settings.platformCustomerId) throw new Error('PLATFORM_CUSTOMER_MISSING');
    const result = await new FadadaApiClient(settings, new FadadaHttpClient(settings)).queryCert({ customerId: settings.platformCustomerId });
    evidence.fadada = { providerCode: result.resultCode, certificateBound: result.certBound, certificateEvidencePresent: !!result.certSerialNo, companySealAuthorizationTested: false };
  } catch (error) { evidence.fadada = { ok: false, errorCode: code(error) }; }
  writeFileSync('docs/evidence/provider-preflight.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
}
main().catch(() => { console.error('Provider preflight failed; no credential values emitted.'); process.exitCode = 1; });
