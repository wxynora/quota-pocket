import { simpleExpression, priceDetails, compareQuote, modelStatus, rechargeRatio } from './pricing.mjs';
import { collectUsage, summarizeUsage } from './usage.mjs';
const $ = (selector) => document.querySelector(selector);
const list = $('#site-list'), template = $('#site-template'), dialog = $('#site-dialog'), form = $('#site-form');
const results = new Map(Object.entries(window.ledger.cache()));
const running = new Set(), versions = new Map();
let sites = [], logState = null, modelState = null;
let footerMessage = '';

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
  $('.footer').hidden = !footerMessage;
  renderFavorites();
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
    card.querySelector('.site-name-text').textContent = site.name;
    const link = card.querySelector('.site-link');
    link.href = site.url;
    const state = card.querySelector('.site-state'), result = results.get(site.id);
    if (result?.ok) {
      for (const key of ['remaining', 'used', 'today', 'month']) card.querySelector(`[data-value="${key}"]`).textContent = formatQuota(result[key], result.unit);
      if (low(site, result)) card.classList.add('is-low');
      const stamp = new Date(result.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
      state.textContent = `${result.stale ? '上次结果' : '更新于'} ${stamp}${low(site, result) ? ' · 余额偏低' : ''}${result.unit.note ? ` · ${result.unit.note}` : ''}${result.today === null || result.month === null ? ' · 部分用量暂不可用' : ''}${result.error ? ` · ${result.error}` : ''}`;
      if (result.error) state.classList.add('error');
    } else if (result?.error) { state.textContent = result.error; state.classList.add('error'); }
    else state.textContent = site.configured ? '等待刷新' : '还未连接';
    if (running.has(site.id)) state.textContent = '正在刷新…';
    const action = card.querySelector('.site-action');
    action.textContent = site.configured ? '设置' : '连接';
    action.setAttribute('aria-label', `${site.configured ? '设置' : '连接'} ${site.name}`);
    action.addEventListener('click', () => editSite(site));
    const singleRefresh = card.querySelector('.mini-refresh');
    singleRefresh.setAttribute('aria-label', `刷新 ${site.name}`);
    singleRefresh.disabled = running.has(site.id);
    singleRefresh.addEventListener('click', () => site.configured ? refreshOne(site) : editSite(site));
    card.querySelector('.diagnostic-action').addEventListener('click', () => openDiagnostic(site));
    card.querySelector('.logs-action').addEventListener('click', () => openLogs(site));
    card.querySelector('.models-action').addEventListener('click', () => openModels(site));
    card.querySelector('.recharge-action').addEventListener('click', () => openRecharge(site));
    const removeButton = card.querySelector('.site-delete');
    removeButton.setAttribute('aria-label', `删除 ${site.name}`);
    removeButton.addEventListener('click', () => removeSite(site));
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
  $('#storage-note').textContent = window.ledger.vaultStatus().enabled
    ? '站点配置已在此设备加密保存；导出配置不包含令牌。'
    : '令牌在此设备的浏览器中明文保存；可在首页开启本机加密。';
  $('#ratio-message').textContent = '填入两个数字，自动计算下方的比例。';
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
function updateRechargeRatio() {
  const paid = $('#recharge-paid').value, received = $('#recharge-received').value;
  if (!paid || !received) { $('#ratio-message').textContent = '填入两个数字，自动计算下方的比例。'; return; }
  const ratio = rechargeRatio(paid, received);
  if (ratio === null) { $('#ratio-message').textContent = '两个数字都需要大于 0。'; return; }
  $('#cost-per-unit').value = String(ratio);
  $('#ratio-message').textContent = `已计算：每 1 站内单位约 ¥${ratio}。`;
}
$('#recharge-paid').addEventListener('input', updateRechargeRatio);
$('#recharge-received').addEventListener('input', updateRechargeRatio);
form.addEventListener('submit', async (event) => {
  event.preventDefault(); const button = $('#save-site'); button.disabled = true; $('#form-error').hidden = true;
  try {
    const site = await window.ledger.upsert({ id: $('#site-id').value || undefined, name: $('#site-name').value, url: $('#site-url').value, userId: $('#user-id').value, token: $('#token').value, threshold: $('#threshold').value, rechargeUrl: $('#recharge-url').value, costPerUnit: $('#cost-per-unit').value });
    const index = sites.findIndex((item) => item.id === site.id);
    if (index < 0) sites.push(site); else sites[index] = site;
    results.delete(site.id); dialog.close(); $('#token').value = '';
    footerMessage = '今日和本月用量按本机时间及站点日志统计。';
    if (site.configured) await refreshOne(site); else render();
  } catch (error) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
  finally { button.disabled = false; }
});
async function removeSite(site) {
  if (!site || !confirm(`从额度口袋移除「${site.name}」？这只会删除本机保存的配置。`)) return;
  try {
    const id = site.id;
    await window.ledger.remove(id); versions.set(id, (versions.get(id) || 0) + 1); running.delete(id); results.delete(id);
    sites = sites.filter((item) => item.id !== id);
    if (dialog.open) dialog.close();
    render();
  } catch (error) {
    if (dialog.open) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
    else { footerMessage = error.message; render(); }
  }
}
$('#delete-site').addEventListener('click', () => removeSite(sites.find((item) => item.id === $('#site-id').value)));
$('#open-settings').addEventListener('click', () => {
  const current = window.ledger.settings(); $('#proxy-url').value = current.url; $('#proxy-key').value = current.key;
  $('#settings-error').hidden = true; $('#settings-dialog').showModal();
});
$('#settings-close').addEventListener('click', () => $('#settings-dialog').close());
$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await window.ledger.saveSettings({ url: $('#proxy-url').value, key: $('#proxy-key').value }); $('#settings-dialog').close(); footerMessage = '设置已保存。'; render(); }
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
    const { added, skipped, favoritesAdded } = await window.ledger.importSites(JSON.parse(await file.text()));
    sites = window.ledger.sites(); footerMessage = `已导入 ${added} 个站点、${favoritesAdded} 个常用模型，跳过 ${skipped} 个重复或无效站点；请分别连接账号。`; render();
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
function renderFavorites() {
  const terms = window.ledger.favorites(), section = $('#favorites-section'), list = $('#favorites-list');
  section.hidden = terms.length === 0;
  list.replaceChildren();
  for (const term of terms) {
    const chip = document.createElement('div'); chip.className = 'favorite-chip';
    const open = textEl('button', term); open.type = 'button'; open.addEventListener('click', () => openCompare(term));
    const remove = textEl('button', '×', 'favorite-remove'); remove.type = 'button';
    remove.setAttribute('aria-label', `取消收藏 ${term}`);
    remove.addEventListener('click', async () => {
      try { await window.ledger.toggleFavorite(term); renderFavorites(); }
      catch (error) { footerMessage = error.message; $('.footer').hidden = false; $('#footer-message').textContent = error.message; }
    });
    chip.append(open, remove); list.append(chip);
  }
}
let diagnosticState = null;
async function openDiagnostic(site) {
  const current = {}; diagnosticState = current;
  $('#diagnostic-title').textContent = `${site.name} · 连接自检`;
  $('#diagnostic-list').replaceChildren(textEl('p', '正在逐项检查…', 'log-message'));
  $('#diagnostic-dialog').showModal();
  try {
    const result = await window.ledger.diagnose(site.id);
    if (diagnosticState !== current) return;
    $('#diagnostic-list').replaceChildren();
    for (const item of result.items) {
      const row = document.createElement('div'); row.className = 'diagnostic-row';
      row.append(textEl('strong', item.label), textEl('span', `${item.ok ? '✓' : '！'} ${item.message}`, item.ok ? 'diagnostic-ok' : 'diagnostic-error'));
      $('#diagnostic-list').append(row);
    }
  } catch (error) { if (diagnosticState === current) $('#diagnostic-list').replaceChildren(textEl('p', error.message, 'form-error')); }
}
$('#diagnostic-close').addEventListener('click', () => { $('#diagnostic-dialog').close(); diagnosticState = null; });
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
      head.append(textEl('strong', item.model_name || ({ 1: '充值', 2: '消费', 4: '系统', 5: '错误', 6: '退款' }[item.type] || '记录')),
        textEl('span', item.created_at ? new Date(item.created_at * 1000).toLocaleString('zh-CN') : '时间未知'));
      const bits = [];
      if (item.type != null) bits.push(({ 1: '充值', 2: '消费', 3: '管理', 4: '系统', 5: '错误', 6: '退款' }[item.type] || '记录'));
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
  modelState = { site, data: null, performance: null, checking: true }; const current = modelState;
  $('#models-title').textContent = `${site.name} · 模型与价格`; $('#model-search').value = ''; $('#model-group').replaceChildren();
  $('#models-list').replaceChildren(); $('#models-message').textContent = '正在读取模型报价…'; $('#model-note').textContent = '';
  $('#models-dialog').showModal();
  window.ledger.performance(site.id).then((data) => { current.performance = data; }).catch(() => {}).finally(() => {
    current.checking = false;
    if (modelState === current) renderModels();
  });
  try {
    current.data = await window.ledger.pricing(site.id);
    if (modelState !== current) return;
    let groups = Object.keys(current.data.groups);
    if (!groups.length) groups = Object.keys(current.data.ratios);
    if (!groups.length) groups = [...new Set(current.data.models.flatMap((m) => Array.isArray(m.enable_groups) ? m.enable_groups : []))];
    if (!groups.length) groups = [''];
    for (const group of groups) { const option = document.createElement('option'); option.value = group; option.textContent = group || '未提供分组'; $('#model-group').append(option); }
    $('#model-note').textContent = `${current.data.isPublic ? '当前为公开报价。' : '按账号可见分组展示。'}成功率是站方近 1 小时的汇总，不是实时试调，分组与密钥权限可能不同。`;
    renderModels();
  } catch (error) { if (modelState === current) $('#models-message').textContent = error.message; }
}
function modelPrice(model, group, data) {
  const price = priceDetails(model, group, data), unit = { ...data.unit, factor: 1 };
  if (price.type === 'token') return `输入 ${formatQuota(price.input, unit)} / 输出 ${formatQuota(price.output, unit)} · 每百万 tokens`;
  if (price.type === 'call') return `${formatQuota(price.call, unit)} / 次`;
  return price.reason;
}
function statusBadge(name, metrics, checking = false) {
  const status = checking ? { label: '状态读取中…', tone: 'unknown' } : modelStatus(name, metrics);
  const when = Number.isFinite(metrics?.checkedAt) ? ` · ${new Date(metrics.checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} 查询` : '';
  const badge = textEl('span', status.label + when, `model-status status-${status.tone}`);
  badge.title = '站方近期成功率，非实时试调；不同分组和密钥的实际情况可能不同。';
  return badge;
}
function renderModels() {
  if (!modelState?.data) return;
  const data = modelState.data, group = $('#model-group').value, term = $('#model-search').value.trim().toLowerCase();
  const models = data.models.filter((m) => (!group || (Array.isArray(m.enable_groups) && m.enable_groups.includes(group))) && String(m.model_name || '').toLowerCase().includes(term));
  $('#models-message').textContent = models.length ? `${models.length} 个模型 · ${group || '未提供分组'}` : '没有找到模型。';
  $('#models-list').replaceChildren();
  for (const model of models) {
    const row = document.createElement('article'); row.className = 'model-row';
    const title = document.createElement('div');
    title.append(textEl('strong', model.model_name || '未命名模型'), statusBadge(model.model_name, modelState.performance, modelState.checking));
    row.append(title, textEl('span', modelPrice(model, group, data)));
    $('#models-list').append(row);
  }
}
$('#models-close').addEventListener('click', () => { $('#models-dialog').close(); modelState = null; });
$('#model-search').addEventListener('input', renderModels); $('#model-group').addEventListener('change', renderModels);

