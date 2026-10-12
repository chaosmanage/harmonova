import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';

export const sanitizedDestination = value => {
  const u = new URL(value);
  return u.origin + u.pathname; // never log queries, headers, bodies or credentials
};

// A second boundary below Playwright routing also blocks browser-followed redirects.
// Only exact authorities backed by servers owned by this test may reach a socket.
export async function offlineProxy(destinations = new Map()) {
  const sockets = new Set();
  const denied = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url);
    const target = destinations.get(u.hostname + ':' + (u.port || '80'));
    if (!target) { denied.push(sanitizedDestination(req.url)); res.writeHead(502); res.end(); return; }
    const upstream = http.request({ hostname: '127.0.0.1', port: target.port, path: u.pathname + u.search, method: req.method, headers: { ...req.headers, host: u.host } }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  server.on('connect', (req, client, head) => {
    const target = destinations.get(req.url);
    if (!target) { denied.push('https://' + req.url.split('@').pop().split('?')[0]); client.end('HTTP/1.1 502 Blocked\r\n\r\n'); return; }
    const upstream = net.connect(target.port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client); client.pipe(upstream);
    });
    sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy());
  });
  server.on('connection', s => { sockets.add(s); s.on('error', () => {}); s.on('close', () => sockets.delete(s)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, denied,
    async close() { for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve)); } };
}

export async function installOfflineRoutes(context) {
  const unexpected = [];
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.protocol === 'chrome-extension:') return route.continue();
    // Explicit harmless provider fixtures; no remote fallback.
    if (['www.google.com', 'icons.duckduckgo.com', 'www.youtube.com', 'i.ytimg.com'].includes(u.hostname))
      return route.fulfill({ status: 404, body: '' });
    unexpected.push(sanitizedDestination(u.href));
    return route.abort('blockedbyclient');
  });
  return () => assert.deepEqual(unexpected, [], 'Unexpected network destinations: ' + unexpected.join(', '));
}

// Real TLS fixture origin. Certificates, sockets and server lifetime are test-owned.
export async function localTlsFixture(handler) {
  const [{ default: https }, { mkdtemp, readFile, rm }, { execFileSync }, { default: os }, { default: path }] = await Promise.all([
    import('node:https'), import('node:fs/promises'), import('node:child_process'), import('node:os'), import('node:path'),
  ]);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'harmonova-tls-'));
  let server;
  const sockets = new Set();
  const hits = new Map();
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=fixture.test', '-keyout', dir + '/key', '-out', dir + '/cert'], { stdio: 'ignore' });
    server = https.createServer({ key: await readFile(dir + '/key'), cert: await readFile(dir + '/cert') }, (req, res) => {
      const key = req.headers.host + new URL(req.url, 'https://fixture.test').pathname;
      hits.set(key, (hits.get(key) || 0) + 1);
      handler(req, res);
    });
    server.on('connection', s => { sockets.add(s); s.on('error', () => {}); s.on('close', () => sockets.delete(s)); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { port: server.address().port, hits, async close() {
      for (const s of sockets) s.destroy();
      await new Promise(resolve => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    } };
  } catch (error) { for (const s of sockets) s.destroy(); server?.close(); await rm(dir, { recursive: true, force: true }); throw error; }
}

export async function localHttpFixture(handler) {
  const hits = new Map();
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const key = req.headers.host + new URL(req.url, 'http://fixture.test').pathname;
    hits.set(key, (hits.get(key) || 0) + 1); handler(req, res);
  });
  server.on('connection', s => { sockets.add(s); s.on('error', () => {}); s.on('close', () => sockets.delete(s)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, hits, async close() { for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve)); } };
}

// Playwright does not re-route every followed navigation/fetch redirect. Serve
// those HN hops with the same synthetic handler behind the offline proxy too.
export async function hnRedirectFixture(handle) {
  return localTlsFixture((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      Promise.resolve(handle({
        request: () => ({ url: () => 'https://news.ycombinator.com' + req.url, method: () => req.method, postData: () => body, headers: () => req.headers }),
        fulfill: ({ status = 200, contentType, headers = {}, body = '' }) => {
          res.writeHead(status, { ...(contentType ? { 'content-type': contentType } : {}), ...headers }); res.end(body);
        },
        abort: () => { res.writeHead(502); res.end(); },
      })).catch(() => { res.writeHead(502); res.end(); });
    });
  });
}
