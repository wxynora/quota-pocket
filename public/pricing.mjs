export function simpleExpression(expression) {
  if (typeof expression !== 'string') return null;
  const match = expression.trim().replace(/^v1:/, '').match(/^tier\(\s*"[^"\\]*"\s*,\s*(.+)\s*\)$/);
  if (!match) return null;
  const number = '(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
  const fixed = match[1].trim().match(new RegExp(`^fixed\\(\\s*(${number})\\s*\\)$`));
  if (fixed) return Number.isFinite(Number(fixed[1])) ? { type: 'call', call: Number(fixed[1]) } : null;
  const coefficients = {};
  for (const term of match[1].split('+')) {
    const part = term.trim().match(new RegExp(`^(p|c|cr|cc|cc1h|cc12h|img|ai|ao)\\s*\\*\\s*(${number})$`));
    if (!part || Object.hasOwn(coefficients, part[1])) return null;
    coefficients[part[1]] = Number(part[2]);
    if (!Number.isFinite(coefficients[part[1]])) return null;
  }
  if (!Object.hasOwn(coefficients, 'p') && !Object.hasOwn(coefficients, 'c')) return null;
  return { type: 'token', input: coefficients.p || 0, output: coefficients.c || 0 };
}
export function priceDetails(model, group, data) {
  const ratio = data.ratios[group], unit = data.unit, perUnit = Number(data.status?.quota_per_unit);
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || unit.note || !Number.isFinite(perUnit) || perUnit <= 0) return { reason: '价格信息不完整，请查看站点' };
  if (model.billing_mode === 'tiered_expr') {
    const expression = simpleExpression(model.billing_expr);
    if (!expression) return { reason: '条件或阶梯计费，需查看站点' };
    const factor = perUnit * ratio * unit.factor;
    if (expression.type === 'call') return { type: 'call', call: expression.call * factor };
    return { type: 'token', input: expression.input * factor, output: expression.output * factor };
  }
  if (model.billing_mode && model.billing_mode !== 'ratio') return { reason: '特殊计费，需查看站点' };
  if (model.quota_type === 0 && typeof model.model_ratio === 'number' && model.model_ratio >= 0 && typeof model.completion_ratio === 'number' && model.completion_ratio >= 0) {
    const input = model.model_ratio * ratio * 1_000_000 * unit.factor;
    return { type: 'token', input, output: input * model.completion_ratio };
  }
  if (model.quota_type === 1 && typeof model.model_price === 'number' && model.model_price >= 0) return { type: 'call', call: model.model_price * perUnit * ratio * unit.factor };
  return { reason: '价格信息不完整，请查看站点' };
}
export function compareQuote(model, group, data, site) {
  const price = priceDetails(model, group, data);
  if (!price.type) return price;
  const costPerUnit = site.costPerUnit == null || site.costPerUnit === '' ? 1 : site.costPerUnit;
  if (typeof costPerUnit !== 'number' || !Number.isFinite(costPerUnit) || costPerUnit <= 0) return { reason: '兑换比例不正确，请在站点设置中修改', original: price };
  if (price.type === 'token') {
    const input = price.input * costPerUnit, output = price.output * costPerUnit;
    if (Number.isFinite(input) && Number.isFinite(output)) return { type: 'token', input, output };
  }
  if (price.type === 'call') {
    const call = price.call * costPerUnit;
    if (Number.isFinite(call)) return { type: 'call', call };
  }
  return { reason: '站点价格信息不完整' };
}

export function rechargeRatio(paid, received) {
  if (!String(paid ?? '').trim() || !String(received ?? '').trim()) return null;
  const amount = Number(paid), units = Number(received), ratio = amount / units;
  return amount > 0 && units > 0 && Number.isFinite(ratio) && ratio > 0 ? Number(ratio.toPrecision(12)) : null;
}

export function modelStatus(modelName, metrics) {
  if (!Array.isArray(metrics?.models)) return { label: '状态未知', tone: 'unknown' };
  const item = metrics.models.find((entry) => entry?.model_name === modelName);
  if (!item) return { label: '近 1 小时无记录', tone: 'unknown' };
  const rate = item.success_rate;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100) return { label: '状态未知', tone: 'unknown' };
  const formatted = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(rate);
  return { label: `近 1 小时成功率 ${formatted}%`, tone: rate === 100 ? 'good' : rate === 0 ? 'bad' : 'mixed' };
}
