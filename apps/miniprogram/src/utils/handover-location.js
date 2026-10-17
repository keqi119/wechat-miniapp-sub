function initialLocationData() {
  return { locationEnabled: false, locationMapEnabled: false, locationName: '', locationAddress: '', locationAccepted: false, locationNotice: null, locationNoticeOpen: false, locationChoosing: false, locationMessage: '', locationSaved: false };
}
function locationPayload(value) {
  if (value === undefined || value === null) return value;
  const result = { source: value.source, name: String(value.name || '').trim(), address: String(value.address || '').trim() };
  if (value.source === 'MAP') { result.accepted = value.accepted === true; result.policyHash = value.policyHash; }
  return result;
}
function createLocationEditor(page, service, platform, storageKey) {
  let active = true, identity = session(), generation = 0, loading = 0, saved, dirty = false, source = 'MANUAL', selectedHash, capability, pickerOpen = false;
  function session() { const s = platform.getStorageSync(storageKey); return s?.token && s?.customer?.id ? s.token + ':' + s.customer.id : ''; }
  function reset() {
    dirty = false; source = 'MANUAL'; selectedHash = undefined; pickerOpen = false; generation++;
    page.setData({ locationName: saved?.name || '', locationAddress: saved?.address || '', locationSaved: !!saved, locationAccepted: false, locationNoticeOpen: false, locationChoosing: false, locationMessage: '' });
  }
  function current(stamp) {
    if (!active) return false;
    if (session() !== identity) { identity = session(); saved = undefined; reset(); return false; }
    return stamp === undefined || stamp === generation;
  }
  function showCapability(next) {
    const valid = next?.enabled === true && next.notice?.id && next.notice?.version && next.notice?.content && /^[a-f0-9]{64}$/.test(next.policyHash || '');
    if (!valid || capability?.policyHash !== next.policyHash) {
      if (source === 'MAP' && dirty) reset();
      page.setData({ locationAccepted: false, locationNoticeOpen: false });
    }
    capability = valid ? next : null;
    page.setData({ locationEnabled: !!capability, locationMapEnabled: !!capability?.mapEnabled, locationNotice: capability?.notice || null });
  }
  return {
    async load(previous) {
      if (!current()) return;
      const stamp = generation, revision = ++loading;
      try {
        const next = await service.getHandoverLocationCapability();
        if (!current(stamp) || revision !== loading) return;
        if (previous !== undefined && !dirty) { saved = previous; reset(); }
        showCapability(next);
      } catch (_) { if (current(stamp) && revision === loading) showCapability(null); }
    },
    sync: current,
    hide() { if (active && !pickerOpen) reset(); },
    dispose() { saved = undefined; reset(); active = false; loading++; },
    input(field, value) {
      if (!current() || page.data.busy || page.data.locationChoosing || !capability || !['name','address'].includes(field)) return;
      dirty = true; source = 'MANUAL'; selectedHash = undefined;
      page.setData({ [field === 'name' ? 'locationName' : 'locationAddress']: String(value).slice(0, field === 'name' ? 100 : 500), locationAccepted: false, locationSaved: false, locationMessage: '地点将作为建议提交，仍需运营核对。' });
    },
    clear() { if (!current() || page.data.busy || page.data.locationChoosing) return; reset(); dirty = true; page.setData({ locationName: '', locationAddress: '', locationSaved: false }); },
    toggleNotice() { if (current() && capability && !page.data.busy && !page.data.locationChoosing) page.setData({ locationNoticeOpen: !page.data.locationNoticeOpen }); },
    accept(accepted) {
      if (!current() || page.data.busy || page.data.locationChoosing) return;
      page.setData({ locationAccepted: accepted === true && page.data.locationNoticeOpen && !!capability?.mapEnabled });
      if (!page.data.locationAccepted && source === 'MAP' && dirty) reset();
    },
    async choose() {
      if (!current() || !identity || page.data.busy || page.data.locationChoosing || !capability?.mapEnabled || !page.data.locationAccepted) return;
      const stamp = generation, policyHash = capability.policyHash;
      page.setData({ locationChoosing: true, locationMessage: '' });
      try {
        const fresh = await service.getHandoverLocationCapability();
        if (!current(stamp)) return;
        if (!fresh?.mapEnabled || fresh.policyHash !== policyHash) { showCapability(fresh); page.setData({ locationMessage: '地图或说明已更新，请重新阅读；也可手动填写。' }); return; }
        if (typeof platform.chooseLocation !== 'function') throw new Error('当前微信版本暂不支持地图选点，请手动填写。');
        // Only the native picker's own hide/return belongs to this flow.
        // Navigation while awaiting capability invalidates the generation.
        pickerOpen = true;
        const place = await new Promise((resolve, reject) => platform.chooseLocation({ success: resolve, fail: reject }));
        if (!current(stamp)) return;
        if (typeof place.address !== 'string' || place.address.trim().length < 2 || place.address.length > 500 || String(place.name || '').length > 100) throw new Error('未取得完整地址，请手动填写。');
        // Never copy the provider result object: it contains coordinates.
        source = 'MAP'; selectedHash = policyHash; dirty = true;
        page.setData({ locationName: String(place.name || '').trim(), locationAddress: place.address.trim(), locationSaved: false, locationMessage: '请核对地点名称和地址，提交申请时才会保存。修改文字后按手动地址提交。' });
      } catch (error) {
        if (current(stamp)) page.setData({ locationMessage: /cancel/i.test(error.errMsg || '') ? '已取消选点，未提交地点。' : error.message || '未取得地点，可手动填写地址。' });
      } finally { if (current(stamp)) { pickerOpen = false; page.setData({ locationChoosing: false }); } }
    },
    payload() {
      if (!current() || !dirty) return undefined;
      const name = page.data.locationName.trim(), address = page.data.locationAddress.trim();
      if (!name && !address) return null;
      if (!capability) throw new Error('交接地点说明正在更新，请重新加载后填写。');
      if (address.length < 2 || address.length > 500 || name.length > 100) throw new Error('请填写2–500字的完整交接地址。');
      if (source === 'MAP' && (!page.data.locationAccepted || selectedHash !== capability.policyHash || !capability.mapEnabled)) throw new Error('请重新阅读交接地点说明并选择地点。');
      return locationPayload({ source, name, address, accepted: page.data.locationAccepted, policyHash: selectedHash });
    },
  };
}
module.exports = { createLocationEditor, initialLocationData, locationPayload };
