import { simpleExpression, priceDetails, compareQuote } from './pricing.mjs';
const $ = (selector) => document.querySelector(selector);
const list = $('#site-list'), template = $('#site-template'), dialog = $('#site-dialog'), form = $('#site-form');
const results = new Map(Object.entries(window.ledger.cache()));
const running = new Set(), versions = new Map();
let sites = [], logState = null, modelState = null;
let footerMessage = '连接站点后，就能在这里查看余额啦。';

const icons = [
  '<svg viewBox="0 0 48 48" fill="none"><path d="M24 5c1 10 4 14 14 18-10 3-13 7-14 19-2-12-5-16-15-19C19 19 22 15 24 5Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>',
  '<svg viewBox="0 0 48 48" fill="none"><path d="M24 38C17 32 8 26 8 18c0-8 10-12 16-4 6-8 16-4 16 4 0 8-9 14-16 20Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>',
  '<svg viewBox="0 0 48 48" fill="none"><path d="M24 11c4-10 14-3 10 4 10-4 15 7 5 10 8 7 1 15-7 10-1 11-13 11-15 1-9 5-15-5-7-11-10-3-5-14 5-10-4-8 6-14 9-4Z" stroke="currentColor" stroke-width="2.8" stroke-linejoin="round"/><circle cx="24" cy="24" r="3" fill="currentColor"/></svg>',
  '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="16" stroke="currentColor" stroke-width="3"/><path d="M18 20v2m12-2v2M17 28c3 5 10 6 14 0" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
];

