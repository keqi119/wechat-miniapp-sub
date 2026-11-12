const { subscriptionCopies } = require('../utils/subscription-copy');
const clone = value => JSON.parse(JSON.stringify(value));
const controls = /[\u0000-\u001f\u007f-\u009f\u2028\u2029<>]/;
function objectKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}
function text(value, max) {
  return typeof value === 'string' && value.trim() === value && value.length > 0 &&
    Array.from(value).length <= max && !controls.test(value);
}
function publishedCopy(value) {
  if (!objectKeys(value, ['version', 'contentHash', 'publishedAt', 'items']) ||
      !Number.isSafeInteger(value.version) || value.version < 1 ||
      typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash) ||
      typeof value.publishedAt !== 'string' || !Number.isFinite(Date.parse(value.publishedAt)) ||
      !Array.isArray(value.items) || value.items.length !== subscriptionCopies.length) return null;
  if (!value.items.every((copy, index) => objectKeys(copy, ['id', 'title', 'lines', 'catalogDescription']) &&
      copy.id === subscriptionCopies[index].id && text(copy.title, 9) &&
      Array.isArray(copy.lines) && copy.lines.length === 2 && copy.lines.every(line => text(line, 32)) &&
      text(copy.catalogDescription, 40))) return null;
  return clone(value);
}

function createAdvertisingCopyReader({ request, url }) {
  // These are approved brand texts shipped with the app, never vehicle/business mock data.
  let cached = { version: 0, contentHash: null, publishedAt: null, items: clone(subscriptionCopies) };
  return function getAdvertisingCopy() {
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(clone(cached));
      };
      const timer = setTimeout(finish, 4000);
      try {
        request({
          url: url(), method: 'GET', timeout: 4000,
          header: { Accept: 'application/json' },
          success(response) {
            if (done) return;
            const value = response.statusCode === 200 ? publishedCopy(response.data) : null;
            if (value && (value.version > cached.version || value.version === cached.version && value.contentHash === cached.contentHash)) cached = value;
            finish();
          },
          fail: finish,
        });
      } catch { finish(); }
    });
  };
}

module.exports = { createAdvertisingCopyReader, publishedCopy };
