const paths = new Set(['/api/status', '/api/pricing', '/api/perf-metrics/summary', '/api/user/self', '/api/log/self', '/api/log/self/stat']);

function respond(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
  } });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!env.ALLOWED_APP_ORIGIN || origin !== env.ALLOWED_APP_ORIGIN) return new Response('Forbidden', { status: 403 });
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Key',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/query') return respond({ error: 'Not found' }, 404, origin);
    if (!env.PROXY_KEY || request.headers.get('X-Proxy-Key') !== env.PROXY_KEY) return respond({ error: 'Unauthorized' }, 403, origin);
    let body;
    try { body = await request.json(); } catch { return respond({ error: 'Invalid request' }, 400, origin); }
    let site, endpoint;
    try {
      site = new URL(body.site);
      endpoint = new URL(body.endpoint, 'https://endpoint.invalid');
    } catch { return respond({ error: 'Invalid address' }, 400, origin); }
    const allowed = String(env.ALLOWED_SITE_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (site.protocol !== 'https:' || site.username || site.password || site.href !== `${site.origin}/` || !allowed.includes(site.origin)) return respond({ error: 'Site is not allowed' }, 403, origin);
    if (endpoint.origin !== 'https://endpoint.invalid' || !paths.has(endpoint.pathname) || endpoint.hash) return respond({ error: 'Endpoint is not allowed' }, 403, origin);
    const headers = { Accept: 'application/json' };
    if (body.token || body.userId) {
      if (typeof body.token !== 'string' || /[\r\n]/.test(body.token) || !/^\d+$/.test(String(body.userId))) return respond({ error: 'Invalid credentials' }, 400, origin);
      headers.Authorization = `Bearer ${body.token}`;
      headers['New-Api-User'] = String(body.userId);
    }
    try {
      const upstream = await fetch(new URL(endpoint.pathname + endpoint.search, site.origin), { method: 'GET', headers, redirect: 'manual' });
      if (upstream.status >= 300 && upstream.status < 400) return respond({ error: 'Site redirected' }, 502, origin);
      const out = new Headers(cors);
      out.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json; charset=utf-8');
      out.set('Cache-Control', 'no-store');
      return new Response(upstream.body, { status: upstream.status, headers: out });
    } catch { return respond({ error: 'Site unavailable' }, 502, origin); }
  },
};