function formatQuota(value, unit) {
  if (value === null || value === undefined || !unit) return '—';
  const amount = value * unit.factor;
  if (!Number.isFinite(amount)) return '—';
  const raw = unit.suffix === ' 额度';
  const digits = raw ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(amount) < 1 ? 10 : 6 };
  const formatted = !raw && amount !== 0 && Math.abs(amount) < 1e-10 ? amount.toExponential(4) : new Intl.NumberFormat('zh-CN', digits).format(amount);
  return `${unit.symbol}${formatted}${unit.suffix}`;
}
function low(site, result) {
  return site.threshold != null && result?.ok && !result.unit.note && result.remaining * result.unit.factor <= site.threshold;
}
function render() {
  const connected = sites.filter((site) => results.get(site.id)?.ok && !results.get(site.id)?.stale).length;
  $('#summary').textContent = `${sites.length} 个站点 · ${connected} 个已连接`;
  $('#refresh-all').disabled = running.size > 0;
  $('#refresh-all span').textContent = running.size ? '刷新中…' : '刷新全部';
  $('#footer-message').textContent = footerMessage;
  const term = $('#search').value.trim().toLocaleLowerCase(), filter = $('#filter').value;
  const shown = sites.filter((site) => {
    const result = results.get(site.id);
    return (!term || `${site.name} ${site.url}`.toLocaleLowerCase().includes(term)) && (filter === 'all' || (filter === 'low' && low(site, result)) || (filter === 'unconnected' && !site.configured));
  });
  $('#empty-list').hidden = shown.length > 0;
  $('#empty-list').textContent = sites.length ? '没有找到符合条件的站点。' : '这里还没有站点，点右上角添加一个吧。';
  list.replaceChildren();
  shown.forEach((site) => {
    const index = sites.findIndex((item) => item.id === site.id);
    const card = template.content.firstElementChild.cloneNode(true);
    card.classList.add(`tone-${index % 4}`);
    card.querySelector('.site-icon').innerHTML = icons[index % icons.length];
    card.querySelector('.site-name').textContent = site.name;
    const link = card.querySelector('.site-link');
    link.textContent = `↗ ${site.url.replace(/^https?:\/\//, '')}`; link.href = site.url;
    const state = card.querySelector('.site-state'), result = results.get(site.id);
    if (result?.ok) {
      for (const key of ['remaining', 'used', 'today', 'month']) card.querySelector(`[data-value="${key}"]`).textContent = formatQuota(result[key], result.unit);
      if (low(site, result)) card.classList.add('is-low');
      const stamp = new Date(result.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
      state.textContent = `${result.stale ? '上次结果' : '更新于'} ${stamp}${low(site, result) ? ' · 余额偏低' : ''}${result.unit.note ? ` · ${result.unit.note}` : ''}${result.today === null || result.month === null ? ' · 部分用量暂不可用' : ''}${result.error ? ` · ${result.error}` : ''}`;
      if (result.error) state.classList.add('error');
    } else if (result?.error) { state.textContent = result.error; state.classList.add('error'); }
    else if (site.configured) state.textContent = '等待刷新';
    if (running.has(site.id)) state.textContent = '正在刷新…';
    const action = card.querySelector('.site-action');
    action.textContent = site.configured ? '设置' : '连接';
    action.setAttribute('aria-label', `${site.configured ? '设置' : '连接'} ${site.name}`);
    action.addEventListener('click', () => editSite(site));
    const singleRefresh = card.querySelector('.mini-refresh');
    singleRefresh.setAttribute('aria-label', `刷新 ${site.name}`);
    singleRefresh.disabled = running.has(site.id);
    singleRefresh.addEventListener('click', () => site.configured ? refreshOne(site) : editSite(site));
    card.querySelector('.logs-action').addEventListener('click', () => openLogs(site));
    card.querySelector('.models-action').addEventListener('click', () => openModels(site));
    card.querySelector('.recharge-action').addEventListener('click', () => openRecharge(site));
    list.append(card);
  });
}
async function refreshOne(site) {
  const version = (versions.get(site.id) || 0) + 1; versions.set(site.id, version);
  running.add(site.id); render();
  try {
    const result = await window.ledger.refresh(site.id);
    if (versions.get(site.id) === version) {
      const prior = results.get(site.id);
      results.set(site.id, result.ok ? result : prior?.ok ? { ...prior, stale: true, error: result.error } : result);
    }
  } catch (error) {
    if (versions.get(site.id) === version) {
      const prior = results.get(site.id);
      results.set(site.id, prior?.ok ? { ...prior, stale: true, error: error.message } : { ok: false, error: error.message });
    }
  } finally { if (versions.get(site.id) === version) running.delete(site.id); render(); }
}
async function refreshAll() {
  const ready = sites.filter((site) => site.configured);
  if (!ready.length) { footerMessage = '先点站点旁边的「连接」，填好账号信息吧。'; render(); return; }
  footerMessage = '今日和本月用量按本机时间及站点日志统计。';
  await Promise.allSettled(ready.map(refreshOne));
}
function editSite(site = null) {
  form.reset();
  $('#site-id').value = site?.id || ''; $('#site-name').value = site?.name || ''; $('#site-url').value = site?.url || '';
  $('#user-id').value = site?.userId || ''; $('#threshold').value = site?.threshold ?? ''; $('#recharge-url').value = site?.rechargeUrl || ''; $('#cost-per-unit').value = site?.costPerUnit ?? '';
  $('#token').placeholder = site?.configured ? '已保存，留空则不修改' : '粘贴访问令牌';
  $('#dialog-title').textContent = site ? (site.configured ? '设置站点' : '连接站点') : '添加站点';
  $('#delete-site').hidden = !site; $('#form-error').hidden = true; $('#form-error').textContent = '';
  dialog.showModal();
  if (site && !site.configured) $('#user-id').focus(); else $('#site-name').focus();
}
$('#add-site').addEventListener('click', () => editSite());
$('#refresh-all').addEventListener('click', refreshAll);
$('#search').addEventListener('input', render); $('#filter').addEventListener('change', render);
$('#close-dialog').addEventListener('click', () => dialog.close()); $('#cancel-dialog').addEventListener('click', () => dialog.close());
form.addEventListener('submit', async (event) => {
  event.preventDefault(); const button = $('#save-site'); button.disabled = true; $('#form-error').hidden = true;
  try {
    const site = window.ledger.upsert({ id: $('#site-id').value || undefined, name: $('#site-name').value, url: $('#site-url').value, userId: $('#user-id').value, token: $('#token').value, threshold: $('#threshold').value, rechargeUrl: $('#recharge-url').value, costPerUnit: $('#cost-per-unit').value });
    const index = sites.findIndex((item) => item.id === site.id);
    if (index < 0) sites.push(site); else sites[index] = site;
    results.delete(site.id); dialog.close(); $('#token').value = '';
    footerMessage = '今日和本月用量按本机时间及站点日志统计。';
    if (site.configured) await refreshOne(site); else render();
  } catch (error) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
  finally { button.disabled = false; }
});
$('#delete-site').addEventListener('click', () => {
  const id = $('#site-id').value, site = sites.find((item) => item.id === id);
  if (!site || !confirm(`从额度口袋移除「${site.name}」？这只会删除本机保存的配置。`)) return;
  try {
    window.ledger.remove(id); versions.set(id, (versions.get(id) || 0) + 1); running.delete(id); results.delete(id);
    sites = sites.filter((item) => item.id !== id); dialog.close(); render();
  } catch (error) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
});
$('#open-settings').addEventListener('click', () => {
  const current = window.ledger.settings(); $('#proxy-url').value = current.url; $('#proxy-key').value = current.key;
  $('#settings-error').hidden = true; $('#settings-dialog').showModal();
});
$('#settings-close').addEventListener('click', () => $('#settings-dialog').close());
$('#settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try { window.ledger.saveSettings({ url: $('#proxy-url').value, key: $('#proxy-key').value }); $('#settings-dialog').close(); footerMessage = '设置已保存。'; render(); }
  catch (error) { $('#settings-error').textContent = error.message; $('#settings-error').hidden = false; }
});
$('#export-sites').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(window.ledger.exportSites(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'quota-pocket-sites.json'; link.click(); URL.revokeObjectURL(url);
  footerMessage = '已导出站点配置；不包含站点令牌或转发口令。'; render();
});
$('#import-sites').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (event) => {
  try {
    const file = event.target.files[0]; if (!file) return;
    const { added, skipped } = window.ledger.importSites(JSON.parse(await file.text()));
    sites = window.ledger.sites(); footerMessage = `已导入 ${added} 个站点，跳过 ${skipped} 个重复或无效项；请分别连接账号。`; render();
  } catch (error) { footerMessage = `导入失败：${error.message}`; render(); }
  finally { event.target.value = ''; }
});

