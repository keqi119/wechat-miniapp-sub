const { tabs, navigation } = require('../utils/tab-navigation');

Component({
  data: { items: tabs, selected: 0, ripples: [] },
  lifetimes: {
    attached() {
      this._unsubscribe = navigation.subscribe(state => {
        const update = { selected: state.selected };
        const wave = state.feedback;
        if (wave && wave.id !== this._feedbackId) {
          this._feedbackId = wave.id;
          clearTimeout(this._rippleTimer);
          update.ripples = [{
            id: wave.id, index: wave.index,
            style: 'left:' + wave.x * 100 + '%;top:' + wave.y * 100 + '%;animation-duration:' + wave.remaining + 'ms;',
          }];
          this._rippleTimer = setTimeout(() => this.setData({ ripples: [] }), wave.remaining + 16);
        }
        this.setData(update);
      });
    },
    detached() {
      this._unsubscribe?.();
      clearTimeout(this._rippleTimer);
    },
  },
  methods: {
    onTap(event) {
      navigation.request(Number(event.currentTarget.dataset.index));
    },
  },
});
