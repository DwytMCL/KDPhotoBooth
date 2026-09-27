import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomHub, type Client } from '../server/rooms';
import { clockEstimate, defaultScene, type ServerEvent, type RoomState } from '../shared/protocol';

function fixture() {
  let now = 1000000;
  const hub = new RoomHub(() => now);
  const client = (id: string) => {
    const events: ServerEvent[] = [];
    return { id, events, send: (event: ServerEvent) => events.push(structuredClone(event)) };
  };
  const host = client('host'),
    guest = client('guest'),
    stranger = client('stranger');
  hub.handle(host, { type: 'create', name: 'K' });
  const welcome = host.events[0];
  assert.equal(welcome.type, 'welcome');
  if (welcome.type !== 'welcome') throw new Error();
  const room = () => hub.rooms.get(welcome.state.id)!.state;
  const join = () => {
    hub.handle(guest, { type: 'join', room: room().id, invite: welcome.invite, name: 'D' });
    hub.handle(host, { type: 'admit', id: room().pending!.id, accept: true });
  };
  const ready = () => {
    for (const c of [host, guest]) {
      hub.handle(c, { type: 'media', camera: true });
      hub.handle(c, { type: 'ready', ready: true });
    }
  };
  const capture = () => {
    ready();
    hub.handle(host, { type: 'capture' });
    const id = room().capture!.id;
    hub.handle(host, { type: 'armed', id });
    hub.handle(guest, { type: 'armed', id });
    now += 7000;
    hub.sweep();
    for (const c of [host, guest]) hub.handle(c, { type: 'received', id });
    return id;
  };
  return {
    hub,
    host,
    guest,
    stranger,
    welcome,
    room,
    join,
    ready,
    capture,
    advance: (ms: number) => {
      now += ms;
      hub.sweep();
    },
  };
}
test('private rooms require a valid invite and host admission, and reject a third seat', () => {
  const f = fixture();
  f.hub.handle(f.stranger, {
    type: 'join',
    room: f.room().id,
    invite: 'x'.repeat(32),
    name: 'intruder',
  });
  assert.equal(f.stranger.events.at(-1)?.type, 'error');
  assert.equal(f.room().pending, null);
  f.hub.handle(f.guest, { type: 'join', room: f.room().id, invite: f.welcome.invite, name: 'D' });
  f.hub.handle(f.stranger, { type: 'admit', id: f.room().pending!.id, accept: true });
  assert.equal(f.room().members[1], null);
  f.hub.handle(f.host, { type: 'admit', id: f.room().pending!.id, accept: true });
  assert.equal(f.room().members[1]?.name, 'D');
  f.hub.handle(f.stranger, {
    type: 'join',
    room: f.room().id,
    invite: f.welcome.invite,
    name: 'intruder',
  });
  assert.equal(f.stranger.events.at(-1)?.type, 'error');
});
test('scene editing belongs to director; position changes belong to sender', () => {
  const f = fixture();
  f.join();
  f.ready();
  f.hub.handle(f.guest, { type: 'scene', scene: { ...defaultScene, effect: 'mono' } });
  assert.equal(f.room().scene.effect, 'original');
  f.hub.handle(f.host, { type: 'scene', scene: { ...defaultScene, effect: 'mono' } });
  assert.equal(f.room().scene.effect, 'mono');
  assert.equal(f.room().members[1]?.ready, false);
  f.hub.handle(f.guest, { type: 'position', position: { x: 0.1, y: 0, scale: 1 } });
  assert.equal(f.room().positions[0].x, 0);
  assert.equal(f.room().positions[1].x, 0.1);
});
test('capture needs both cameras and acknowledgments; review waits for both photo receipts', () => {
  const f = fixture();
  f.join();
  f.hub.handle(f.host, { type: 'capture' });
  assert.equal(f.room().capture, null);
  f.ready();
  f.hub.handle(f.host, { type: 'capture' });
  const id = f.room().capture!.id;
  f.hub.handle(f.host, { type: 'armed', id });
  assert.equal(f.room().capture?.phase, 'arming');
  f.hub.handle(f.guest, { type: 'armed', id });
  assert.equal(f.room().capture?.phase, 'countdown');
  f.hub.handle(f.host, { type: 'received', id });
  assert.deepEqual(f.room().capture?.received, []);
  f.advance(7000);
  f.hub.handle(f.host, { type: 'received', id });
  assert.equal(f.room().capture?.phase, 'processing');
  f.hub.handle(f.guest, { type: 'received', id });
  assert.equal(f.room().capture?.phase, 'review');
});
test('keep is idempotent and alternates director; retake does not', () => {
  const f = fixture();
  f.join();
  const id = f.capture();
  f.hub.handle(f.host, { type: 'decide', id, keep: true });
  f.hub.handle(f.guest, { type: 'decide', id, keep: true });
  assert.equal(f.room().shots.length, 1);
  assert.equal(f.room().director, 1);
  const next = f.capture();
  f.hub.handle(f.guest, { type: 'decide', id: next, keep: false });
  assert.equal(f.room().shots.length, 1);
  assert.equal(f.room().director, 1);
});
test('disconnect cancels capture and authorized reconnect preserves same seat', () => {
  const f = fixture();
  f.join();
  f.ready();
  f.hub.handle(f.host, { type: 'capture' });
  const welcome = f.guest.events.find((e) => e.type === 'welcome')!;
  if (welcome.type !== 'welcome') throw new Error();
  f.hub.disconnect(f.guest);
  assert.equal(f.room().capture, null);
  assert.equal(f.room().members[0]?.ready, false);
  const resumed: Client = { id: 'resumed', send() {} };
  f.hub.handle(resumed, { type: 'resume', room: f.room().id, token: welcome.token });
  assert.equal(f.room().members[1]?.connected, true);
  f.hub.disconnect(resumed);
  f.advance(120001);
  assert.equal(f.hub.rooms.size, 0);
});
test('unacknowledged captures expire; stale messages cannot change a new capture', () => {
  const f = fixture();
  f.join();
  f.ready();
  f.hub.handle(f.host, { type: 'capture' });
  const old = f.room().capture!.id;
  f.advance(4000);
  assert.equal(f.room().capture, null);
  f.ready();
  f.hub.handle(f.host, { type: 'capture' });
  f.hub.handle(f.guest, { type: 'cancel', id: old });
  assert.notEqual(f.room().capture?.id, old);
  assert.ok(f.room().capture);
});
test('decorations are bounded and unavailable to outsiders', () => {
  const f = fixture();
  f.join();
  const id = f.capture();
  f.hub.handle(f.host, { type: 'decide', id, keep: true });
  const decoration = {
    id: crypto.randomUUID(),
    kind: 'text',
    text: 'Love you',
    x: 0.5,
    y: 0.5,
    color: '#ffffff',
    points: [],
  };
  f.hub.handle(f.stranger, { type: 'decorate', shot: id, decoration });
  assert.equal(f.room().shots[0].decorations.length, 0);
  f.hub.handle(f.guest, { type: 'decorate', shot: id, decoration });
  assert.equal(f.room().shots[0].decorations.length, 1);
  f.hub.handle(f.host, {
    type: 'decorate',
    shot: id,
    decoration: { ...decoration, text: 'x'.repeat(100000) },
  });
  assert.equal(f.room().shots[0].decorations[0].text, 'Love you');
});
test('signaling never leaks to someone outside the room', () => {
  const f = fixture();
  f.join();
  const before = f.guest.events.length;
  f.hub.handle(f.stranger, { type: 'signal', description: { type: 'offer', sdp: 'evil' } });
  assert.equal(f.guest.events.length, before);
});
test('room state and client membership survive a serverless instance change', () => {
  const f = fixture();
  f.join();
  const remoteEvents = new Map<string, ServerEvent[]>();
  const restored = new RoomHub();
  restored.restore(f.hub.snapshot(), (id) => ({
    id,
    send: (event) => {
      const events = remoteEvents.get(id) || [];
      events.push(structuredClone(event));
      remoteEvents.set(id, events);
    },
  }));
  restored.handle(f.host, { type: 'scene', scene: { ...defaultScene, effect: 'warm' } });
  const state = restored.rooms.get(f.room().id)!.state;
  assert.equal(state.scene.effect, 'warm');
  assert.equal(state.members[1]?.name, 'D');
  assert.equal(remoteEvents.get('guest')?.at(-1)?.type, 'state');
  const afterAnotherChange = new RoomHub();
  afterAnotherChange.restore(restored.snapshot(), (id) => ({ id, send: () => undefined }));
  assert.equal(afterAnotherChange.rooms.get(f.room().id)?.state.scene.effect, 'warm');
});
test('clock estimates favor low-latency samples', () => {
  const value = clockEstimate([
    { sent: 0, received: 20, server: 1010 },
    { sent: 100, received: 120, server: 1110 },
    { sent: 200, received: 220, server: 1210 },
    { sent: 300, received: 1300, server: 2300 },
  ]);
  assert.equal(value.offset, 1000);
  assert.equal(value.uncertainty, 10);
});
