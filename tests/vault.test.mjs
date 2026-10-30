import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const source = await readFile(new URL('../public/local.js', import.meta.url), 'utf8');
function makeLedger(storage, options = {}) {
  const context = {
    window: {},
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { if (options.failWrites?.()) throw Error('storage full'); storage.set(key, value); },
      removeItem: key => storage.delete(key),
    },
    crypto: webcrypto, structuredClone, URL, URLSearchParams, AbortSignal, TextEncoder, TextDecoder, btoa, atob,
    location: { protocol: 'https:', hostname: 'pocket.example' },
    document: { querySelector: () => ({ content: 'same-origin' }) }, navigator: { onLine: true },
    fetch: options.fetch || (async () => { throw Error('unexpected network'); }),
  };
  vm.runInNewContext(source, context);
  return context.window.ledger;
}

test('optional vault encrypts existing settings, unlocks after reload, saves edits, and can be disabled', async () => {
  const storage = new Map(), first = makeLedger(storage);
  const site = await first.upsert({ name: '示例站', url: 'https://site.example', userId: '12', token: 'sample-site-secret' });
  await first.saveSettings({ url: 'https://proxy.example', key: 'sample-proxy-secret' });
  await first.toggleFavorite('demo-model');
  await first.enableVault('long local passphrase');
  const encrypted = storage.get('quota-pocket-v1');
  assert.doesNotMatch(encrypted, /sample-site-secret|sample-proxy-secret|示例站|demo-model/);
  assert.equal(first.vaultStatus().enabled, true);
  assert.equal(first.vaultStatus().unlocked, true);

  const reopened = makeLedger(storage);
  assert.equal(reopened.vaultStatus().enabled, true);
  assert.equal(reopened.vaultStatus().unlocked, false);
  assert.throws(() => reopened.sites(), /解锁/);
  await assert.rejects(reopened.upsert({ name: '不应保存', url: 'https://site.example' }), /解锁/);
  await assert.rejects(reopened.unlockVault('wrong password'), /不正确|损坏/);
  assert.equal(storage.get('quota-pocket-v1'), encrypted);
  await reopened.unlockVault('long local passphrase');
  assert.equal(reopened.sites().find(item => item.id === site.id).configured, true);
  assert.equal(reopened.settings().key, 'sample-proxy-secret');
  assert.deepEqual([...reopened.favorites()], ['demo-model']);
  assert.doesNotMatch(JSON.stringify(reopened.exportSites()), /sample-site-secret|sample-proxy-secret/);
  await reopened.upsert({ id: site.id, name: '示例站', url: 'https://site.example', userId: '12', token: 'updated-sample-secret' });
  assert.doesNotMatch(storage.get('quota-pocket-v1'), /sample-site-secret|sample-proxy-secret|updated-sample-secret/);
  assert.notEqual(JSON.parse(storage.get('quota-pocket-v1')).iv, JSON.parse(encrypted).iv);
  const again = makeLedger(storage);
  await again.unlockVault('long local passphrase');
  await again.disableVault();
  assert.equal(again.vaultStatus().enabled, false);
  assert.match(storage.get('quota-pocket-v1'), /updated-sample-secret/);
  assert.equal(again.sites().find(item => item.id === site.id).configured, true);
});

test('tampered encrypted data is not accepted or overwritten', async () => {
  const storage = new Map(), first = makeLedger(storage);
  await first.upsert({ name: '示例', url: 'https://site.example', userId: '9', token: 'fixture-secret' });
  await first.enableVault('long local passphrase');
  const record = JSON.parse(storage.get('quota-pocket-v1'));
  record.ciphertext = (record.ciphertext[0] === 'A' ? 'B' : 'A') + record.ciphertext.slice(1);
  const damaged = JSON.stringify(record); storage.set('quota-pocket-v1', damaged);
  const reopened = makeLedger(storage);
  await assert.rejects(reopened.unlockVault('long local passphrase'), /损坏/);
  assert.equal(storage.get('quota-pocket-v1'), damaged);
});

test('after unlocking, authenticated queries use the restored site token', async () => {
  const storage = new Map(), first = makeLedger(storage);
  const site = await first.upsert({ name: '示例', url: 'https://site.example', userId: '9', token: 'fixture-secret' });
  await first.enableVault('long local passphrase');
  const requests = [];
  const reopened = makeLedger(storage, { fetch: async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (body.endpoint === '/api/status') return Response.json({ success: true, data: { quota_display_type: 'USD', quota_per_unit: 500000 } });
    if (body.endpoint === '/api/user/self') return Response.json({ success: true, data: { quota: 1000000, used_quota: 500000 } });
    return Response.json({ success: true, data: { quota: 500000 } });
  } });
  await reopened.unlockVault('long local passphrase');
  assert.equal((await reopened.refresh(site.id)).ok, true);
  const authenticated = requests.filter(item => item.endpoint !== '/api/status');
  assert.equal(authenticated.length, 3);
  assert.ok(authenticated.every(item => item.userId === '9' && item.token === 'fixture-secret'));
  assert.equal(requests.find(item => item.endpoint === '/api/status').token, '');
});

test('failed storage writes leave existing configuration intact', async () => {
  const storage = new Map(); let blocked = false;
  const ledger = makeLedger(storage, { failWrites: () => blocked });
  await ledger.upsert({ name: '示例', url: 'https://site.example', userId: '9', token: 'fixture-secret' });
  const before = storage.get('quota-pocket-v1');
  blocked = true;
  await assert.rejects(ledger.enableVault('long local passphrase'), /无法保存/);
  assert.equal(storage.get('quota-pocket-v1'), before);
  blocked = false;
  await ledger.enableVault('long local passphrase');
  const encrypted = storage.get('quota-pocket-v1');
  blocked = true;
  await assert.rejects(ledger.toggleFavorite('demo'), /无法保存/);
  assert.equal(storage.get('quota-pocket-v1'), encrypted);
  assert.deepEqual([...ledger.favorites()], []);
});

test('a second unlocked tab cannot overwrite changes made by the first', async () => {
  const storage = new Map(), first = makeLedger(storage);
  await first.upsert({ name: '示例', url: 'https://site.example', userId: '9', token: 'fixture-secret' });
  await first.enableVault('long local passphrase');
  const second = makeLedger(storage);
  await second.unlockVault('long local passphrase');
  await first.toggleFavorite('model-a');
  const saved = storage.get('quota-pocket-v1');
  await assert.rejects(second.toggleFavorite('model-b'), /其他页面更改/);
  assert.equal(storage.get('quota-pocket-v1'), saved);
  const reopened = makeLedger(storage);
  await reopened.unlockVault('long local passphrase');
  assert.deepEqual([...reopened.favorites()], ['model-a']);
});

test('forgot-password reset removes only this app’s configuration and cached balance', async () => {
  const storage = new Map([['another-app', 'keep-me']]), first = makeLedger(storage);
  await first.upsert({ name: '示例', url: 'https://site.example', userId: '9', token: 'fixture-secret' });
  storage.set('quota-pocket-last-results-v1', '{"old":"cached"}');
  await first.enableVault('long local passphrase');
  const locked = makeLedger(storage);
  await locked.resetVault();
  assert.equal(storage.has('quota-pocket-v1'), false);
  assert.equal(storage.has('quota-pocket-last-results-v1'), false);
  assert.equal(storage.get('another-app'), 'keep-me');
  assert.equal(locked.vaultStatus().enabled, false);
  assert.ok(!locked.sites().some(site => site.name === '示例'));
});