async function openRecharge(site) {
  const popup = window.open('about:blank', '_blank');
  if (popup) popup.opener = null;
  try {
    const url = await window.ledger.recharge(site.id);
    if (!popup) throw new Error('浏览器拦截了新窗口，请允许弹出窗口后重试。');
    popup.location.replace(url);
  } catch (error) { if (popup) popup.close(); footerMessage = `${site.name}：${error.message}`; render(); }
}
function textEl(tag, text, className = '') {
  const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el;
}
function openLogs(site) {
  if (!site.configured) { editSite(site); return; }
  logState = { site, page: 1, type: 0, total: 0 };
  $('#logs-title').textContent = `${site.name} · 调用日志`; $('#log-type').value = '0';
  $('#logs-dialog').showModal(); loadLogs();
}
async function loadLogs() {
  if (!logState) return;
  const current = logState, page = current.page, type = current.type;
  $('#log-message').textContent = '正在读取日志…'; $('#log-list').replaceChildren(); $('#log-page').textContent = '';
  $('#log-prev').disabled = true; $('#log-next').disabled = true;
  try {
    const data = await window.ledger.logs(current.site.id, page, type);
    if (logState !== current || current.page !== page || current.type !== type) return;
    if (!Array.isArray(data.items)) throw new Error('站点没有返回可识别的日志列表。');
    current.total = typeof data.total === 'number' ? data.total : 0;
    $('#log-message').textContent = data.items.length ? '' : '没有找到记录。';
    const unit = results.get(current.site.id)?.unit || { factor: 1, symbol: '', suffix: ' 额度' };
    for (const item of data.items) {
      const row = document.createElement('article'); row.className = 'log-row';
      const head = document.createElement('div'); head.className = 'log-row-head';
      head.append(textEl('strong', item.model_name || ({ 1: '充值', 2: '消费', 4: '错误' }[item.type] || '记录')),
        textEl('span', item.created_at ? new Date(item.created_at * 1000).toLocaleString('zh-CN') : '时间未知'));
      const bits = [];
      if (item.type != null) bits.push(({ 1: '充值', 2: '消费', 3: '管理', 4: '错误', 5: '系统' }[item.type] || '记录'));
      if (item.token_name) bits.push(`令牌：${item.token_name}`);
      if (typeof item.prompt_tokens === 'number' || typeof item.completion_tokens === 'number') bits.push(`输入 ${item.prompt_tokens ?? '—'} / 输出 ${item.completion_tokens ?? '—'} tokens`);
      if (typeof item.quota === 'number') bits.push(`额度 ${formatQuota(item.quota, unit)}`);
      row.append(head, textEl('p', bits.join(' · ')));
      if (item.content) row.append(textEl('p', String(item.content), 'log-content'));
      $('#log-list').append(row);
    }
    $('#log-page').textContent = `第 ${page} 页${typeof data.total === 'number' ? ` · 共 ${data.total} 条` : ''}`;
    $('#log-prev').disabled = page <= 1; $('#log-next').disabled = typeof data.total === 'number' ? page * 20 >= data.total : data.items.length < 20;
  } catch (error) { if (logState === current) $('#log-message').textContent = error.message; }
}
$('#logs-close').addEventListener('click', () => { $('#logs-dialog').close(); logState = null; });
$('#log-prev').addEventListener('click', () => { if (logState?.page > 1) { logState.page--; loadLogs(); } });
$('#log-next').addEventListener('click', () => { if (logState) { logState.page++; loadLogs(); } });
$('#log-type').addEventListener('change', () => { if (logState) { logState.type = Number($('#log-type').value); logState.page = 1; loadLogs(); } });

