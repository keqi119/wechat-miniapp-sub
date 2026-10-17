const services = require('../../services/index');
const { load, go } = require('../../utils/page');
Page({
  data: { loading: true, error: '', title: '协议', intro: '', sections: [], version: '' },
  onLoad(options) { this.type = ['privacy', 'terms', 'application', 'credit-verification', 'mileage-pack','owner-identity','owner-auto-sign','owner-rental-contract','owner-data-sharing'].includes(options.type) ? options.type : 'terms'; this.reload(); },
  reload() {
    return load(this, async () => {
      const document = await services.getLegal(this.type);
      if (!document?.id || document.version == null || typeof document.content !== 'string' || !document.content.trim() || (['credit-verification', 'mileage-pack'].includes(this.type) && (document.type !== this.type || !Number.isInteger(document.version) || document.version < 1))) throw new Error('已发布协议暂不可用，请稍后重试。');
      wx.setNavigationBarTitle({ title: document.title });
      return { title: document.title, intro: '已发布版本 ' + document.version, version: document.version, sections: [{ title: document.title, text: document.content }] };
    });
  },
  openSettings() { go('/pages/settings/index'); },
});
