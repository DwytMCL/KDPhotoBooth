import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomHub } from './rooms';

try {
  process.loadEnvFile();
} catch {
  /* Environment variables are optional locally. */
}
const hub = new RoomHub();
const port = Number(process.env.PORT || 3001);
const origins = new Set(
  (
    process.env.APP_ORIGIN ||
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001'
  ).split(','),
);
const root = resolve('dist');
const mime: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
};
const server = createServer((req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'",
  );
  if (req.url === '/api/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  // TURN credentials are only delivered on the authenticated room socket below.
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end();
    return;
  }
  let path: string;
  try {
    path = resolve(
      root,
      '.' + decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname),
    );
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (!path.startsWith(root + sep) && path !== root) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(path) || path === root) path = resolve(root, 'index.html');
  if (!existsSync(path)) {
    res.writeHead(404);
    res.end('Run npm run build first, or use the development URL.');
    return;
  }
  res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
  createReadStream(path)
    .on('error', () => {
      if (!res.headersSent) res.writeHead(404);
      res.end();
    })
    .pipe(res);
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 64000 });
const connections = new Map<string, number>();
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/socket' || !req.headers.origin || !origins.has(req.headers.origin)) {
    socket.destroy();
    return;
  }
  const ip = req.socket.remoteAddress || 'unknown';
  if ((connections.get(ip) || 0) >= 20) {
    socket.destroy();
    return;
  }
  connections.set(ip, (connections.get(ip) || 0) + 1);
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.on('close', () => connections.set(ip, Math.max(0, (connections.get(ip) || 1) - 1)));
    wss.emit('connection', ws);
  });
});
wss.on('connection', (ws) => {
  let windowStart = Date.now(),
    count = 0,
    alive = true;
  const client = {
    id: randomUUID(),
    send(event: import('../shared/protocol').ServerEvent) {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(event));
      if (event.type === 'welcome') {
        const urls = process.env.TURN_URLS?.split(',').filter(Boolean);
        const turnSecret = process.env.TURN_SECRET;
        const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
        if (urls?.length && turnSecret) {
          const username = `${Math.floor(Date.now() / 1000) + 4 * 3600}:${event.state.id}`;
          iceServers.push({
            urls,
            username,
            credential: createHmac('sha1', turnSecret).update(username).digest('base64'),
          });
        }
        ws.send(
          JSON.stringify({
            type: 'ice',
            iceServers,
            relayConfigured: Boolean(urls?.length && turnSecret),
          }),
        );
      }
    },
  };
  ws.on('pong', () => {
    alive = true;
  });
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 30000);
  ws.on('message', (data, binary) => {
    if (Date.now() - windowStart > 10000) {
      windowStart = Date.now();
      count = 0;
    }
    if (++count > 300 || binary) {
      ws.close(1008, 'Too many requests');
      return;
    }
    try {
      hub.handle(client, JSON.parse(data.toString()));
    } catch {
      client.send({ type: 'error', message: 'The request was not understood.' });
    }
  });
  ws.on('close', () => {
    clearInterval(heartbeat);
    hub.disconnect(client);
  });
  ws.on('error', () => ws.close());
});
setInterval(() => hub.sweep(), 500).unref();
server.listen(port, process.env.HOST || '127.0.0.1', () =>
  console.log(`KDPhotoBooth server ready on port ${port}`),
);
