import { z } from 'zod';

export const positionSchema = z.object({
  x: z.number().min(-0.5).max(0.5),
  y: z.number().min(-0.4).max(0.4),
  scale: z.number().min(0.6).max(1.5),
});
export const sceneSchema = z.object({
  layout: z.enum(['together', 'overlap']),
  background: z.enum(['rose', 'cream', 'blue', 'curtain']),
  effect: z.enum(['original', 'mono', 'warm']),
  reference: z.number().int().min(0).max(26),
  border: z.enum(['ivory', 'cherry']),
  finish: z.enum(['clean', 'paper', 'dated']),
});
export const pointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export const decorationSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['text', 'sticker', 'stroke']),
  text: z.string().max(60),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  color: z.enum(['#ffffff', '#761c2c', '#edb55a', '#222222']),
  points: z.array(pointSchema).max(250),
});
export type Scene = z.infer<typeof sceneSchema>;
export type Position = z.infer<typeof positionSchema>;
export type Decoration = z.infer<typeof decorationSchema>;
export type Seat = 0 | 1;
export const defaultScene: Scene = {
  layout: 'together',
  background: 'rose',
  effect: 'original',
  reference: 0,
  border: 'ivory',
  finish: 'clean',
};
export const defaultPosition: Position = { x: 0, y: 0, scale: 1 };
export type Member = { name: string; connected: boolean; camera: boolean; ready: boolean };
export type Capture = {
  id: string;
  phase: 'arming' | 'countdown' | 'processing' | 'review';
  target: number;
  scene: Scene;
  positions: [Position, Position];
  acknowledgments: Seat[];
  received: Seat[];
  revision: number;
};
export type Shot = { id: string; created: number; decorations: Decoration[] };
export type RoomState = {
  id: string;
  members: [Member | null, Member | null];
  pending: { name: string; id: string } | null;
  scene: Scene;
  positions: [Position, Position];
  director: Seat;
  revision: number;
  capture: Capture | null;
  shots: Shot[];
};

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), name: z.string().trim().min(1).max(24) }),
  z.object({
    type: z.literal('join'),
    room: z.string().uuid(),
    invite: z.string().min(20).max(100),
    name: z.string().trim().min(1).max(24),
  }),
  z.object({
    type: z.literal('resume'),
    room: z.string().uuid(),
    token: z.string().min(20).max(100),
  }),
  z.object({ type: z.literal('admit'), id: z.string().uuid(), accept: z.boolean() }),
  z.object({ type: z.literal('ping'), sent: z.number() }),
  z.object({
    type: z.literal('signal'),
    description: z
      .object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(40000) })
      .optional(),
    candidate: z
      .object({
        candidate: z.string().max(2000),
        sdpMid: z.string().nullable().optional(),
        sdpMLineIndex: z.number().nullable().optional(),
        usernameFragment: z.string().nullable().optional(),
      })
      .optional(),
  }),
  z.object({ type: z.literal('media'), camera: z.boolean() }),
  z.object({ type: z.literal('ready'), ready: z.boolean() }),
  z.object({ type: z.literal('scene'), scene: sceneSchema }),
  z.object({ type: z.literal('position'), position: positionSchema }),
  z.object({ type: z.literal('capture') }),
  z.object({ type: z.literal('armed'), id: z.string().uuid() }),
  z.object({ type: z.literal('received'), id: z.string().uuid() }),
  z.object({ type: z.literal('cancel'), id: z.string().uuid() }),
  z.object({ type: z.literal('decide'), id: z.string().uuid(), keep: z.boolean() }),
  z.object({ type: z.literal('decorate'), shot: z.string().uuid(), decoration: decorationSchema }),
  z.object({ type: z.literal('erase'), shot: z.string().uuid(), id: z.string().uuid() }),
  z.object({ type: z.literal('leave') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerEvent =
  | { type: 'welcome'; seat: Seat; token: string; invite?: string; state: RoomState }
  | { type: 'state'; state: RoomState }
  | { type: 'waiting' }
  | { type: 'error'; message: string }
  | { type: 'closed'; message: string }
  | { type: 'pong'; sent: number; time: number }
  | Extract<ClientMessage, { type: 'signal' }>;

export function clockEstimate(samples: { sent: number; received: number; server: number }[]) {
  const best = [...samples].sort((a, b) => a.received - a.sent - (b.received - b.sent)).slice(0, 3);
  if (!best.length) return { offset: 0, uncertainty: Infinity };
  return {
    offset: best.reduce((sum, s) => sum + s.server - (s.sent + s.received) / 2, 0) / best.length,
    uncertainty: Math.max(...best.map((s) => (s.received - s.sent) / 2)),
  };
}
