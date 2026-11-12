const service = require('../../services/index');
const { load, go } = require('../../utils/page');
const { navigation } = require('../../utils/tab-navigation');
const { subscriptionCopies, nextSubscriptionCopy } = require('../../utils/subscription-copy');

Page({
  data: { loading: true, error: '', items: [], brands: [], brand: '', query: '', appliedQuery: '', heroCopy: subscriptionCopies[0] },
  onShow() {
    navigation.onShow(this, 1);
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
  refresh({ rotateCopy = true } = {}) {
    // Published offers can be withdrawn while this tab is in the background.
    this._loadedSession = null;
    const previousId = this.data.heroCopy.id;
    this.setData({ items: [] });
    const token = (this._loadToken = (this._loadToken || 0) + 1);
    const params = { brand: this.data.brand, query: this.data.query.trim() };
    return load(this, async () => {
      const revision = this._loadRevision;
      const [vehicles, copy] = await Promise.allSettled([service.getVehicles(params), rotateCopy ? service.getAdvertisingCopy() : Promise.resolve(null)]);
      const patch = rotateCopy ? { heroCopy: nextSubscriptionCopy(previousId, copy.status === 'fulfilled' ? copy.value.items : subscriptionCopies) } : {};
      if (vehicles.status === 'rejected') {
        if (token === this._loadToken && this._loadRevision === revision && !this._disposed && !this.disposed) this.setData(patch);
        throw vehicles.reason;
      }
      return token === this._loadToken ? { ...vehicles.value, appliedQuery: params.query, ...patch } : {};
    });
  },
  onQuery(event) {
    this.setData({ query: event.detail.value });
  },
  search() {
    return this.refresh({ rotateCopy: false });
  },
  selectBrand(event) {
    this.setData({ brand: event.currentTarget.dataset.brand || '' });
    return this.refresh({ rotateCopy: false });
  },
  clearFilters() {
    this.setData({ brand: '', query: '' });
    return this.refresh({ rotateCopy: false });
  },
  openVehicle(event) {
    if (this.data.loading || this.data.error) return;
    const id = event.currentTarget?.dataset?.id;
    if (!this.data.items.some(vehicle => vehicle.id === id)) return;
    go('/pages/vehicle/index?vehicleId=' + encodeURIComponent(id));
  },
});
