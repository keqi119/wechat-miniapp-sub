const service = require('../../services/index');
const { load, go } = require('../../utils/page');
const { navigation } = require('../../utils/tab-navigation');
const { subscriptionCopies, nextSubscriptionCopy } = require('../../utils/subscription-copy');

Page({
  data: { loading: true, error: '', vehicles: [], context: {}, faqOpen: false, heroCopy: subscriptionCopies[0] },
  onShow() {
    navigation.onShow(this, 0);
    return this.refresh();
  },
  onHide() { navigation.onHide(this); },
  onUnload() { navigation.onHide(this); },
  async onPullDownRefresh() {
    try {
      await this.refresh();
    } finally {
      wx.stopPullDownRefresh();
    }
  },
  refresh() {
    // Public offers must be revalidated before retained tab content can be shown.
    this._loadedSession = null;
    const previousId = this.data.heroCopy.id;
    this.setData({ vehicles: [] });
    return load(this, async () => {
      const revision = this._loadRevision;
      const [home, copy] = await Promise.allSettled([service.getHome(), service.getAdvertisingCopy()]);
      const heroCopy = nextSubscriptionCopy(previousId, copy.status === 'fulfilled' ? copy.value.items : subscriptionCopies);
      if (home.status === 'rejected') {
        if (this._loadRevision === revision && !this._disposed && !this.disposed) this.setData({ heroCopy });
        throw home.reason;
      }
      return { ...home.value, heroCopy };
    });
  },
  openCatalog() {
    go('/pages/catalog/index');
  },
  openVehicle(event) {
    if (this.data.loading || this.data.error) return;
    const id = event.currentTarget?.dataset?.id;
    if (!this.data.vehicles.some(vehicle => vehicle.id === id)) return;
    go('/pages/vehicle/index?vehicleId=' + encodeURIComponent(id));
  },
  toggleFaq() {
    this.setData({ faqOpen: !this.data.faqOpen });
  },
});
