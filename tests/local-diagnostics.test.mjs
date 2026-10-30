import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function makeLedger(profileResponse) {
  const storage = new Map();
  const context = {
    window: {},
    localStorage: { getItem(key) { return storage.get(key) ?? null; }, setItem(key, value) { storage.set(key, value); } },
    crypto: { randomUUID: () => 'test-site' }, structuredClone, URL, URLSearchParams, AbortSignal,
    location: { protocol: 'https:', hostname: 'pocket.example' },
    document: { querySelector: () => ({ content: 'same-origin' }) },
    navigator: { onLine: true },
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.endpoint === '/api/user/self') return profileResponse();
      return Response.json({ success: true, data: { quota: 0, used_quota: 0 } });
    },
  };
  vm.runInNewContext(await readFile(new URL('../public/local.js', import.meta.url), 'utf8'), context);
  context.window.ledger.upsert({ name: '测试站', url: 'https://example.test', userId: '12', token: 'test-sensitive-token' });
  return context.window.ledger;
}

test('exposes the upstream reason for HTTP 403 without displaying the token', async () => {
  const ledger = await makeLedger(() => Response.json({ success: false, message: '没有权限 test-sensitive-token' }, { status: 403 }));
  const result = await ledger.refresh('test-site');
  assert.equal(result.ok, false);
  assert.match(result.error, /没有权限/);
  assert.match(result.error, /403/);
  assert.doesNotMatch(result.error, /test-sensitive-token/);
});

test('exposes a failure reason returned with HTTP 200', async () => {
  const ledger = await makeLedger(() => Response.json({ success: false, message: '用户编号不匹配' }));
  const result = await ledger.refresh('test-site');
  assert.equal(result.ok, false);
  assert.match(result.error, /用户编号不匹配/);
});

test('distinguishes a 403 HTML response from an account error', async () => {
  const ledger = await makeLedger(() => new Response('<html>challenge</html>', { status: 403, headers: { 'Content-Type': 'text/html' } }));
  const result = await ledger.refresh('test-site');
  assert.equal(result.ok, false);
  assert.match(result.error, /网页/);
  assert.match(result.error, /403/);
});

test('explains the missing profile permission in Chinese', async () => {
  const ledger = await makeLedger(() => Response.json({ success: false, message: 'The access token lacks the required permission: profile:read' }, { status: 403 }));
  const result = await ledger.refresh('test-site');
  assert.match(result.error, /缺少/);
  assert.match(result.error, /profile:read/);
});

test('explains an invalid access token without guessing that it is an API key', async () => {
  const ledger = await makeLedger(() => Response.json({ success: false, message: 'Unauthorized, invalid access token' }));
  const result = await ledger.refresh('test-site');
  assert.match(result.error, /令牌.*无效/);
});
