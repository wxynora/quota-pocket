import test from 'node:test';
import assert from 'node:assert/strict';
import { modelStatus } from '../public/pricing.mjs';
import { createServer } from '../server.mjs';
import http from 'node:http';
import { once } from 'node:events';

test('model status reports only the site’s recent rate and keeps missing or invalid data unknown', () => {
  const metrics = { models: [
    { model_name: 'ok', success_rate: 100 },
    { model_name: 'mixed', success_rate: 71.25 },
    { model_name: 'bad', success_rate: 0 },
    { model_name: 'invalid', success_rate: -1 },
  ] };
  assert.deepEqual(modelStatus('ok', metrics), { label: '近 1 小时成功率 100%', tone: 'good' });
  assert.deepEqual(modelStatus('mixed', metrics), { label: '近 1 小时成功率 71.25%', tone: 'mixed' });
  assert.deepEqual(modelStatus('bad', metrics), { label: '近 1 小时成功率 0%', tone: 'bad' });
  assert.deepEqual(modelStatus('invalid', metrics), { label: '状态未知', tone: 'unknown' });
  assert.deepEqual(modelStatus('missing', metrics), { label: '近 1 小时无记录', tone: 'unknown' });
  assert.deepEqual(modelStatus('ok', null), { label: '状态未知', tone: 'unknown' });
});

test('local service forwards model performance as a read-only request', async () => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    seen.push({ method: req.method, path: req.url, authorization: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { models: [{ model_name: 'demo', success_rate: 100 }] } }));
  });
  const app = createServer();
  upstream.listen(0, '127.0.0.1'); app.listen(0, '127.0.0.1');
  await Promise.all([once(upstream, 'listening'), once(app, 'listening')]);
  const appUrl = `http://127.0.0.1:${app.address().port}`;
  try {
    const response = await fetch(`${appUrl}/api/local-query`, {
      method: 'POST', headers: { Origin: appUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: `http://127.0.0.1:${upstream.address().port}`, endpoint: '/api/perf-metrics/summary?hours=1' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.models[0].success_rate, 100);
    assert.deepEqual(seen, [{ method: 'GET', path: '/api/perf-metrics/summary?hours=1', authorization: undefined }]);
  } finally {
    await Promise.all([new Promise(resolve => upstream.close(resolve)), new Promise(resolve => app.close(resolve))]);
  }
});

test('performance uses the public endpoint without forwarding the saved site token', async () => {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const requests = [], storage = new Map();
  const context = {
    window: {}, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID: () => 'site-id' }, structuredClone, URL, URLSearchParams, AbortSignal,
    location: { protocol: 'https:', hostname: 'pocket.example' },
    document: { querySelector: () => ({ content: 'same-origin' }) }, navigator: { onLine: true },
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return Response.json({ success: true, data: { models: [{ model_name: 'demo', success_rate: 100 }] } });
    },
  };
  vm.runInNewContext(await readFile(new URL('../public/local.js', import.meta.url), 'utf8'), context);
  const ledger = context.window.ledger;
  await ledger.upsert({ name: '测试', url: 'https://site.example', userId: '1', token: 'fixture-token' });
  const result = await ledger.performance('site-id');
  assert.equal(result.models[0].success_rate, 100);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint, '/api/perf-metrics/summary?hours=1');
  assert.equal(requests[0].userId, '');
  assert.equal(requests[0].token, '');
});
