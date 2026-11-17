import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8787);

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const SVG_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">
  <rect width="320" height="200" fill="#1f6feb" />
  <circle cx="160" cy="90" r="46" fill="#ffffff" opacity="0.9" />
  <text x="160" y="100" font-family="sans-serif" font-size="22" fill="#1f6feb" text-anchor="middle">IMG</text>
  <text x="160" y="168" font-family="sans-serif" font-size="14" fill="#ffffff" text-anchor="middle">api-debugger mock</text>
</svg>`;

function send(res, status, body, contentType, extraHeaders = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'X-Mock-Server': 'api-debugger',
    ...extraHeaders,
  });
  res.end(buffer);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload, null, 2), 'application/json; charset=utf-8');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';
  console.log(`${new Date().toISOString()} ${method} ${url.pathname}${url.search}`);

  try {
    if (path === '/json') {
      sendJson(res, 200, {
        ok: true,
        message: '你好，API Debugger',
        method,
        query: Object.fromEntries(url.searchParams),
        time: new Date().toISOString(),
        nested: { list: [1, 2, 3], flag: false, empty: null },
      });
      return;
    }

    if (path === '/text') {
      send(res, 200, '纯文本响应，用于验证 text/plain 的渲染。', 'text/plain; charset=utf-8');
      return;
    }

    if (path === '/html') {
      send(res, 200, '<h1>Hello</h1><p>HTML 响应</p>', 'text/html; charset=utf-8');
      return;
    }

    if (path === '/xml') {
      send(res, 200, '<?xml version="1.0"?><root><item id="1">value</item></root>', 'application/xml; charset=utf-8');
      return;
    }

    if (path === '/image.svg') {
      send(res, 200, SVG_IMAGE, 'image/svg+xml');
      return;
    }

    if (path === '/image.png') {
      send(res, 200, PNG_1PX, 'image/png');
      return;
    }

    if (path === '/large') {
      const megabytes = Number(url.searchParams.get('mb') ?? 3);
      const size = Math.max(1, megabytes) * 1024 * 1024;
      send(res, 200, 'x'.repeat(size), 'text/plain; charset=utf-8');
      return;
    }

    if (path === '/stall') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Mock-Server': 'api-debugger' });
      res.write('headers sent, body never finishes');
      // Keep the socket open on purpose: reproduces a peer that stops sending mid-body.
      return;
    }

    if (path === '/slow') {
      const delay = Number(url.searchParams.get('ms') ?? 5000);
      setTimeout(() => sendJson(res, 200, { ok: true, delayedMs: delay }), delay);
      return;
    }

    if (path === '/redirect') {
      const hops = Number(url.searchParams.get('hops') ?? 1);
      if (hops > 1) {
        res.writeHead(302, { Location: `/redirect?hops=${hops - 1}`, 'X-Mock-Server': 'api-debugger' });
        res.end();
        return;
      }
      res.writeHead(302, { Location: '/json?from=redirect', 'X-Mock-Server': 'api-debugger' });
      res.end();
      return;
    }

    if (path.startsWith('/status/')) {
      const code = Number(path.slice('/status/'.length)) || 500;
      sendJson(res, code, { ok: code < 400, status: code, message: `模拟状态码 ${code}` });
      return;
    }

    if (path === '/headers') {
      sendJson(res, 200, { method, headers: req.headers });
      return;
    }

    if (path === '/echo' || path === '/anything') {
      const raw = await readBody(req);
      sendJson(res, 200, {
        method,
        path,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        bodyLength: raw.length,
        body: raw.toString('utf8'),
      });
      return;
    }

    sendJson(res, 404, { ok: false, message: `未定义的路径：${path}`, hints: ['/json', '/echo', '/image.svg', '/large', '/slow', '/redirect', '/status/404'] });
  } catch (error) {
    sendJson(res, 500, { ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, () => {
  console.log(`[mock] listening on http://127.0.0.1:${PORT}`);
  console.log('[mock] GET /json /text /html /xml /image.svg /image.png /large?mb=3 /slow?ms=8000 /redirect?hops=2 /status/404 /headers /echo');
});
