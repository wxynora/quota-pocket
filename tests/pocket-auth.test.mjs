import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer, verifyPassword } from '../pocket-auth/server.mjs';

test('verifies an existing APR1 password without accepting the wrong one', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pocket-auth-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const hash = spawnSync('openssl', ['passwd', '-apr1', '-salt', 'test1234', '-stdin'], { input: 'sample-password\n', encoding: 'utf8' });
  assert.equal(hash.status, 0);
  const path = join(dir, 'htpasswd');
  await writeFile(path, `example:${hash.stdout.trim()}\n`);
  assert.equal(await verifyPassword('sample-password', path), true);
  assert.equal(await verifyPassword('wrong-password', path), false);
});

test('login form issues a session usable by auth_request, and rejects wrong origins', async t => {
  const origin = 'https://example.test';
  const server = createServer({ origin, verifier: async password => password === 'sample-password' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/check`)).status, 401);
  const rejected = await fetch(`${base}/login`, { method: 'POST', headers: { Origin: 'https://other.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'sample-password' }) });
  assert.equal(rejected.status, 403);
  const wrong = await fetch(`${base}/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) });
  assert.equal(wrong.status, 401);
  const accepted = await fetch(`${base}/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'sample-password' }) });
  assert.equal(accepted.status, 200);
  const cookie = accepted.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.equal((await fetch(`${base}/check`, { headers: { Cookie: cookie.split(';')[0] } })).status, 204);
});
