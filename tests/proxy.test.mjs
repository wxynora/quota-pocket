import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../proxy/worker.mjs';

const env = { ALLOWED_APP_ORIGIN: 'https://app.example', ALLOWED_SITE_ORIGINS: 'https://site.example', PROXY_KEY: 'test-only-key' };
const request = (origin, site, endpoint, key = 'test-only-key') => new Request('https://proxy.example/query', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Proxy-Key': key },
  body: JSON.stringify({ site, endpoint, userId: '3', token: 'test-only-token' }),
});

test('只向指定站点发送只读查询，拒绝越权及重定向', async () => {
  const original = globalThis.fetch;
  let seen;
  try {
    globalThis.fetch = async (url, options) => { seen = { url: String(url), options }; return Response.json({ success: true, data: { quota: 10 } }); };
    let response = await worker.fetch(request('https://app.example', 'https://site.example', '/api/user/self'), env);
    assert.equal(response.status, 200); assert.equal(seen.url, 'https://site.example/api/user/self');
    assert.equal(seen.options.headers.Authorization, 'Bearer test-only-token'); assert.equal(seen.options.headers['New-Api-User'], '3');
    assert.equal(seen.options.redirect, 'manual');
    assert.equal((await worker.fetch(request('https://other.example', 'https://site.example', '/api/user/self'), env)).status, 403);
    assert.equal((await worker.fetch(request('https://app.example', 'https://other.example', '/api/user/self'), env)).status, 403);
    assert.equal((await worker.fetch(request('https://app.example', 'https://site.example', '/api/user/delete'), env)).status, 403);
    assert.equal((await worker.fetch(request('https://app.example', 'https://site.example', '/api/user/self', 'wrong'), env)).status, 403);
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: 'https://other.example' } });
    response = await worker.fetch(request('https://app.example', 'https://site.example', '/api/user/self'), env); assert.equal(response.status, 502);
  } finally { globalThis.fetch = original; }
});

test('转发站方模型成功率的只读接口', async () => {
  const original = globalThis.fetch;
  let seen;
  try {
    globalThis.fetch = async (url, options) => { seen = { url: String(url), method: options.method }; return Response.json({ success: true, data: { models: [] } }); };
    const response = await worker.fetch(request('https://app.example', 'https://site.example', '/api/perf-metrics/summary?hours=1'), env);
    assert.equal(response.status, 200);
    assert.deepEqual(seen, { url: 'https://site.example/api/perf-metrics/summary?hours=1', method: 'GET' });
  } finally { globalThis.fetch = original; }
});