function vaultError(selector, error) {
  const target = $(selector); target.textContent = error.message; target.hidden = false;
}
let vaultProcessing = false;
function vaultBusy(busy) {
  vaultProcessing = busy;
  for (const id of ['#vault-enable', '#vault-disable', '#vault-close', '#vault-cancel']) $(id).disabled = busy;
}
$('#vault-open').addEventListener('click', () => {
  try {
    const enabled = window.ledger.vaultStatus().enabled;
    $('#vault-form').reset(); $('#vault-error').hidden = true;
    $('#vault-description').textContent = enabled ? '本机加密已开启。' : '加密是可选的，只在这台设备上生效。';
    $('#vault-enable-fields').hidden = enabled; $('#vault-enable').hidden = enabled; $('#vault-disable').hidden = !enabled;
    $('#vault-dialog').showModal();
  } catch (error) { footerMessage = error.message; $('#footer-message').textContent = error.message; $('.footer').hidden = false; }
});
$('#vault-close').addEventListener('click', () => $('#vault-dialog').close());
$('#vault-cancel').addEventListener('click', () => $('#vault-dialog').close());
$('#vault-dialog').addEventListener('cancel', event => { if (vaultProcessing) event.preventDefault(); });
$('#vault-dialog').addEventListener('close', () => $('#vault-form').reset());
$('#vault-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#vault-error').hidden = true;
  if ($('#vault-password').value !== $('#vault-confirm').value) { vaultError('#vault-error', new Error('两次输入的密码不一致。')); return; }
  vaultBusy(true);
  try {
    await window.ledger.enableVault($('#vault-password').value);
    $('#vault-dialog').close(); footerMessage = '本机加密已开启。'; render();
  } catch (error) { vaultError('#vault-error', error); }
  finally { vaultBusy(false); }
});
$('#vault-disable').addEventListener('click', async () => {
  if (!confirm('关闭后，站点令牌和转发口令会在本机浏览器中明文保存。确定关闭吗？')) return;
  $('#vault-error').hidden = true; vaultBusy(true);
  try { await window.ledger.disableVault(); $('#vault-dialog').close(); footerMessage = '本机加密已关闭。'; render(); }
  catch (error) { vaultError('#vault-error', error); }
  finally { vaultBusy(false); }
});
$('#unlock-dialog').addEventListener('cancel', event => event.preventDefault());
$('#unlock-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#unlock-error').hidden = true;
  $('#unlock-submit').disabled = true; $('#vault-reset').disabled = true;
  try {
    await window.ledger.unlockVault($('#unlock-password').value);
    $('#unlock-password').value = ''; $('#unlock-dialog').close(); start();
  } catch (error) { vaultError('#unlock-error', error); }
  finally { $('#unlock-submit').disabled = false; $('#vault-reset').disabled = false; }
});
$('#vault-reset').addEventListener('click', async () => {
  if (!confirm('忘记密码无法恢复加密配置。确定清除此设备上的额度口袋站点、令牌、收藏和余额快照，重新开始吗？')) return;
  $('#unlock-error').hidden = true; $('#unlock-submit').disabled = true; $('#vault-reset').disabled = true;
  try {
    await window.ledger.resetVault(); results.clear(); $('#unlock-password').value = ''; $('#unlock-dialog').close(); start();
    footerMessage = '已清除此设备的额度口袋配置，请重新连接站点。'; render();
  } catch (error) { vaultError('#unlock-error', error); }
  finally { $('#unlock-submit').disabled = false; $('#vault-reset').disabled = false; }
});
window.addEventListener('storage', event => {
  if (event.key !== 'quota-pocket-v1') return;
  $('#summary').textContent = '本机配置已在其他页面更改，请刷新';
  footerMessage = '本机配置已在其他页面更改，请刷新后继续使用。';
  $('#footer-message').textContent = footerMessage; $('.footer').hidden = false;
});