async function openModels(site) {
  modelState = { site, data: null }; const current = modelState;
  $('#models-title').textContent = `${site.name} · 模型与价格`; $('#model-search').value = ''; $('#model-group').replaceChildren();
  $('#models-list').replaceChildren(); $('#models-message').textContent = '正在读取模型报价…'; $('#model-note').textContent = '';
  $('#models-dialog').showModal();
  try {
    current.data = await window.ledger.pricing(site.id);
    if (modelState !== current) return;
    let groups = Object.keys(current.data.groups);
    if (!groups.length) groups = Object.keys(current.data.ratios);
    if (!groups.length) groups = [...new Set(current.data.models.flatMap((m) => Array.isArray(m.enable_groups) ? m.enable_groups : []))];
    if (!groups.length) groups = [''];
    for (const group of groups) { const option = document.createElement('option'); option.value = group; option.textContent = group || '未提供分组'; $('#model-group').append(option); }
    $('#model-note').textContent = `${current.data.isPublic ? '当前为公开报价。' : '按账号可见分组展示。'}实际可用性、密钥限制和特殊计费以站点为准。`;
    renderModels();
  } catch (error) { if (modelState === current) $('#models-message').textContent = error.message; }
}
function modelPrice(model, group, data) {
  const price = priceDetails(model, group, data), unit = { ...data.unit, factor: 1 };
  if (price.type === 'token') return `输入 ${formatQuota(price.input, unit)} / 输出 ${formatQuota(price.output, unit)} · 每百万 tokens`;
  if (price.type === 'call') return `${formatQuota(price.call, unit)} / 次`;
  return price.reason;
}
function renderModels() {
  if (!modelState?.data) return;
  const data = modelState.data, group = $('#model-group').value, term = $('#model-search').value.trim().toLowerCase();
  const models = data.models.filter((m) => (!group || (Array.isArray(m.enable_groups) && m.enable_groups.includes(group))) && String(m.model_name || '').toLowerCase().includes(term));
  $('#models-message').textContent = models.length ? `${models.length} 个模型 · ${group || '未提供分组'}` : '没有找到模型。';
  $('#models-list').replaceChildren();
  for (const model of models) {
    const row = document.createElement('article'); row.className = 'model-row';
    row.append(textEl('strong', model.model_name || '未命名模型'), textEl('span', modelPrice(model, group, data)));
    $('#models-list').append(row);
  }
}
$('#models-close').addEventListener('click', () => { $('#models-dialog').close(); modelState = null; });
$('#model-search').addEventListener('input', renderModels); $('#model-group').addEventListener('change', renderModels);

function start() {
  try {
    sites = window.ledger.sites();
    for (const [id, result] of results) results.set(id, { ...result, stale: true });
    render();
    if (sites.some((site) => site.configured) && navigator.onLine) refreshAll();
    else if (!navigator.onLine) { footerMessage = '当前离线，显示上次保存的结果。'; render(); }
  } catch (error) { $('#summary').textContent = '额度口袋暂时打不开'; $('#footer-message').textContent = error.message; }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
}
start();

