const tabs = [
  { path: '/pages/home/index', text: '首页', icon: 'home' },
  { path: '/pages/catalog/index', text: '选车', icon: 'car' },
  { path: '/pages/use/index', text: '用车', icon: 'key' },
  { path: '/pages/mine/index', text: '我的', icon: 'person' },
];

function createTabNavigation({ switchTab, showToast, now = Date.now }) {
  let active = 0, pending = null, desired = null, sequence = 0, feedback = null;
  const listeners = new Set();
  const valid = index => Number.isInteger(index) && index >= 0 && index < tabs.length;
  const coordinate = value => Number.isFinite(value) && value >= 0 && value <= 1 ? value : .5;
  function snapshot() {
    const elapsed = feedback ? now() - feedback.startedAt : 180;
    return {
      active,
      selected: pending ? (desired === null ? pending.to : desired) : active,
      pending: !!pending,
      feedback: feedback && elapsed >= 0 && elapsed < 180 ? { ...feedback, remaining: 180 - elapsed } : null,
    };
  }
  function publish() { listeners.forEach(listener => listener(snapshot())); }
  function settle(operation) {
    if (!operation || pending !== operation || !operation.succeeded || !operation.shown) return;
    const next = desired;
    pending = null; desired = null;
    publish();
    if (next !== null && next !== active) start(next);
  }
  function start(index) {
    const operation = { id: ++sequence, from: active, to: index, succeeded: false, shown: false };
    pending = operation; desired = null;
    publish();
    const fail = () => {
      if (pending !== operation) return;
      const next = desired;
      pending = null; desired = null;
      // A newer tap still wins when the superseded route fails.
      if (next !== null && next !== active) { start(next); return; }
      publish();
      if (next === null) showToast({ title: '页面暂时无法打开，请重试', icon: 'none' });
    };
    try {
      switchTab({
        url: tabs[index].path,
        success() { if (pending === operation) { operation.succeeded = true; settle(operation); } },
        fail,
      });
    } catch (_) { fail(); }
  }
  function request(index, point = {}) {
    if (!valid(index)) return;
    feedback = { id: ++sequence, index, x: coordinate(point.x), y: coordinate(point.y), startedAt: now() };
    if (pending) { desired = index; publish(); return; }
    if (index === active) { publish(); return; }
    start(index);
  }
  function onHide(page) {
    clearTimeout(page._mainTabMotionTimer);
    page._mainTabMotionTimer = null;
    if (page.data.mainTabMotion) page.setData({ mainTabMotion: '' });
  }
  function onShow(page, index) {
    if (!valid(index)) return;
    onHide(page);
    let motion = '';
    const operation = pending;
    if (operation && operation.to === index) {
      if (!operation.shown) motion = index > operation.from ? 'main-tab-from-right' : 'main-tab-from-left';
      operation.shown = true;
    } else if (operation) {
      // A real route reached outside this request takes precedence over late callbacks.
      pending = null; desired = null;
    }
    active = index;
    page.setData({ mainTabMotion: motion });
    if (motion) page._mainTabMotionTimer = setTimeout(() => {
      page._mainTabMotionTimer = null;
      page.setData({ mainTabMotion: '' });
    }, 220);
    publish();
    settle(operation);
  }
  function subscribe(listener) {
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }
  return { request, onShow, onHide, snapshot, subscribe };
}

const navigation = createTabNavigation({
  switchTab: options => wx.switchTab(options),
  showToast: options => wx.showToast(options),
});
module.exports = { tabs, createTabNavigation, navigation };
