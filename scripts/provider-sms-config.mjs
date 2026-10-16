export function normalizeSmsConfig(source) {
  const result = {};
  for (const key of ['ALIYUN_SMS_ACCESS_KEY_ID', 'ALIYUN_SMS_ACCESS_KEY_SECRET', 'ALIYUN_SMS_ENDPOINT', 'ALIYUN_SMS_SIGN_NAME', 'ALIYUN_SMS_LOGIN_TEMPLATE_CODE', 'ALIYUN_SMS_TEMPLATE_CODE_VARIABLE']) {
    if (source[key] === undefined) continue;
    // Field names come from the fixed allowlist; never put credential values in errors.
    const invalid = () => { throw new Error(`Invalid SMS configuration: ${key}`); };
    if (typeof source[key] !== 'string') invalid();
    let value = source[key].trim();
    if ((value.startsWith('“') && value.endsWith('”')) || (value.startsWith('‘') && value.endsWith('’'))) {
      value = value.slice(1, -1).trim();
    }
    // Only paired Chinese outer quotes are removed. Unmatched or other quote
    // wrappers are rejected; characters inside legitimate sign names are retained.
    if (!value || /^[“”‘’"']|[“”‘’"']$/.test(value) || /[\x00-\x1f\x7f]/.test(value)) invalid();
    if (['ALIYUN_SMS_ACCESS_KEY_ID', 'ALIYUN_SMS_ACCESS_KEY_SECRET', 'ALIYUN_SMS_ENDPOINT'].includes(key)
      && (!/^[\x21-\x7e]+$/.test(value) || /["']/.test(value))) invalid();
    if (key === 'ALIYUN_SMS_LOGIN_TEMPLATE_CODE' && !/^SMS_[0-9]+$/.test(value)) invalid();
    if (key === 'ALIYUN_SMS_TEMPLATE_CODE_VARIABLE' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) invalid();
    result[key] = value;
  }
  return result;
}
