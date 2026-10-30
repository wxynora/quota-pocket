import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.POCKET_AUTH_PORT || 18743);
const ORIGIN = process.env.POCKET_AUTH_ORIGIN || `http://127.0.0.1:${PORT}`;
const HTPASSWD = process.env.POCKET_AUTH_HTPASSWD || '/etc/quota-pocket/htpasswd';
const COOKIE = '__Host-pocket-session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 8;
const sessions = new Map();
const attempts = new Map();
const files = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'" };
function respond(res, status, body, extra = {}) {
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function hashApr1(password, salt) {
  return new Promise((resolve, reject) => {
    const child = spawn('openssl', ['passwd', '-apr1', '-salt', salt, '-stdin'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks).toString('utf8').trim()) : reject(new Error('verification failed')));
    child.stdin.on('error', reject);
    child.stdin.end(`${password}\n`);
  });
}
export async function verifyPassword(password, path = HTPASSWD) {
  if (typeof password !== 'string' || !password || password.length > 1024 || /[\r\n\0]/.test(password)) return false;
  const records = (await readFile(path, 'utf8')).split(/\r?\n/);
  for (const record of records) {
    const colon = record.indexOf(':');
    const hash = colon >= 0 ? record.slice(colon + 1) : '';
    const match = /^\$apr1\$([a-zA-Z0-9./]{1,8})\$[a-zA-Z0-9./]{22}$/.exec(hash);
    if (!match) continue;
    const actual = await hashApr1(password, match[1]);
    const a = Buffer.from(actual), b = Buffer.from(hash);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}
function tokenFrom(req) {
  for (const cookie of (req.headers.cookie || '').split(';')) {
    const [key, value] = cookie.trim().split('=');
    if (key === COOKIE) return value;
  }
  return '';
}
function allowed(req) {
  const token = tokenFrom(req);
  const expires = sessions.get(token);
  if (!expires) return false;
  if (expires <= Date.now()) { sessions.delete(token); return false; }
  return true;
}
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new Error('too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createServer({ verifier = verifyPassword, origin = ORIGIN } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/check' && req.method === 'GET') return respond(res, allowed(req) ? 204 : 401, '');
      if (path === '/login' && req.method === 'POST') {
        if (req.headers.origin !== origin || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return respond(res, 403, { error: '请求来源不正确。' });
        const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown');
        const now = Date.now();
        let history = (attempts.get(ip) || []).filter(time => time > now - WINDOW_MS);
        if (history.length >= LIMIT) return respond(res, 429, { error: '尝试次数过多，请 15 分钟后再试。' });
        let data;
        try { data = await readBody(req); } catch { return respond(res, 400, { error: '请求格式不正确。' }); }
        if (!await verifier(data.password)) {
          history.push(now); attempts.set(ip, history);
          return respond(res, 401, { error: '密码不对，再试一次吧。' });
        }
        attempts.delete(ip);
        for (const [token, expires] of sessions) if (expires <= now) sessions.delete(token);
        const token = randomBytes(32).toString('base64url');
        sessions.set(token, now + SESSION_MS);
        return respond(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_MS / 1000}; Secure; HttpOnly; SameSite=Strict` });
      }
      if (req.method === 'GET' && files.has(path)) {
        const [file, type] = files.get(path);
        return respond(res, 200, await readFile(join(here, 'public', file)), { 'Content-Type': type });
      }
      return respond(res, 404, { error: 'Not found' });
    } catch { return respond(res, 500, { error: '登录服务暂时不可用。' }); }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createServer().listen(PORT, '127.0.0.1', () => console.log(`Pocket login listening on 127.0.0.1:${PORT}`));
}
