const policy = require('./native-signing-policy');

// The official Fadada H5 page supplies these four parameters only after the user
// requests face verification. They are trusted only beneath the loaded, current,
// server-issued identity page; a direct link to the middle page has no authority.
function createFaceBridgeApi({ currentTask, native, error }) {
  let pending = null, sequence = 0;
  function parentTask(parent) {
    if (!parent || !['identity', 'owner-identity'].includes(parent.kind)) throw error('请从当前本人实名认证页面进入刷脸。', 'FACE_CONTEXT');
    const task = currentTask(parent.kind, parent.id);
    if (!task || task.url !== parent.url || task.loadedUrl !== parent.url) throw error('当前认证页面已变化，请返回原流程重新进入。', 'FACE_CONTEXT');
    return task;
  }
  function bound(bridgeId, parent) {
    const task = parentTask(parent);
    if (!pending || pending.id !== bridgeId || pending.task !== task || pending.kind !== parent.kind || pending.recordId !== parent.id) throw error('刷脸入口已失效，请返回原认证流程。', 'FACE_CONTEXT');
    return pending;
  }
  function markSigningWebLoaded(kind, id, url) {
    const task = currentTask(kind, id);
    if (task && task.url === url) task.loadedUrl = url;
  }
  function prepareFaceBridge(options, parent) {
    const task = parentTask(parent);
    if (pending?.stage === 'STARTING' || pending?.stage === 'STARTED') throw error('已有刷脸流程正在进行，请先返回原流程。', 'FACE_BUSY');
    const specification = policy.providerIdentityBridge(options, parent.kind + ':' + parent.id, new Date(task.expiresAt).toISOString(), task.config);
    const args = policy.bridgeArguments(options, specification, task.config);
    pending = { id: 'face-' + (++sequence), kind: parent.kind, recordId: parent.id, task, specification, args, stage: 'PREPARED' };
    return { bridgeId: pending.id };
  }
  async function startFaceBridge(bridgeId, parent) {
    const p = bound(bridgeId, parent);
    if (p.stage !== 'PREPARED') throw error('刷脸跳转正在进行，请勿重复点击。', 'FACE_BUSY');
    p.stage = 'STARTING';
    try {
      await native('navigateToMiniProgram', { appId: p.args.appId, path: p.args.path, envVersion: 'release' });
      if (pending === p) { bound(bridgeId, parent); p.stage = 'STARTED'; }
    } catch {
      if (pending === p) p.stage = 'PREPARED';
      throw error('尚未进入刷脸小程序，可重新点击；若仍失败，请返回认证页面。', 'FACE_NAVIGATION');
    }
  }
  function completeFaceBridge(bridgeId, entry, parent) {
    const p = bound(bridgeId, parent);
    const result = policy.faceReturn(entry, p.specification, ['STARTING', 'STARTED'].includes(p.stage), p.task.config);
    // Only this one bound return may replace the URL. Its result never writes an
    // authentication/signature status; Fadada and our backend still verify it.
    p.task.url = result.reloadUrl;
    p.task.faceCallbackUrl = result.reloadUrl;
    p.task.loadedUrl = '';
    pending = null;
    return result;
  }
  function cancelFaceBridge(bridgeId) { if (pending?.id === bridgeId) pending = null; }
  function clearFaceBridgeContext(kind, id) { if (pending?.kind === kind && pending.recordId === id) pending = null; }
  return { markSigningWebLoaded, prepareFaceBridge, startFaceBridge, completeFaceBridge, cancelFaceBridge, clearFaceBridgeContext, clearFaceBridge: () => { pending = null; } };
}
module.exports = { createFaceBridgeApi };
