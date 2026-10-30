import test from 'node:test';
import assert from 'node:assert/strict';
import { simpleExpression, priceDetails, compareQuote } from '../public/pricing.mjs';

const data = { ratios: { vip: 2 }, unit: { factor: 7 / 500000, symbol: '¥', suffix: '', note: '' }, status: { quota_per_unit: 500000 } };

test('按站点倍率、分组、输出倍率和充值兑换比例换算', () => {
  const model = { quota_type: 0, model_ratio: 0.5, completion_ratio: 4 };
  assert.deepEqual(priceDetails(model, 'vip', data), { type: 'token', input: 14, output: 56 });
  assert.deepEqual(compareQuote(model, 'vip', data, { costPerUnit: 0.5 }), { type: 'token', input: 7, output: 28 });
  assert.match(compareQuote(model, 'vip', data, {}).reason, /兑换比例/);
});

test('识别 New API 的简单表达式，并保留分组与站点单位', () => {
  const token = { billing_mode: 'tiered_expr', billing_expr: 'tier("base", p * 10 + c * 50 + cr * 1 + cc * 12.5)' };
  assert.deepEqual(priceDetails(token, 'vip', data), { type: 'token', input: 140, output: 700 });
  const fixed = { billing_mode: 'tiered_expr', billing_expr: 'tier("request", fixed(0.04))' };
  const price = priceDetails(fixed, 'vip', data);
  assert.equal(price.type, 'call'); assert.ok(Math.abs(price.call - 0.56) < 1e-12);
});

test('条件表达式、额外倍率和缺失分组不会被猜成普通价格', () => {
  assert.equal(simpleExpression('tier("base", p * 2) * 3'), null);
  assert.equal(simpleExpression('len < 32000 ? tier("base", p * 2) : tier("other", p * 4)'), null);
  assert.ok(priceDetails({ quota_type: 0, model_ratio: 1, completion_ratio: 1 }, 'missing', data).reason);
  assert.ok(priceDetails({ billing_mode: 'tiered_expr', billing_expr: 'tier("base", fixed(1e999))' }, 'vip', data).reason);
});
