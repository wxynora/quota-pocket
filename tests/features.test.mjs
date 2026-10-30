import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/local.js', import.meta.url), 'utf8');
function makeLedger(fetchImpl = async () => { throw Error('unexpected network'); }, storage = new Map()) {
  const context = {
    window: {}, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID: () => 'my-site' }, structuredClone, URL, URLSearchParams, AbortSignal,
    location: { protocol: 'https:', hostname: 'pocket.example' },
    document: { querySelector: () => ({ content: 'same-origin' }) }, navigator: { onLine: true },
    fetch: fetchImpl,
  };
  vm.runInNewContext(source, context);
  return context.window.ledger;
}

test('favorites preserve site credentials, survive reload, and export without credentials', () => {
  const storage = new Map(), ledger = makeLedger(undefined, storage);
  ledger.upsert({ name: '测试', url: 'https://site.example', userId: '12', token: 'fake-secret' });
  assert.equal(ledger.toggleFavorite(' Claude-Opus '), true);
  assert.deepEqual([...ledger.favorites()], ['Claude-Opus']);
  assert.deepEqual([...makeLedger(undefined, storage).favorites()], ['Claude-Opus']);
  assert.equal(ledger.sites().find(x => x.id === 'my-site').configured, true);
  const exported = ledger.exportSites();
  assert.doesNotMatch(JSON.stringify(exported), /fake-secret/);
  assert.deepEqual([...exported.favorites], ['Claude-Opus']);
  assert.equal(ledger.toggleFavorite('claude-opus'), false);
  assert.deepEqual([...ledger.favorites()], []);
  ledger.importSites(exported);
  assert.deepEqual([...ledger.favorites()], ['Claude-Opus']);
});

test('self-check reports each read-only endpoint independently and redacts token on errors', async () => {
  const seen = [];
  const ledger = makeLedger(async (_url, options) => {
    const body = JSON.parse(options.body); seen.push(body.endpoint);
    if (body.endpoint === '/api/user/self') return Response.json({ success: false, message: '权限不足 fake-secret' }, { status: 403 });
    if (body.endpoint.startsWith('/api/log/self/stat')) return Response.json({ success: true, data: { quota: 7 } });
    if (body.endpoint.startsWith('/api/log/self?')) return Response.json({ success: true, data: { items: [], total: 0 } });
    if (body.endpoint === '/api/pricing') return Response.json({ success: true, data: [], usable_group: {}, group_ratio: {} });
    if (body.endpoint === '/api/status') return Response.json({ success: true, data: { quota_display_type: 'USD', quota_per_unit: 500000 } });
    throw Error('unexpected endpoint');
  });
  ledger.upsert({ name: '测试', url: 'https://site.example', userId: '12', token: 'fake-secret' });
  const result = await ledger.diagnose('my-site');
  assert.equal(result.items.length, 4);
  assert.equal(result.items[0].ok, false);
  assert.match(result.items[0].message, /权限不足/);
  assert.doesNotMatch(JSON.stringify(result), /fake-secret/);
  assert.deepEqual([...result.items].slice(1).map(x => x.ok), [true, true, true]);
  assert.ok(seen.some(path => path.startsWith('/api/log/self/stat')));
});

test('usage pagination sends the requested date window and type to the station', async () => {
  const seen = [];
  const ledger = makeLedger(async (_url, options) => {
    const body = JSON.parse(options.body); seen.push(body.endpoint);
    return Response.json({ success: true, data: { items: [], page: 2, page_size: 100, total: 0 } });
  });
  ledger.upsert({ name: '测试', url: 'https://site.example', userId: '12', token: 'fake-secret' });
  await ledger.usagePage('my-site', 2, 123, 456);
  const url = new URL(seen[0], 'https://site.example');
  assert.equal(url.pathname, '/api/log/self');
  assert.equal(url.searchParams.get('p'), '2');
  assert.equal(url.searchParams.get('page_size'), '100');
  assert.equal(url.searchParams.get('type'), '2');
  assert.equal(url.searchParams.get('start_timestamp'), '123');
  assert.equal(url.searchParams.get('end_timestamp'), '456');
});