let compareState = null;
async function openCompare() {
  const state = { data: [], pending: sites.length, failed: [] }; compareState = state;
  $('#compare-search').value = ''; $('#compare-type').value = 'all'; $('#compare-sort').value = 'input';
  $('#compare-list').replaceChildren(); $('#compare-message').textContent = '正在读取各站模型报价…';
  $('#compare-dialog').showModal();
  await Promise.allSettled(sites.map(async (site) => {
    try {
      const data = await window.ledger.pricing(site.id);
      if (compareState === state) state.data.push({ site, data });
    } catch { if (compareState === state) state.failed.push(site.name); }
    finally { if (compareState === state) { state.pending--; renderCompare(); } }
  }));
  if (compareState === state) renderCompare();
}
function yuan(value) {
  if (value !== 0 && Math.abs(value) < 1e-10) return `¥${value.toExponential(4)}`;
  return `¥${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 10 }).format(value)}`;
}
function renderCompare() {
  if (!compareState) return;
  const state = compareState, term = $('#compare-search').value.trim().toLowerCase(), type = $('#compare-type').value, sort = $('#compare-sort').value;
  $('#compare-sort').disabled = type === 'call';
  const details = [];
  if (state.pending) details.push(`正在读取 ${state.pending} 个站点`);
  if (state.failed.length) details.push(`${state.failed.join('、')} 获取失败`);
  if (!term) details.push('输入模型名开始比价');
  const buckets = { token: [], call: [], unknown: [] };
  if (term) for (const { site, data } of state.data) {
    let groups = Object.keys(data.groups);
    if (!groups.length) groups = Object.keys(data.ratios);
    for (const model of data.models) {
      if (!String(model.model_name || '').toLowerCase().includes(term)) continue;
      const expression = model.billing_mode === 'tiered_expr' ? simpleExpression(model.billing_expr) : null;
      const category = expression?.type || (model.quota_type === 0 ? 'token' : model.quota_type === 1 ? 'call' : 'unknown');
      if (type !== 'all' && category !== type) continue;
      const enabled = Array.isArray(model.enable_groups) ? model.enable_groups : [];
      const available = groups.filter((group) => enabled.includes(group));
      if (!available.length) continue;
      for (const group of available) {
        const quote = compareQuote(model, group, data, site);
        const entry = { model: model.model_name, site: site.name, group, isPublic: data.isPublic, ...quote };
        buckets[quote.type || 'unknown'].push(entry);
      }
    }
  }
  buckets.token.sort((a, b) => a[sort] - b[sort] || a.site.localeCompare(b.site, 'zh-CN'));
  buckets.call.sort((a, b) => a.call - b.call || a.site.localeCompare(b.site, 'zh-CN'));
  if (term && !Object.values(buckets).some((items) => items.length) && !state.pending) details.push('没有找到可比较的模型');
  $('#compare-message').textContent = details.join(' · ');
  $('#compare-list').replaceChildren();
  const sections = [['token', '按量 · 每百万 tokens'], ['call', '按次'], ['unknown', '暂不参与排序']];
  for (const [key, title] of sections) {
    const items = buckets[key]; if (!items.length) continue;
    $('#compare-list').append(textEl('h3', title, 'compare-section-title'));
    for (const item of items) {
      const row = document.createElement('article'); row.className = 'model-row compare-row';
      const left = document.createElement('div');
      left.append(textEl('strong', item.model), textEl('p', `${item.site} · ${item.group}${item.isPublic ? ' · 公开报价' : ''}`));
      const price = item.type === 'token' ? `输入 ${yuan(item.input)} / 输出 ${yuan(item.output)}` : item.type === 'call' ? `${yuan(item.call)} / 次` : item.reason;
      row.append(left, textEl('span', price)); $('#compare-list').append(row);
    }
  }
}
$('#compare-open').addEventListener('click', openCompare);
$('#compare-close').addEventListener('click', () => { $('#compare-dialog').close(); compareState = null; });
$('#compare-search').addEventListener('input', renderCompare);
$('#compare-type').addEventListener('change', renderCompare); $('#compare-sort').addEventListener('change', renderCompare);
