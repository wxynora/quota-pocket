import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('an expired session navigates to the login page instead of displaying its HTML at the app URL', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const handlers = {};
  const network = new Response('<html>login</html>');
  Object.defineProperties(network, { redirected: { value: true }, url: { value: 'https://example.test/pocket-login/?next=/quota-pocket/' } });
  const self = { location: { origin: 'https://example.test' }, registration: { scope: 'https://example.test/quota-pocket/' }, addEventListener(name, handler) { handlers[name] = handler; } };
  vm.runInNewContext(source, { self, URL, Response, fetch: async () => network, caches: { open() { throw Error('login must not be cached'); } } });
  let result;
  handlers.fetch({ request: { method: 'GET', url: 'https://example.test/quota-pocket/', mode: 'navigate' }, respondWith(value) { result = value; } });
  const response = await result;
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), network.url);
});
