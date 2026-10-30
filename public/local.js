(() => {
  const KEY = 'quota-pocket-v1';
  const CACHE = 'quota-pocket-last-results-v1';
  const presets = [
    { id: 'dazhouzi', name: '大肘子', url: 'https://api.dzzi.ai', userId: '', token: '' },
    { id: 'ekan8', name: 'ekan8', url: 'https://api.ekan8.com', userId: '', token: '' },
    { id: 'jiushi', name: '玖时', url: 'https://api.jiushi.xin', userId: '', token: '' },
  ];
  function data() {
    try {
      const text = localStorage.getItem(KEY);
      if (!text) return { sites: structuredClone(presets), proxy: { url: '', key: '' } };
      const stored = JSON.parse(text);
      if (!Array.isArray(stored.sites)) throw new Error();
      return stored;
    } catch { throw new Error('无法读取本机数据，请检查浏览器存储是否可用。'); }
  }
  function save(value) {
    try { localStorage.setItem(KEY, JSON.stringify(value)); }
    catch { throw new Error('无法保存到浏览器，请检查设备存储空间与浏览器设置。'); }
  }
  function publicSite(site) {
    const { token, ...safe } = site;
    return { ...safe, configured: Boolean(site.userId && token) };
  }
  function originOf(value) {
    let url;
    try { url = new URL(String(value).trim()); } catch { throw new Error('请填写完整的站点地址。'); }
    if (url.username || url.password || url.search || url.hash) throw new Error('站点地址不能包含用户名、密码或查询参数。');
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('请使用 HTTPS 站点地址。');
    if (!['', '/', '/v1', '/v1/'].includes(url.pathname)) throw new Error('请填写站点首页地址，不要填写接口路径。');
    return url.origin;
  }
  function httpsUrl(value, label) {
    let url;
    try { url = new URL(String(value).trim()); } catch { throw new Error(`请填写完整的${label}。`); }
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error(`${label}需要使用 HTTPS，且不能包含账号或密码。`);
    return url.href.replace(/\/$/, '');
  }
  function getSite(id) {
    const site = data().sites.find((entry) => entry.id === id);
    if (!site) throw new Error('站点不存在，请刷新页面。');
    return site;
  }
  function upsert(input) {
    const state = data();
    const index = input.id ? state.sites.findIndex((site) => site.id === input.id) : -1;
    if (input.id && index < 0) throw new Error('站点不存在，请刷新页面。');
    const old = index < 0 ? null : state.sites[index];
    const name = String(input.name || '').trim();
    const url = originOf(input.url);
    const userId = String(input.userId || '').trim();
    const suppliedToken = String(input.token || '').trim().replace(/^Bearer\s+/i, '');
    if (!name) throw new Error('请填写站点名称。');
    if (userId && !/^\d+$/.test(userId)) throw new Error('用户 ID 应该是数字。');
    if (!suppliedToken && old?.token && old.url !== url) throw new Error('更换站点地址后，请重新填写该站点的访问令牌。');
    const token = suppliedToken || old?.token || '';
    if (/[\r\n]/.test(token) || (token && !userId)) throw new Error('使用访问令牌时，请同时填写有效的用户 ID。');
    const threshold = input.threshold === '' || input.threshold === null || input.threshold === undefined ? null : Number(input.threshold);
    if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0)) throw new Error('余额提醒请填写不小于零的数字。');
    const costPerUnit = input.costPerUnit === '' || input.costPerUnit === null || input.costPerUnit === undefined ? null : Number(input.costPerUnit);
    if (costPerUnit !== null && (!Number.isFinite(costPerUnit) || costPerUnit <= 0)) throw new Error('比价兑换比例需要大于零。');
    const rechargeUrl = String(input.rechargeUrl || '').trim() ? httpsUrl(input.rechargeUrl, '充值页地址') : '';
    const site = { id: old?.id || crypto.randomUUID(), name, url, userId, token, threshold, rechargeUrl, costPerUnit };
    if (index < 0) state.sites.push(site); else state.sites[index] = site;
    save(state);
    removeCache(site.id);
    return publicSite(site);
  }
  function remove(id) {
    const state = data();
    const next = state.sites.filter((site) => site.id !== id);
    if (next.length === state.sites.length) throw new Error('站点不存在，请刷新页面。');
    state.sites = next;
    save(state);
    removeCache(id);
  }
  function cache() {
    try { return JSON.parse(localStorage.getItem(CACHE) || '{}'); } catch { return {}; }
  }
  function putCache(id, result) {
    try { const all = cache(); all[id] = result; localStorage.setItem(CACHE, JSON.stringify(all)); }
    catch { /* 余额仍可查看，但浏览器没有保存离线快照。 */ }
  }
  function removeCache(id) {
    const all = cache(); delete all[id];
    try { localStorage.setItem(CACHE, JSON.stringify(all)); } catch { /* 与主配置的保存结果无关。 */ }
  }
  function settings() {
    return data().proxy || { url: '', key: '' };
  }
  function saveSettings(input) {
    const state = data();
    const url = String(input.url || '').trim() ? httpsUrl(input.url, '转发服务地址') : '';
    const key = String(input.key || '').trim();
    if (url && !key) throw new Error('请填写转发服务口令。');
    state.proxy = { url, key: url ? key : '' };
    save(state);
  }
  async function remote(site, endpoint, authenticated, envelope = false) {
    const proxy = settings();
    let response;
    try {
      if (proxy.url) {
        response = await fetch(`${proxy.url}/query`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proxy-Key': proxy.key },
          body: JSON.stringify({ site: site.url, endpoint, userId: authenticated ? site.userId : '', token: authenticated ? site.token : '' }),
          credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
        });
      } else {
        const headers = { Accept: 'application/json' };
        if (authenticated) { headers.Authorization = `Bearer ${site.token}`; headers['New-Api-User'] = site.userId; }
        response = await fetch(new URL(endpoint, site.url), { headers, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
      }
    } catch {
      throw new Error(navigator.onLine ? '连接失败：请检查网络，或站点是否允许网页跨域访问。' : '当前离线，无法刷新。');
    }
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new Error(`站点或转发服务拒绝访问（HTTP ${response.status}），请检查设置。`);
      throw new Error(`查询返回 HTTP ${response.status}，请检查站点或转发服务。`);
    }
    let result;
    try { result = await response.json(); } catch { throw new Error('站点没有返回可识别的数据，可能需要先通过站点验证。'); }
    if (!result || result.success !== true || !result.data || typeof result.data !== 'object') throw new Error('站点没有接受查询，请核对用户 ID 和系统访问令牌。');
    return envelope ? result : result.data;
  }
  function displayUnit(status) {
    const raw = { factor: 1, symbol: '', suffix: ' 额度', note: '站点未提供完整的显示设置，显示原始额度' };
    if (!status) return raw;
    const type = status.quota_display_type || (status.display_in_currency === false ? 'TOKENS' : null);
    if (type === 'TOKENS') return { factor: 1, symbol: '', suffix: ' 额度', note: '' };
    const unit = Number(status.quota_per_unit);
    if (!Number.isFinite(unit) || unit <= 0) return raw;
    if (type === 'USD') return { factor: 1 / unit, symbol: '$', suffix: '', note: '' };
    if (type === 'CNY') {
      const rate = Number(status.usd_exchange_rate);
      return Number.isFinite(rate) && rate > 0 ? { factor: rate / unit, symbol: '¥', suffix: '', note: '' } : raw;
    }
    if (type === 'CUSTOM') {
      const rate = Number(status.custom_currency_exchange_rate);
      const symbol = typeof status.custom_currency_symbol === 'string' ? status.custom_currency_symbol.trim() : '';
      return Number.isFinite(rate) && rate > 0 && symbol ? { factor: rate / unit, symbol, suffix: '', note: '' } : raw;
    }
    return raw;
  }
  const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  async function refresh(id) {
    const site = getSite(id);
    if (!site.userId || !site.token) return { ok: false, error: '请先连接站点。' };
    const now = new Date();
    const end = Math.floor(now.getTime() / 1000);
    const day = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
    const month = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
    const stats = (start) => `/api/log/self/stat?type=2&start_timestamp=${start}&end_timestamp=${end}`;
    const [profile, status, today, thisMonth] = await Promise.allSettled([
      remote(site, '/api/user/self', true), remote(site, '/api/status', false),
      remote(site, stats(day), true), remote(site, stats(month), true),
    ]);
    if (profile.status === 'rejected') return { ok: false, error: profile.reason.message };
    const remaining = number(profile.value.quota), used = number(profile.value.used_quota);
    if (remaining === null || used === null) return { ok: false, error: '站点返回的数据里没有可识别的余额或用量。' };
    const result = {
      ok: true, remaining, used,
      today: today.status === 'fulfilled' ? number(today.value.quota) : null,
      month: thisMonth.status === 'fulfilled' ? number(thisMonth.value.quota) : null,
      unit: displayUnit(status.status === 'fulfilled' ? status.value : null),
      updatedAt: new Date().toISOString(),
    };
    putCache(id, result);
    return result;
  }
  async function logs(id, page = 1, type = 0) {
    const site = getSite(id);
    if (!site.userId || !site.token) throw new Error('请先连接站点。');
    const query = new URLSearchParams({ p: String(page), page_size: '20', type: String(type) });
    return remote(site, `/api/log/self?${query}`, true);
  }
  async function recharge(id) {
    const site = getSite(id);
    if (site.rechargeUrl) return site.rechargeUrl;
    const status = await remote(site, '/api/status', false);
    if (status.theme === 'default') return `${site.url}/wallet`;
    if (status.theme === 'classic') return `${site.url}/console/topup`;
    throw new Error('未能识别充值页面，请在站点设置中填写充值页地址。');
  }
  async function pricing(id) {
    const site = getSite(id);
    let isPublic = !site.userId || !site.token;
    const priceQuery = async () => {
      if (!isPublic) {
        try { return await remote(site, '/api/pricing', true, true); }
        catch { isPublic = true; }
      }
      return remote(site, '/api/pricing', false, true);
    };
    const [prices, status] = await Promise.allSettled([priceQuery(), remote(site, '/api/status', false)]);
    if (prices.status === 'rejected') throw prices.reason;
    if (!Array.isArray(prices.value.data)) throw new Error('站点没有返回可识别的模型价格列表。');
    return {
      models: prices.value.data,
      groups: prices.value.usable_group || {},
      ratios: prices.value.group_ratio || {},
      status: status.status === 'fulfilled' ? status.value : null,
      unit: displayUnit(status.status === 'fulfilled' ? status.value : null),
      isPublic,
    };
  }
  function exportSites() {
    return { version: 1, sites: data().sites.map(({ name, url, userId, threshold, rechargeUrl, costPerUnit }) => ({ name, url, userId, threshold: threshold ?? null, rechargeUrl: rechargeUrl || '', costPerUnit: costPerUnit ?? null })) };
  }
  function importSites(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.sites)) throw new Error('配置文件格式不正确。');
    const state = data();
    let added = 0, skipped = 0;
    for (const item of value.sites) {
      try {
        const name = String(item.name || '').trim(), url = originOf(item.url), userId = String(item.userId || '').trim();
        if (!name || (userId && !/^\d+$/.test(userId))) throw new Error();
        if (state.sites.some((site) => site.name === name && site.url === url && site.userId === userId)) { skipped++; continue; }
        const threshold = item.threshold == null ? null : Number(item.threshold);
        if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0)) throw new Error();
        const costPerUnit = item.costPerUnit == null ? null : Number(item.costPerUnit);
        if (costPerUnit !== null && (!Number.isFinite(costPerUnit) || costPerUnit <= 0)) throw new Error();
        const rechargeUrl = item.rechargeUrl ? httpsUrl(item.rechargeUrl, '充值页地址') : '';
        state.sites.push({ id: crypto.randomUUID(), name, url, userId, token: '', threshold, rechargeUrl, costPerUnit }); added++;
      } catch { skipped++; }
    }
    save(state);
    return { added, skipped };
  }
  window.ledger = {
    sites: () => data().sites.map(publicSite), upsert, remove, settings, saveSettings,
    refresh, logs, recharge, pricing, cache, exportSites, importSites,
  };
})();
