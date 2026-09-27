import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  clientMessageSchema,
  defaultPosition,
  defaultScene,
  type RoomState,
  type Seat,
  type ServerEvent,
} from '../shared/protocol.js';

export interface Client {
  id: string;
  send: (event: ServerEvent) => void;
}
type PrivateRoom = {
  state: RoomState;
  invite: string;
  tokens: [string, string | null];
  clients: [Client | null, Client | null];
  pendingClient: Client | null;
  created: number;
  disconnected: [number | null, number | null];
};
type StoredRoom = Omit<PrivateRoom, 'clients' | 'pendingClient'> & {
  clients: [string | null, string | null];
  pendingClient: string | null;
};
const secret = () => randomBytes(24).toString('base64url');
const matches = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class RoomHub {
  rooms = new Map<string, PrivateRoom>();
  constructor(private now = Date.now) {}
  snapshot() {
    return JSON.stringify(
      [...this.rooms].map(([id, room]) => [
        id,
        {
          ...room,
          clients: room.clients.map((client) => client?.id ?? null),
          pendingClient: room.pendingClient?.id ?? null,
        },
      ]),
    );
  }
  restore(value: string | null, clientForId: (id: string) => Client) {
    this.rooms.clear();
    if (!value) return;
    const stored = JSON.parse(value) as [string, StoredRoom][];
    for (const [id, room] of stored) {
      this.rooms.set(id, {
        ...room,
        clients: room.clients.map((clientId) => (clientId ? clientForId(clientId) : null)) as [
          Client | null,
          Client | null,
        ],
        pendingClient: room.pendingClient ? clientForId(room.pendingClient) : null,
      });
    }
  }
  private error(client: Client, message: string) {
    client.send({ type: 'error', message });
  }
  private broadcast(room: PrivateRoom) {
    for (const c of room.clients) c?.send({ type: 'state', state: structuredClone(room.state) });
  }
  private membership(client: Client) {
    for (const room of this.rooms.values()) {
      const index = room.clients.findIndex((c) => c?.id === client.id);
      if (index >= 0) return { room, seat: index as Seat };
    }
    return null;
  }
  handle(client: Client, input: unknown) {
    const parsed = clientMessageSchema.safeParse(input);
    if (!parsed.success) return this.error(client, 'That request could not be accepted.');
    const msg = parsed.data;
    if (msg.type === 'ping') return client.send({ type: 'pong', sent: msg.sent, time: this.now() });
    const membership = this.membership(client);
    if (
      ['create', 'join', 'resume'].includes(msg.type) &&
      (membership || [...this.rooms.values()].some((r) => r.pendingClient?.id === client.id))
    )
      return this.error(client, 'Leave your current booth first.');
    if (msg.type === 'create') {
      if (this.rooms.size >= 500)
        return this.error(client, 'The booths are busy. Please try again shortly.');
      const id = randomUUID();
      const state: RoomState = {
        id,
        members: [{ name: msg.name, connected: true, camera: false, ready: false }, null],
        pending: null,
        scene: { ...defaultScene },
        positions: [{ ...defaultPosition }, { ...defaultPosition }],
        director: 0,
        revision: 0,
        capture: null,
        shots: [],
      };
      const room: PrivateRoom = {
        state,
        invite: secret(),
        tokens: [secret(), null],
        clients: [client, null],
        pendingClient: null,
        created: this.now(),
        disconnected: [null, null],
      };
      this.rooms.set(id, room);
      client.send({
        type: 'welcome',
        seat: 0,
        token: room.tokens[0],
        invite: room.invite,
        state: structuredClone(state),
      });
      return;
    }
    if (msg.type === 'join') {
      const room = this.rooms.get(msg.room);
      if (
        !room ||
        !matches(room.invite, msg.invite) ||
        this.now() - room.created > 30 * 60000 ||
        room.tokens[1] ||
        room.pendingClient ||
        !room.clients[0]
      )
        return this.error(client, 'This invitation is unavailable or the booth is full.');
      room.state.pending = { name: msg.name, id: randomUUID() };
      room.pendingClient = client;
      client.send({ type: 'waiting' });
      this.broadcast(room);
      return;
    }
    if (msg.type === 'resume') {
      const room = this.rooms.get(msg.room);
      const index = room?.tokens.findIndex((t) => t && matches(t, msg.token)) ?? -1;
      if (
        !room ||
        index < 0 ||
        (room.disconnected[index] !== null && this.now() - room.disconnected[index]! > 120000)
      )
        return this.error(client, 'This booth can no longer be rejoined.');
      const seat = index as Seat;
      if (room.clients[seat] && room.clients[seat]!.id !== client.id)
        room.clients[seat]!.send({
          type: 'closed',
          message: 'This booth was resumed in another tab.',
        });
      room.clients[seat] = client;
      room.disconnected[seat] = null;
      room.state.members[seat]!.connected = true;
      client.send({
        type: 'welcome',
        seat,
        token: room.tokens[seat]!,
        ...(seat === 0 ? { invite: room.invite } : {}),
        state: structuredClone(room.state),
      });
      this.broadcast(room);
      return;
    }
    if (!membership) return this.error(client, 'Join a booth before using its controls.');
    const { room, seat } = membership;
    const state = room.state;
    const member = state.members[seat]!;
    if (msg.type === 'admit') {
      if (seat !== 0 || !state.pending || state.pending.id !== msg.id || !room.pendingClient)
        return this.error(client, 'Only the booth creator can admit this guest.');
      const guest = room.pendingClient;
      if (msg.accept) {
        room.clients[1] = guest;
        room.tokens[1] = secret();
        state.members[1] = {
          name: state.pending.name,
          connected: true,
          camera: false,
          ready: false,
        };
        guest.send({
          type: 'welcome',
          seat: 1,
          token: room.tokens[1],
          state: { ...structuredClone(state), pending: null },
        });
      } else guest.send({ type: 'closed', message: 'Your request to join was declined.' });
      room.pendingClient = null;
      state.pending = null;
    } else if (msg.type === 'signal') {
      room.clients[seat === 0 ? 1 : 0]?.send(msg);
      return;
    } else if (msg.type === 'media') {
      member.camera = msg.camera;
      if (!msg.camera) {
        member.ready = false;
        state.capture = null;
      }
    } else if (msg.type === 'ready') {
      member.ready = msg.ready && member.camera;
      if (!msg.ready && state.capture && state.capture.phase !== 'review') state.capture = null;
    } else if (msg.type === 'scene') {
      if (seat !== state.director || state.capture)
        return this.error(client, 'The director chooses the scene between shots.');
      state.scene = msg.scene;
      state.revision++;
      state.members.forEach((m) => {
        if (m) m.ready = false;
      });
    } else if (msg.type === 'position') {
      if (state.capture) return this.error(client, 'Wait until this photo is finished.');
      state.positions[seat] = msg.position;
      state.revision++;
      member.ready = false;
    } else if (msg.type === 'capture') {
      if (state.capture || !state.members.every((m) => m?.connected && m.ready && m.camera))
        return this.error(client, 'Both people need to be ready.');
      if (state.shots.length >= 12)
        return this.error(
          client,
          'This session has 12 photos. Download them before starting a new booth.',
        );
      state.capture = {
        id: randomUUID(),
        phase: 'arming',
        target: this.now() + 7000,
        scene: structuredClone(state.scene),
        positions: structuredClone(state.positions),
        acknowledgments: [],
        received: [],
        revision: state.revision,
      };
    } else if (msg.type === 'armed') {
      const capture = state.capture;
      if (!capture || capture.id !== msg.id || capture.phase !== 'arming') return;
      if (this.now() > capture.target - 4000) {
        state.capture = null;
        this.error(client, 'The countdown could not synchronize. Please try again.');
      } else {
        if (!capture.acknowledgments.includes(seat)) capture.acknowledgments.push(seat);
        if (capture.acknowledgments.length === 2) capture.phase = 'countdown';
      }
    } else if (msg.type === 'received') {
      const capture = state.capture;
      if (
        !capture ||
        capture.id !== msg.id ||
        !['countdown', 'processing'].includes(capture.phase) ||
        this.now() < capture.target
      )
        return;
      if (!capture.received.includes(seat)) capture.received.push(seat);
      if (capture.received.length === 2) capture.phase = 'review';
    } else if (msg.type === 'cancel') {
      if (state.capture?.id === msg.id) {
        state.capture = null;
        state.members.forEach((m) => {
          if (m) m.ready = false;
        });
      }
    } else if (msg.type === 'decide') {
      if (state.capture?.id !== msg.id || state.capture.phase !== 'review') return;
      if (msg.keep) {
        state.shots.push({ id: msg.id, created: this.now(), decorations: [] });
        state.director = state.director === 0 ? 1 : 0;
      }
      state.capture = null;
      state.members.forEach((m) => {
        if (m) m.ready = false;
      });
    } else if (msg.type === 'decorate') {
      const shot = state.shots.find((s) => s.id === msg.shot);
      if (!shot) return;
      const index = shot.decorations.findIndex((d) => d.id === msg.decoration.id);
      if (index >= 0) shot.decorations[index] = msg.decoration;
      else if (shot.decorations.length < 50) shot.decorations.push(msg.decoration);
      else return this.error(client, 'This photo has reached its decoration limit.');
    } else if (msg.type === 'erase') {
      const shot = state.shots.find((s) => s.id === msg.shot);
      if (shot) shot.decorations = shot.decorations.filter((d) => d.id !== msg.id);
    } else if (msg.type === 'leave') {
      this.close(room, 'The booth has closed. Downloaded photos stay on your device.');
      return;
    }
    this.broadcast(room);
  }
  disconnect(client: Client) {
    for (const room of this.rooms.values()) {
      if (room.pendingClient?.id === client.id) {
        room.pendingClient = null;
        room.state.pending = null;
        this.broadcast(room);
      }
    }
    const membership = this.membership(client);
    if (!membership) return;
    const { room, seat } = membership;
    room.clients[seat] = null;
    room.disconnected[seat] = this.now();
    Object.assign(room.state.members[seat]!, { connected: false, camera: false, ready: false });
    room.state.capture = null;
    room.state.members.forEach((m) => {
      if (m) m.ready = false;
    });
    this.broadcast(room);
  }
  sweep() {
    for (const room of this.rooms.values()) {
      if (
        this.now() - room.created > 4 * 3600000 ||
        room.disconnected.some((t) => t !== null && this.now() - t > 120000)
      ) {
        this.close(room, 'This booth has expired.');
        continue;
      }
      const cap = room.state.capture;
      if (
        cap &&
        ((cap.phase === 'arming' && this.now() > cap.target - 3500) ||
          (cap.phase !== 'review' && this.now() > cap.target + 45000))
      ) {
        room.state.capture = null;
        room.state.members.forEach((m) => {
          if (m) m.ready = false;
        });
        this.broadcast(room);
      } else if (cap?.phase === 'countdown' && this.now() >= cap.target) {
        cap.phase = 'processing';
        this.broadcast(room);
      }
    }
  }
  private close(room: PrivateRoom, message: string) {
    [...room.clients, room.pendingClient].forEach((c) => c?.send({ type: 'closed', message }));
    this.rooms.delete(room.state.id);
  }
}