function start() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  try {
    const vault = window.ledger.vaultStatus();
    if (vault.enabled && !vault.unlocked) { $('#unlock-dialog').showModal(); return; }
    sites = window.ledger.sites();
    for (const [id, result] of results) results.set(id, { ...result, stale: true });
    render();
    if (sites.some((site) => site.configured) && navigator.onLine) refreshAll();
    else if (!navigator.onLine) { footerMessage = '当前离线，显示上次保存的结果。'; render(); }
  } catch (error) { $('#summary').textContent = '额度口袋暂时打不开'; $('#footer-message').textContent = error.message; $('.footer').hidden = false; }
}
start();

let compareState = null;
async function openCompare(initialTerm = '') {
  const state = { data: [], pending: sites.length, failed: [], performance: new Map() }; compareState = state;
  $('#compare-search').value = initialTerm; $('#compare-type').value = 'all'; $('#compare-sort').value = 'input';
  $('#compare-list').replaceChildren(); $('#compare-message').textContent = '正在读取各站模型报价…';
  $('#compare-dialog').showModal();
  updateFavoriteButton();
  const performanceJobs = sites.map(async (site) => {
    state.performance.set(site.id, { checking: true, data: null });
    try { state.performance.set(site.id, { checking: false, data: await window.ledger.performance(site.id) }); }
    catch { state.performance.set(site.id, { checking: false, data: null }); }
    finally { if (compareState === state) renderCompare(); }
  });
  const pricingJobs = sites.map(async (site) => {
    try {
      const data = await window.ledger.pricing(site.id);
      if (compareState === state) state.data.push({ site, data });
    } catch { if (compareState === state) state.failed.push(site.name); }
    finally { if (compareState === state) { state.pending--; renderCompare(); } }
  });
  await Promise.allSettled([...performanceJobs, ...pricingJobs]);
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
        const entry = { model: model.model_name, site: site.name, siteId: site.id, group, isPublic: data.isPublic, unit: data.unit, ...quote };
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
      const performance = state.performance.get(item.siteId);
      left.append(statusBadge(item.model, performance?.data, performance?.checking));
      let price = item.type === 'token' ? `输入 ${yuan(item.input)} / 输出 ${yuan(item.output)}` : item.type === 'call' ? `${yuan(item.call)} / 次` : item.reason;
      if (item.original) {
        const unit = { ...item.unit, factor: 1 };
        const original = item.original.type === 'token'
          ? `输入 ${formatQuota(item.original.input, unit)} / 输出 ${formatQuota(item.original.output, unit)} · 每百万 tokens`
          : `${formatQuota(item.original.call, unit)} / 次`;
        price = `站点标价 ${original}；${item.reason}`;
      }
      row.append(left, textEl('span', price)); $('#compare-list').append(row);
    }
  }
}
function updateFavoriteButton() {
  const term = $('#compare-search').value.trim(), button = $('#favorite-model');
  const saved = term && window.ledger.favorites().some(value => value.toLocaleLowerCase() === term.toLocaleLowerCase());
  button.disabled = !term; button.textContent = saved ? '★ 已收藏' : '☆ 收藏';
  button.setAttribute('aria-pressed', saved ? 'true' : 'false');
}
$('#compare-open').addEventListener('click', () => openCompare());
$('#favorite-model').addEventListener('click', async () => {
  try { await window.ledger.toggleFavorite($('#compare-search').value); updateFavoriteButton(); renderFavorites(); }
  catch (error) { $('#compare-message').textContent = error.message; }
});
$('#compare-close').addEventListener('click', () => { $('#compare-dialog').close(); compareState = null; });
$('#compare-search').addEventListener('input', () => { updateFavoriteButton(); renderCompare(); });
$('#compare-type').addEventListener('change', renderCompare); $('#compare-sort').addEventListener('change', renderCompare);

