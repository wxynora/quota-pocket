import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/local.js', import.meta.url), 'utf8');
function ledgerFor(storage) {
  const context = { window: {}, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, structuredClone, URL, URLSearchParams, crypto: { randomUUID: () => 'new-id' } };
  vm.runInNewContext(source, context);
  return context.window.ledger;
}

test('new browser starts with 小鸡农场 and without the retired preset', () => {
  const ledger = ledgerFor(new Map());
  assert.ok(ledger.sites().some(site => site.url === 'https://api.68886868.xyz'));
  assert.ok(!ledger.sites().some(site => site.id === 'jiushi'));
});

test('existing configurations get 小鸡农场 once without losing credentials or re-adding it after deletion', () => {
  const previous = { sites: [{ id: 'old', name: '旧站点', url: 'https://old.example', userId: '4', token: 'fixture-token' }], proxy: { url: '', key: '' } };
  const storage = new Map([['quota-pocket-v1', JSON.stringify(previous)]]);
  const ledger = ledgerFor(storage);
  assert.ok(ledger.sites().find(site => site.id === 'old').configured);
  assert.equal(ledger.sites().filter(site => site.url === 'https://api.68886868.xyz').length, 1);
  assert.equal(JSON.parse(storage.get('quota-pocket-v1')).sites[0].token, 'fixture-token');
  const farm = ledger.sites().find(site => site.url === 'https://api.68886868.xyz');
  ledger.remove(farm.id);
  assert.ok(!ledger.sites().some(site => site.url === 'https://api.68886868.xyz'));
});

test('does not duplicate a previously added 小鸡农场 account', () => {
  const previous = { sites: [{ id: 'existing', name: '小鸡农场账号', url: 'https://api.68886868.xyz', userId: '8', token: 'fixture-token' }], proxy: { url: '', key: '' } };
  const ledger = ledgerFor(new Map([['quota-pocket-v1', JSON.stringify(previous)]]));
  assert.equal(ledger.sites().filter(site => site.url === 'https://api.68886868.xyz').length, 1);
});
