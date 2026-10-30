function localDay(timestamp) {
  const date = new Date(timestamp * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Only per-day/model totals are retained; individual log records stay in memory for a single page.
export async function collectUsage(fetchPage, { start, end, isActive = () => true, onProgress = () => {} }) {
  const groups = new Map();
  let page = 1, scanned = 0, accepted = 0, invalid = 0, previous = null;
  const result = (complete, error = '') => ({ groups: [...groups.values()], scanned, accepted, invalid, complete, error });
  while (isActive()) {
    let response;
    try { response = await fetchPage(page); }
    catch (error) { return result(false, error?.message || '读取失败。'); }
    if (!isActive()) return result(false, '已取消。');
    if (!Array.isArray(response?.items)) return result(false, '站点没有返回可识别的日志列表。');
    if (Number.isInteger(response.page) && response.page > 0 && response.page !== page) return result(false, '站点返回的日志页码不正确。');
    const items = response.items;
    const total = Number.isInteger(response.total) && response.total >= 0 ? response.total : null;
    if (!items.length) return total !== null && scanned < total ? result(false, '站点提前结束分页，账单可能不完整。') : result(invalid === 0, invalid ? `${invalid} 条记录缺少金额或时间。` : '');
    const fingerprint = JSON.stringify(items.map(item => [item?.id, item?.created_at, item?.model_name, item?.quota, item?.type]));
    if (previous === fingerprint) return result(false, '站点重复返回同一页，账单可能不完整。');
    previous = fingerprint;
    scanned += items.length;
    for (const item of items) {
      if (item?.type !== 2) continue;
      if (typeof item.created_at !== 'number' || !Number.isFinite(item.created_at) || typeof item.quota !== 'number' || !Number.isFinite(item.quota)) { invalid++; continue; }
      if (item.created_at < start || item.created_at > end) continue;
      const day = localDay(item.created_at);
      if (!day) { invalid++; continue; }
      const model = typeof item.model_name === 'string' && item.model_name.trim() ? item.model_name.trim() : '未标明模型';
      const key = JSON.stringify([day, model]);
      const entry = groups.get(key) || { day, model, quota: 0, count: 0 };
      entry.quota += item.quota; entry.count++;
      groups.set(key, entry); accepted++;
    }
    onProgress({ page, scanned, total });
    const pageSize = Number.isInteger(response.page_size) && response.page_size > 0 ? response.page_size : null;
    if (pageSize && items.length < pageSize && (total === null || scanned >= total)) return result(invalid === 0, invalid ? `${invalid} 条记录缺少金额或时间。` : '');
    page++;
  }
  return result(false, '已取消。');
}

export function summarizeUsage(entries, modelFilter = '') {
  const filter = modelFilter.trim().toLocaleLowerCase();
  const days = new Map(), models = new Map(), sites = [];
  let total = 0, convertible = 0, partial = false, count = 0;
  for (const entry of entries) {
    const relevant = (entry.groups || []).filter(group => !filter || group.model.toLocaleLowerCase().includes(filter));
    const quota = relevant.reduce((sum, group) => sum + group.quota, 0);
    const itemCount = relevant.reduce((sum, group) => sum + group.count, 0);
    const factor = entry.unit?.factor, ratio = entry.site.costPerUnit == null || entry.site.costPerUnit === '' ? 1 : entry.site.costPerUnit;
    const usable = !entry.unit?.note && typeof factor === 'number' && Number.isFinite(factor) && factor > 0 && typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 && Number.isFinite(quota * factor * ratio);
    const amount = usable ? quota * factor * ratio : null;
    sites.push({ name: entry.site.name, amount, count: itemCount, complete: entry.complete, error: entry.error || '', unitNote: entry.unit?.note || '' });
    count += itemCount;
    if (!entry.complete || !usable) partial = true;
    if (!usable) continue;
    convertible++; total += amount;
    for (const group of relevant) {
      const value = group.quota * factor * ratio;
      days.set(group.day, (days.get(group.day) || 0) + value);
      models.set(group.model, (models.get(group.model) || 0) + value);
    }
  }
  const asRows = map => [...map.entries()].map(([name, amount]) => ({ name, amount }));
  return {
    total: convertible ? total : null, count, partial, sites,
    days: asRows(days).sort((a, b) => a.name.localeCompare(b.name)),
    models: asRows(models).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
  };
}
