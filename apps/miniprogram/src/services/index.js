const config = require('../config');
const { createApi } = require('./api');
if (config.mode !== 'api') throw new Error('真实小程序仅支持新平台 API，请检查配置。');
module.exports = createApi(config, options => wx.request(options), wx);
