import { experimental_upgradeWebSocket, type WebSocketData } from '@vercel/functions';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { ServerEvent } from '../shared/protocol.js';
import { RoomHub, type Client } from '../server/rooms.js';

export const maxDuration = 300;
const stateKey = 'kdphotobooth:rooms';
const lockKey = 'kdphotobooth:rooms:lock';
const ttl = 4 * 60 * 60;
const redisUrl = process.env.REDIS_URL;
const redis = redisUrl
  ? new Redis(redisUrl, { maxRetriesPerRequest: 2, enableReadyCheck: false })
  : null;
const releaseLock = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

async function locked<T>(run: () => Promise<T>): Promise<T> {
  if (!redis) throw new Error('Room storage is not configured.');
  const token = randomUUID();
  const deadline = Date.now() + 10000;
  while ((await redis.set(lockKey, token, 'PX', 30000, 'NX')) !== 'OK') {
    if (Date.now() > deadline) throw new Error('The booth is busy. Please try again.');
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  try {
    return await run();
  } finally {
    await redis.eval(releaseLock, 1, lockKey, token);
  }
}

async function publish(clientId: string, event: ServerEvent) {
  if (!redis) return;
  const key = `kdphotobooth:events:${clientId}`;
  await redis.xadd(key, 'MAXLEN', '~', '2000', '*', 'event', JSON.stringify(event));
  await redis.expire(key, ttl);
}

async function getIceServers() {
  const keyId = process.env.TURN_KEY_ID;
  const apiToken = process.env.TURN_API_TOKEN;
  if (!keyId || !apiToken)
    return {
      type: 'ice',
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      relayConfigured: false,
    };
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl }),
    },
  );
  if (!response.ok) throw new Error(`TURN credential request failed (${response.status}).`);
  const result = (await response.json()) as { iceServers?: RTCIceServer[] };
  const iceServers = (result.iceServers || []).map((server) => ({
    ...server,
    urls: Array.isArray(server.urls)
      ? server.urls.filter((url) => !/:53(?:\?|$)/.test(url))
      : typeof server.urls === 'string'
        ? server.urls
        : [],
  }));
  const relayConfigured = iceServers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls || ''];
    return (
      urls.some((url) => url.startsWith('turn:') || url.startsWith('turns:')) &&
      Boolean(server.username && server.credential)
    );
  });
  return { type: 'ice', iceServers, relayConfigured };
}

export function GET(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin)
    return new Response('Forbidden', { status: 403 });
  if (!redis) return new Response('Room storage is unavailable.', { status: 503 });

  return experimental_upgradeWebSocket(
    (ws) => {
      const clientId = randomUUID();
      const currentEvents: { clientId: string; event: ServerEvent }[] = [];
      const client: Client = {
        id: clientId,
        send: (event) => currentEvents.push({ clientId, event }),
      };
      const reader = redis.duplicate({ maxRetriesPerRequest: null, enableReadyCheck: false });
      let cursor = '0-0';
      let closed = false;
      let iceSent = false;
      let windowStarted = Date.now();
      let messageCount = 0;

      const deliver = async (event: ServerEvent) => {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(JSON.stringify(event));
        if (event.type === 'welcome' && !iceSent) {
          iceSent = true;
          try {
            ws.send(JSON.stringify(await getIceServers()));
          } catch {
            ws.send(
              JSON.stringify({
                type: 'ice',
                iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
                relayConfigured: false,
              }),
            );
          }
        }
      };

      const runHub = async (message?: unknown, disconnect = false) => {
        await locked(async () => {
          currentEvents.length = 0;
          const hub = new RoomHub();
          const clientForId = (id: string): Client =>
            id === clientId
              ? client
              : { id, send: (event) => currentEvents.push({ clientId: id, event }) };
          hub.restore(await redis.get(stateKey), clientForId);
          hub.sweep();
          if (disconnect) hub.disconnect(client);
          else if (message !== undefined) hub.handle(client, message);
          const snapshot = hub.snapshot();
          if (hub.rooms.size) await redis.set(stateKey, snapshot, 'EX', ttl);
          else await redis.del(stateKey);
          for (const queued of currentEvents) await publish(queued.clientId, queued.event);
        });
      };

      const pump = async () => {
        const key = `kdphotobooth:events:${clientId}`;
        while (!closed) {
          try {
            const rows = (await (
              reader.xread as (...args: (string | number)[]) => Promise<unknown>
            )('BLOCK', 25000, 'COUNT', 100, 'STREAMS', key, cursor)) as
              | [string, [string, string[]][]][]
              | null;
            if (!rows) continue;
            for (const [, entries] of rows) {
              for (const [id, fields] of entries) {
                cursor = id;
                const eventValue = fields[fields.indexOf('event') + 1];
                if (eventValue) await deliver(JSON.parse(eventValue) as ServerEvent);
              }
            }
          } catch {
            if (!closed) await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      };
      void pump();

      ws.on('message', (data: WebSocketData, binary: boolean) => {
        if (binary || Buffer.byteLength(data.toString()) > 64000) {
          ws.close(1009, 'Message too large');
          return;
        }
        if (Date.now() - windowStarted > 10000) {
          windowStarted = Date.now();
          messageCount = 0;
        }
        if (++messageCount > 300) {
          ws.close(1008, 'Too many requests');
          return;
        }
        try {
          const message = JSON.parse(data.toString()) as { type?: string; sent?: number };
          if (message.type === 'ping' && typeof message.sent === 'number') {
            void deliver({ type: 'pong', sent: message.sent, time: Date.now() });
            return;
          }
          void runHub(message).catch(() => {
            void deliver({
              type: 'error',
              message: 'The booth could not save that update. Try again.',
            });
          });
        } catch {
          void deliver({ type: 'error', message: 'The request was not understood.' });
        }
      });

      const cleanup = () => {
        if (closed) return;
        closed = true;
        reader.disconnect();
        void runHub(undefined, true).catch(() => undefined);
      };
      ws.on('close', cleanup);
      ws.on('error', cleanup);
    },
    { maxPayload: 64000 },
  );
}
