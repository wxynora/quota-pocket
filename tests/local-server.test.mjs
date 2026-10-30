import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createServer } from '../server.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

test('本机网页通过只读服务查询站点，跨站请求与重定向被拒绝', async () => {
  const seen = [];
  const site = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization, user: req.headers['new-api-user'] });
    if (req.url === '/api/status') { res.writeHead(302, { Location: '/other' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { quota: 1000000, used_quota: 500000 } }));
  });
  const server = createServer();
  const siteUrl = await listen(site), base = await listen(server);
  const query = (body, origin = base) => fetch(`${base}/api/local-query`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /name="quota-pocket-service" content="same-origin"/);
    const body = { site: siteUrl, endpoint: '/api/user/self', userId: '42', token: 'test-only-token' };
    let response = await query(body);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.quota, 1000000);
    assert.deepEqual(seen[0], { url: '/api/user/self', auth: 'Bearer test-only-token', user: '42' });
    response = await query(body, 'https://other.example'); assert.equal(response.status, 403);
    response = await query({ ...body, endpoint: '/api/user/delete' }); assert.equal(response.status, 400);
    response = await query({ ...body, endpoint: '//other.example/api/user/self' }); assert.equal(response.status, 400);
    response = await query({ ...body, endpoint: '/api/status' }); assert.equal(response.status, 502);
    assert.equal(seen.length, 2);
  } finally {
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => site.close(resolve))]);
  }
});

test('HTTPS 反向代理部署时，只接受配置的网站来源', async () => {
  const site = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { quota: 1 } }));
  });
  const server = createServer({ publicOrigin: 'https://pocket.example' });
  const siteUrl = await listen(site), base = await listen(server);
  const body = JSON.stringify({ site: siteUrl, endpoint: '/api/user/self', userId: '42', token: 'test-only-token' });
  try {
    const ok = await fetch(`${base}/api/local-query`, { method: 'POST', headers: { Origin: 'https://pocket.example', 'Content-Type': 'application/json' }, body });
    assert.equal(ok.status, 200);
    const denied = await fetch(`${base}/api/local-query`, { method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body });
    assert.equal(denied.status, 403);
  } finally {
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => site.close(resolve))]);
  }
});
