(() => {
  const KEY = 'quota-pocket-v1';
  const CACHE = 'quota-pocket-last-results-v1';
  const VAULT_FORMAT = 'quota-pocket-vault-v1';
  const VAULT_ITERATIONS = 600000;
  const encode = text => new TextEncoder().encode(text);
  const decode = bytes => new TextDecoder().decode(bytes);
  let vaultSession = null, writeQueue = Promise.resolve();
  const presets = [
    { id: 'dazhouzi', name: '大肘子', url: 'https://api.dzzi.ai', userId: '', token: '' },
    { id: 'ekan8', name: 'ekan8', url: 'https://api.ekan8.com', userId: '', token: '' },
    { id: 'xiaoji-farm', name: '小鸡农场', url: 'https://api.68886868.xyz', userId: '', token: '' },
  ];
  function rawData() {
    try { return localStorage.getItem(KEY); }
    catch { throw new Error('无法读取本机数据，请检查浏览器存储是否可用。'); }
  }
  function parseData(text) {
    try { return JSON.parse(text); }
    catch { throw new Error('无法读取本机数据，请检查浏览器存储是否可用。'); }
  }
  function writeData(text) {
    try { localStorage.setItem(KEY, text); }
    catch { throw new Error('无法保存到浏览器，请检查设备存储空间与浏览器设置。'); }
  }
  function queueWrite(action) {
    const next = writeQueue.then(action);
    writeQueue = next.catch(() => {});
    return next;
  }
  function vaultStatus() {
    const raw = rawData(), record = raw ? parseData(raw) : null;
    return { enabled: record?.format === VAULT_FORMAT, unlocked: Boolean(vaultSession && vaultSession.snapshot === raw) };
  }
  function data() {
    const raw = rawData();
    if (vaultSession && vaultSession.snapshot !== raw) throw new Error('本机配置已在其他页面更改，请刷新后重新打开。');
    if (!raw) return { sites: structuredClone(presets), proxy: { url: '', key: '' }, xiaojiPresetAdded: true };
    let stored = parseData(raw);
    const encrypted = stored?.format === VAULT_FORMAT;
    if (encrypted) {
      if (!vaultSession) throw new Error('请先解锁本机加密。');
      stored = structuredClone(vaultSession.state);
    }
    if (!stored || !Array.isArray(stored.sites)) throw new Error('无法读取本机数据，请检查浏览器存储是否可用。');
    if (!stored.xiaojiPresetAdded) {
      if (!stored.sites.some(site => String(site.url || '').replace(/\/$/, '') === 'https://api.68886868.xyz')) {
        stored.sites.push(structuredClone(presets[2]));
      }
      stored.xiaojiPresetAdded = true;
      if (!encrypted) writeData(JSON.stringify(stored));
    }
    return stored;
  }
  function base64(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  function unbase64(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }
  function requireCrypto() {
    if (!crypto?.subtle || !crypto.getRandomValues) throw new Error('本机加密需要 HTTPS 或本机地址，以及支持 Web Crypto 的浏览器。');
  }
  async function deriveKey(password, salt) {
    const material = await crypto.subtle.importKey('raw', encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: VAULT_ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, salt, state) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encode(VAULT_FORMAT) }, key, encode(JSON.stringify(state)));
    return JSON.stringify({ format: VAULT_FORMAT, kdf: 'PBKDF2-SHA256', iterations: VAULT_ITERATIONS, salt: base64(salt), iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) });
  }
  async function save(value) {
    const raw = rawData(), record = raw ? parseData(raw) : null;
    if (vaultSession && vaultSession.snapshot !== raw) throw new Error('本机配置已在其他页面更改，请刷新后重新打开。');
    if (record?.format === VAULT_FORMAT) {
      if (!vaultSession) throw new Error('请先解锁本机加密。');
      const next = await seal(vaultSession.key, vaultSession.salt, value);
      if (rawData() !== raw) throw new Error('本机配置已在其他页面更改，请刷新后重新打开。');
      writeData(next);
      vaultSession = { ...vaultSession, snapshot: next, state: structuredClone(value) };
    } else {
      writeData(JSON.stringify(value));
    }
  }
  function enableVault(password) {
    return queueWrite(async () => {
      requireCrypto();
      if (typeof password !== 'string' || password.length < 8) throw new Error('解锁密码请至少填写 8 位。');
      if (vaultStatus().enabled) throw new Error('本机加密已经开启。');
      const state = data(), before = rawData();
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(password, salt), next = await seal(key, salt, state);
      if (rawData() !== before) throw new Error('本机配置已在其他页面更改，请刷新后重新打开。');
      writeData(next);
      vaultSession = { key, salt, snapshot: next, state: structuredClone(state) };
    });
  }
  function unlockVault(password) {
    return queueWrite(async () => {
      requireCrypto();
      const raw = rawData(), record = raw ? parseData(raw) : null;
      if (record?.format !== VAULT_FORMAT) throw new Error('本机没有开启加密。');
      let salt, iv, ciphertext;
      try {
        if (record.kdf !== 'PBKDF2-SHA256' || record.iterations !== VAULT_ITERATIONS) throw new Error();
        salt = unbase64(record.salt); iv = unbase64(record.iv); ciphertext = unbase64(record.ciphertext);
        if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error();
      } catch { throw new Error('本机加密数据格式不正确，请检查浏览器数据。'); }
      const key = await deriveKey(password, salt);
      let state;
      try {
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encode(VAULT_FORMAT) }, key, ciphertext);
        state = JSON.parse(decode(plaintext));
        if (!state || !Array.isArray(state.sites)) throw new Error();
      } catch { throw new Error('解锁密码不正确，或本机加密数据已损坏。'); }
      if (rawData() !== raw) throw new Error('本机配置已在其他页面更改，请刷新后重新打开。');
      vaultSession = { key, salt, snapshot: raw, state };
    });
  }
  function disableVault() {
    return queueWrite(async () => {
      const state = data(), before = rawData();
      if (!vaultSession || !vaultStatus().enabled) throw new Error('请先解锁本机加密。');
      if (rawData() !== before) throw new Error('本机配置已在其他页面更改，请刷新后重新打开。');
      writeData(JSON.stringify(state));
      vaultSession = null;
    });
  }
  function resetVault() {
    return queueWrite(async () => {
      if (!vaultStatus().enabled) throw new Error('本机没有开启加密。');
      try { localStorage.removeItem(CACHE); localStorage.removeItem(KEY); }
      catch { throw new Error('无法清除本机配置，请检查浏览器存储设置。'); }
      vaultSession = null;
    });
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
    return queueWrite(async () => {
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
      await save(state);
      removeCache(site.id);
      return publicSite(site);
    });
  }
  function remove(id) {
    return queueWrite(async () => {
      const state = data();
      const next = state.sites.filter((site) => site.id !== id);
      if (next.length === state.sites.length) throw new Error('站点不存在，请刷新页面。');
      state.sites = next;
      await save(state);
      removeCache(id);
    });
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
    return queueWrite(async () => {
      const state = data();
      const url = String(input.url || '').trim() ? httpsUrl(input.url, '转发服务地址') : '';
      const key = String(input.key || '').trim();
      if (url && !key) throw new Error('请填写转发服务口令。');
      state.proxy = { url, key: url ? key : '' };
      await save(state);
    });
  }
  async function remote(site, endpoint, authenticated, envelope = false) {
    const proxy = settings();
    const useLocalService = !proxy.url && (
      (location.protocol === 'http:' && location.hostname === '127.0.0.1') ||
      document.querySelector('meta[name="quota-pocket-service"]')?.content === 'same-origin'
    );
    let response;
    try {
      if (proxy.url) {
        response = await fetch(`${proxy.url}/query`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proxy-Key': proxy.key },
          body: JSON.stringify({ site: site.url, endpoint, userId: authenticated ? site.userId : '', token: authenticated ? site.token : '' }),
          credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
        });
      } else if (useLocalService) {
        response = await fetch('./api/local-query', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ site: site.url, endpoint, userId: authenticated ? site.userId : '', token: authenticated ? site.token : '' }),
          credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
        });
      } else {
        const headers = { Accept: 'application/json' };
        if (authenticated) { headers.Authorization = `Bearer ${site.token}`; headers['New-Api-User'] = site.userId; }
        response = await fetch(new URL(endpoint, site.url), { headers, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
      }
    } catch {
      if (useLocalService) throw new Error('查询服务没有响应，请稍后重试。');
      throw new Error(navigator.onLine ? '连接失败：请检查网络，或站点是否允许网页跨域访问。' : '当前离线，无法刷新。');
    }
    let result;
    try { result = await response.json(); } catch { result = null; }
    let reason = typeof result?.message === 'string' ? result.message :
      typeof result?.error === 'string' ? result.error :
      typeof result?.error?.message === 'string' ? result.error.message : '';
    for (const secret of [site.token, proxy.key]) {
      if (secret) reason = reason.split(secret).join('[已隐藏]');
    }
    reason = reason.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    const missingScope = reason.match(/^the access token lacks the required permission:\s*([a-z_]+:[a-z_]+)$/i);
    if (missingScope) {
      const scope = missingScope[1];
      const label = { 'profile:read': '资料读取', 'usage:read': '用量读取' }[scope];
      reason = `系统访问令牌缺少 ${scope}${label ? `（${label}）` : ''} 权限，请在站点的令牌设置中启用。`;
    } else if (/^unauthorized,\s*invalid access token$/i.test(reason)) {
      reason = '系统访问令牌无效，请核对是否属于这个站点、是否已失效。';
    }
    if (!response.ok) {
      if (reason) throw new Error(`${reason}（HTTP ${response.status}）`);
      if ((response.headers.get('content-type') || '').includes('text/html')) {
        throw new Error(`返回的是网页而不是接口数据（HTTP ${response.status}），可能触发了站点安全验证。`);
      }
      throw new Error(`查询返回 HTTP ${response.status}，站点没有提供具体原因。`);
    }
    if (!result) throw new Error('站点没有返回可识别的数据，可能需要先通过站点验证。');
    if (result.success !== true || !result.data || typeof result.data !== 'object') {
      throw new Error(reason ? `站点返回：${reason}` : '站点没有接受查询，也没有提供具体原因。');
    }
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
  async function usagePage(id, page, start, end) {
    const site = getSite(id);
    if (!site.userId || !site.token) throw new Error('请先连接站点。');
    const query = new URLSearchParams({ p: String(page), page_size: '100', type: '2', start_timestamp: String(start), end_timestamp: String(end) });
    return remote(site, `/api/log/self?${query}`, true);
  }
  async function usageUnit(id) {
    return displayUnit(await remote(getSite(id), '/api/status', false));
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
  async function performance(id) {
    const site = getSite(id), endpoint = '/api/perf-metrics/summary?hours=1';
    let result;
    try { result = await remote(site, endpoint, false); }
    catch (error) {
      if (!site.userId || !site.token) throw error;
      result = await remote(site, endpoint, true);
    }
    if (!Array.isArray(result.models)) throw new Error('站点没有提供模型状态。');
    return { ...result, checkedAt: Date.now() };
  }
  async function diagnose(id) {
    const site = getSite(id), configured = Boolean(site.userId && site.token);
    const required = (endpoint, verify) => async () => {
      if (!configured) throw new Error('请先填写用户 ID 和系统访问令牌。');
      const data = await remote(site, endpoint, true);
      if (!verify(data)) throw new Error('站点返回的数据格式不完整。');
      return '正常';
    };
    const now = new Date(), end = Math.floor(now.getTime() / 1000);
    const start = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
    const checks = [
      { label: '账户余额', run: required('/api/user/self', data => number(data.quota) !== null && number(data.used_quota) !== null) },
      { label: '用量统计', run: required(`/api/log/self/stat?type=2&start_timestamp=${start}&end_timestamp=${end}`, data => number(data.quota) !== null) },
      { label: '调用日志', run: required('/api/log/self?p=1&page_size=1&type=0', data => Array.isArray(data.items)) },
      { label: '模型价格', run: async () => (await pricing(id)).isPublic ? '公开报价可读取' : '账号报价可读取' },
    ];
    const results = await Promise.allSettled(checks.map(check => Promise.resolve().then(check.run)));
    return { items: results.map((result, index) => result.status === 'fulfilled'
      ? { label: checks[index].label, ok: true, message: result.value }
      : { label: checks[index].label, ok: false, message: result.reason?.message || '读取失败。' }) };
  }
  function favoriteValues(state) {
    return Array.isArray(state.favorites) ? state.favorites.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()) : [];
  }
  function favorites() { return favoriteValues(data()); }
  function toggleFavorite(value) {
    return queueWrite(async () => {
      const term = String(value || '').trim();
      if (!term) throw new Error('先输入想收藏的模型名称。');
      const state = data(), existing = favoriteValues(state);
      const matched = existing.some(item => item.toLocaleLowerCase() === term.toLocaleLowerCase());
      state.favorites = matched ? existing.filter(item => item.toLocaleLowerCase() !== term.toLocaleLowerCase()) : [...existing, term];
      await save(state);
      return !matched;
    });
  }
  function exportSites() {
    const state = data();
    return { version: 1, favorites: favoriteValues(state), sites: state.sites.map(({ name, url, userId, threshold, rechargeUrl, costPerUnit }) => ({ name, url, userId, threshold: threshold ?? null, rechargeUrl: rechargeUrl || '', costPerUnit: costPerUnit ?? null })) };
  }
  function importSites(value) {
    return queueWrite(async () => {
      if (!value || value.version !== 1 || !Array.isArray(value.sites)) throw new Error('配置文件格式不正确。');
      const state = data();
      let added = 0, skipped = 0, favoritesAdded = 0;
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
      const savedFavorites = favoriteValues(state);
      for (const item of Array.isArray(value.favorites) ? value.favorites : []) {
        if (typeof item !== 'string') continue;
        const term = item.trim();
        if (term && !savedFavorites.some(existing => existing.toLocaleLowerCase() === term.toLocaleLowerCase())) { savedFavorites.push(term); favoritesAdded++; }
      }
      state.favorites = savedFavorites;
      await save(state);
      return { added, skipped, favoritesAdded };
    });
  }
  window.ledger = {
    sites: () => data().sites.map(publicSite), upsert, remove, settings, saveSettings,
    refresh, logs, usagePage, usageUnit, diagnose, recharge, pricing, performance,
    favorites, toggleFavorite, cache, exportSites, importSites,
    vaultStatus, enableVault, unlockVault, disableVault, resetVault,
  };
})();
