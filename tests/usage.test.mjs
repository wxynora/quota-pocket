import test from 'node:test';
import assert from 'node:assert/strict';
import { collectUsage, summarizeUsage } from '../public/usage.mjs';

const start = Math.floor(new Date(2026, 9, 30, 0, 0, 0).getTime() / 1000);
const end = Math.floor(new Date(2026, 10, 1, 0, 0, 0).getTime() / 1000) - 1;
const row = (day, model, quota, type = 2) => ({ type, model_name: model, quota, created_at: Math.floor(new Date(2026, 9, day, 12).getTime() / 1000) });

test('paginates and groups real consumption by day and model, then converts each site with its own ratio', async () => {
  const pages = [
    { page: 1, page_size: 2, total: 4, items: [row(30, 'model-a', 100), row(30, 'model-b', 50)] },
    { page: 2, page_size: 2, total: 4, items: [row(31, 'model-a', 200), row(31, 'ignored-error', 100, 5)] },
    { page: 3, page_size: 2, total: 4, items: [] },
  ];
  const requested = [];
  const collected = await collectUsage(async p => { requested.push(p); return pages[p - 1]; }, { start, end });
  assert.deepEqual(requested, [1, 2, 3]);
  assert.equal(collected.complete, true);
  assert.equal(collected.accepted, 3);
  const report = summarizeUsage([{ site: { id: 'a', name: 'A', costPerUnit: 0.5 }, unit: { factor: 0.01, note: '' }, ...collected }], 'model-a');
  assert.equal(report.total, 1.5);
  assert.deepEqual(report.days.map(x => [x.name, x.amount]), [['2026-10-30', 0.5], ['2026-10-31', 1]]);
  assert.deepEqual(report.models.map(x => [x.name, x.amount]), [['model-a', 1.5]]);
});

test('partial failure and unknown units are not presented as complete totals', async () => {
  const result = await collectUsage(async page => {
    if (page === 1) return { page: 1, page_size: 1, total: 2, items: [row(30, 'model-a', 100)] };
    throw Error('站点读取失败');
  }, { start, end });
  assert.equal(result.complete, false);
  assert.match(result.error, /站点读取失败/);
  const report = summarizeUsage([{ site: { id: 'a', name: 'A' }, unit: { note: '未知单位', factor: 1 }, ...result }]);
  assert.equal(report.partial, true);
  assert.equal(report.sites[0].amount, null);
  assert.equal(report.total, null);
});

test('repeated pages stop rather than silently double-count', async () => {
  const item = row(30, 'model-a', 100);
  const result = await collectUsage(async () => ({ page_size: 1, total: 50, items: [item] }), { start, end });
  assert.equal(result.complete, false);
  assert.equal(result.accepted, 1);
  assert.match(result.error, /重复/);
});
