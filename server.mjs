import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/local.js', ['local.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/pricing.mjs', ['pricing.mjs', 'text/javascript; charset=utf-8']],
  ['/usage.mjs', ['usage.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
  ['/icon-192.png', ['icon-192.png', 'image/png']],
  ['/icon-512.png', ['icon-512.png', 'image/png']],
]);
const allowedPaths = new Set(['/api/status', '/api/pricing', '/api/perf-metrics/summary', '/api/user/self', '/api/log/self', '/api/log/self/stat']);

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function queryTarget(body) {
  let site, endpoint;
  try {
    site = new URL(body.site);
    endpoint = new URL(body.endpoint, 'https://endpoint.invalid');
  } catch { throw new Error('站点地址无效。'); }
  const local = site.hostname === '127.0.0.1' || site.hostname === 'localhost';
  if ((site.protocol !== 'https:' && !(local && site.protocol === 'http:')) || site.username || site.password || site.href !== `${site.origin}/`) throw new Error('请使用有效的站点首页 HTTPS 地址。');
  if (endpoint.origin !== 'https://endpoint.invalid' || !allowedPaths.has(endpoint.pathname) || endpoint.hash) throw new Error('这个查询接口不受支持。');
  const headers = { Accept: 'application/json' };
  if (body.token || body.userId) {
    if (typeof body.token !== 'string' || !body.token || /[\r\n]/.test(body.token) || !/^\d+$/.test(String(body.userId))) throw new Error('用户 ID 或访问令牌格式不正确。');
    headers.Authorization = `Bearer ${body.token}`;
    headers['New-Api-User'] = String(body.userId);
  }
  return { url: new URL(endpoint.pathname + endpoint.search, site.origin), headers };
}

export function createServer({ publicOrigin = '' } = {}) {
  if (publicOrigin) {
    const address = new URL(publicOrigin);
    if (address.protocol !== 'https:' || address.href !== `${address.origin}/`) throw new Error('QUOTA_POCKET_PUBLIC_ORIGIN 需要是完整的 HTTPS 来源。');
    publicOrigin = address.origin;
  }
  const server = http.createServer(async (req, res) => {
    const address = server.address();
    const expectedHost = `127.0.0.1:${address.port}`;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.host !== expectedHost) return json(res, 403, { error: '请使用本机地址打开额度口袋。' });
    const url = new URL(req.url, `http://${expectedHost}`);
    if (req.method === 'GET' && files.has(url.pathname)) {
      const [file, type] = files.get(url.pathname);
      try {
        let data = await readFile(path.join(root, 'public', file));
        if (file === 'index.html') data = Buffer.from(data.toString('utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="quota-pocket-service" content="same-origin">'));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        return res.end(data);
      } catch { return json(res, 500, { error: '无法读取页面文件。' }); }
    }
    if (req.method !== 'POST' || url.pathname !== '/api/local-query') return json(res, 404, { error: '没有找到这个页面。' });
    if (req.headers.origin !== (publicOrigin || `http://${expectedHost}`) || !String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 403, { error: '请求来源不正确。' });
    let body;
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { return json(res, 400, { error: '请求格式不正确。' }); }
    let target;
    try { target = queryTarget(body); } catch (error) { return json(res, 400, { error: error.message }); }
    try {
      const upstream = await fetch(target.url, { method: 'GET', headers: target.headers, redirect: 'manual', signal: AbortSignal.timeout(20000) });
      if (upstream.status >= 300 && upstream.status < 400) return json(res, 502, { error: '站点返回了跳转，请检查站点地址。' });
      const data = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(data);
    } catch { return json(res, 502, { error: '无法连接站点，请检查网络或站点状态。' }); }
  });
  return server;
}

function openBrowser(url) {
  let command, args;
  if (process.platform === 'darwin') { command = 'open'; args = [url]; }
  else if (process.platform === 'win32') { command = 'cmd'; args = ['/c', 'start', '', url]; }
  else { command = 'xdg-open'; args = [url]; }
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => console.log(`请在浏览器中打开 ${url}`));
  child.unref();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.QUOTA_POCKET_PORT ?? 18741);
  let server;
  try { server = createServer({ publicOrigin: process.env.QUOTA_POCKET_PUBLIC_ORIGIN || '' }); }
  catch (error) { console.error(error.message); process.exit(1); }
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用；如果额度口袋已经打开，请使用已有窗口。` : '额度口袋启动失败。');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.log(`额度口袋已启动：${url}`);
    console.log('这个窗口保持打开即可；关闭窗口会停止本机服务。');
    if (process.argv.includes('--open')) openBrowser(url);
  });
}