let billState = null;
function dateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function localDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number), date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}
function openBill() {
  const end = new Date(), start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
  $('#bill-start').value = dateInput(start); $('#bill-end').value = dateInput(end); $('#bill-model-filter').value = '';
  const select = $('#bill-site'); select.replaceChildren();
  const all = document.createElement('option'); all.value = 'all'; all.textContent = '全部已连接站点'; select.append(all);
  for (const site of sites.filter(item => item.configured)) {
    const option = document.createElement('option'); option.value = site.id; option.textContent = site.name; select.append(option);
  }
  $('#bill-message').textContent = '选择日期后，点“查询账单”。'; $('#bill-results').hidden = true;
  $('#bill-load').disabled = false; billState = null; $('#bill-dialog').showModal();
}
function setBillMessage(state) {
  const waiting = [...state.progress.values()].filter(value => !value.done).length;
  const scanned = [...state.progress.values()].reduce((sum, value) => sum + value.scanned, 0);
  const errors = state.entries.filter(entry => !entry.complete).map(entry => `${entry.site.name}：${entry.error || '记录不完整'}`);
  const parts = [];
  if (waiting) parts.push(`正在读取 ${waiting} 个站点，已检查 ${scanned} 条日志；关闭页面可停止`);
  else parts.push(`已读取 ${scanned} 条日志`);
  if (state.unconnected) parts.push(`${state.unconnected} 个站点未连接，未计入`);
  if (errors.length) parts.push(errors.join('；'));
  $('#bill-message').textContent = parts.join(' · ');
}
function billRows(container, title, rows, bars = false) {
  container.replaceChildren();
  if (!rows.length) return;
  container.append(textEl('h3', title));
  const max = bars ? Math.max(0, ...rows.map(row => row.amount)) : 0;
  for (const row of rows) {
    const wrapper = document.createElement('div'), line = document.createElement('div'); line.className = 'bill-row';
    line.append(textEl('span', row.name), textEl('strong', yuan(row.amount)));
    wrapper.append(line);
    if (bars && max > 0) {
      const bar = document.createElement('div'), fill = document.createElement('span'); bar.className = 'bill-bar';
      fill.style.width = `${Math.max(0, Math.min(100, row.amount / max * 100))}%`; bar.append(fill); wrapper.append(bar);
    }
    container.append(wrapper);
  }
}
function renderBill() {
  if (!billState) return;
  const report = summarizeUsage(billState.entries, $('#bill-model-filter').value);
  const incomplete = report.partial || billState.unconnected > 0 || [...billState.progress.values()].some(item => !item.done);
  $('#bill-results').hidden = !billState.entries.length;
  $('#bill-total').textContent = report.total === null ? '暂无法换算' : yuan(report.total);
  $('#bill-total-note').textContent = `${report.count} 条消费记录${incomplete ? ' · 部分站点未计入或记录不完整' : ''}`;
  const siteBox = $('#bill-sites'); siteBox.replaceChildren();
  if (report.sites.length) siteBox.append(textEl('h3', '按站点'));
  for (const item of report.sites) {
    const row = document.createElement('div'); row.className = 'bill-row';
    const label = `${item.name}${item.complete ? '' : ' · 未完整'}`;
    row.append(textEl('span', label), textEl('strong', item.amount === null ? '单位未知' : yuan(item.amount)));
    siteBox.append(row);
  }
  billRows($('#bill-days'), '按日期 · 仅显示有消费的日期', report.days, true);
  billRows($('#bill-models'), '按模型', report.models);
  setBillMessage(billState);
}
async function loadBill() {
  const start = localDate($('#bill-start').value), end = localDate($('#bill-end').value);
  if (!start || !end || start > end) { $('#bill-message').textContent = '请选择正确的开始和结束日期。'; return; }
  const startTime = Math.floor(start.getTime() / 1000);
  end.setDate(end.getDate() + 1);
  const endTime = Math.min(Math.floor(end.getTime() / 1000) - 1, Math.floor(Date.now() / 1000));
  if (startTime > endTime) { $('#bill-message').textContent = '开始日期不能晚于今天。'; return; }
  const selectedId = $('#bill-site').value;
  const selected = sites.filter(site => site.configured && (selectedId === 'all' || selectedId === site.id));
  if (!selected.length) { $('#bill-message').textContent = '请先连接至少一个站点。'; $('#bill-results').hidden = true; return; }
  if (billState) billState.cancelled = true;
  const state = { entries: [], progress: new Map(selected.map(site => [site.id, { scanned: 0, done: false }])), cancelled: false, unconnected: selectedId === 'all' ? sites.filter(site => !site.configured).length : 0 };
  billState = state; $('#bill-load').disabled = true; $('#bill-results').hidden = true; setBillMessage(state);
  await Promise.allSettled(selected.map(async site => {
    const active = () => billState === state && !state.cancelled;
    const [unitResult, collected] = await Promise.all([
      window.ledger.usageUnit(site.id).catch(() => ({ factor: 1, symbol: '', suffix: ' 额度', note: '站点单位未知' })),
      collectUsage(page => window.ledger.usagePage(site.id, page, startTime, endTime), {
        start: startTime, end: endTime, isActive: active,
        onProgress: progress => { if (active()) { state.progress.set(site.id, { scanned: progress.scanned, done: false }); setBillMessage(state); } },
      }),
    ]);
    if (!active()) return;
    state.progress.set(site.id, { scanned: collected.scanned, done: true });
    state.entries.push({ site, unit: unitResult, ...collected });
    renderBill();
  }));
  if (billState === state && !state.cancelled) { $('#bill-load').disabled = false; renderBill(); }
}
$('#bill-open').addEventListener('click', openBill);
$('#bill-load').addEventListener('click', loadBill);
$('#bill-model-filter').addEventListener('input', renderBill);
$('#bill-dialog').addEventListener('close', () => { if (billState) billState.cancelled = true; billState = null; });
$('#bill-close').addEventListener('click', () => $('#bill-dialog').close());
