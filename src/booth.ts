import {
  clockEstimate,
  type ClientMessage,
  type RoomState,
  type Seat,
  type ServerEvent,
} from '../shared/protocol';
import { Segmenter, blobFromCanvas, captureLocal } from './media';
import { Peer, type FileMeta } from './peer';
import { drawScene } from './render';
import { validPngHeader } from '../shared/image';

export type Snapshot = {
  room: RoomState | null;
  seat: Seat;
  invite: string;
  waiting: boolean;
  online: boolean;
  connected: boolean;
  relayConfigured: boolean;
  stream: MediaStream | null;
  remote: MediaStream | null;
  photos: Map<string, Blob>;
  message: string;
  mic: boolean;
  camera: boolean;
  cutting: boolean;
};
export class Booth {
  value: Snapshot = {
    room: null,
    seat: 0,
    invite: '',
    waiting: false,
    online: false,
    connected: false,
    relayConfigured: false,
    stream: null,
    remote: null,
    photos: new Map(),
    message: '',
    mic: true,
    camera: false,
    cutting: true,
  };
  segmenter = new Segmenter();
  localVideo: HTMLVideoElement | null = null;
  private listeners = new Set<() => void>();
  private socket?: WebSocket;
  private peer?: Peer;
  private ice: RTCIceServer[] | null = null;
  private credentials: { room: string; token: string } | null = null;
  private samples: { sent: number; received: number; server: number }[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private reconnect?: ReturnType<typeof setTimeout>;
  private scheduled = new Set<string>();
  private cutouts = new Map<Seat, { bitmap: ImageBitmap; captured: number }>();
  private signals: Extract<ClientMessage, { type: 'signal' }>[] = [];
  private stopped = false;
  private busy = false;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.value;
  private update(patch: Partial<Snapshot>) {
    this.value = { ...this.value, ...patch };
    this.listeners.forEach((l) => l());
  }
  notify(message: string) {
    this.update({ message });
  }
  get timing() {
    return clockEstimate(this.samples);
  }
  serverNow() {
    return performance.now() + this.timing.offset;
  }
  send = (msg: ClientMessage) => {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
    else if (msg.type !== 'ping') this.notify('Reconnecting to your booth…');
  };
  open(first: ClientMessage) {
    this.stopped = false;
    if (this.socket) this.socket.close();
    const socket = new WebSocket(
      `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/socket`,
    );
    this.socket = socket;
    socket.onopen = () => {
      this.update({ online: true });
      this.send(first);
      this.samples = [];
      for (let i = 0; i < 5; i++)
        setTimeout(() => this.send({ type: 'ping', sent: performance.now() }), i * 150);
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(
        () => this.send({ type: 'ping', sent: performance.now() }),
        10000,
      );
    };
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data) as
        | ServerEvent
        | { type: 'ice'; iceServers: RTCIceServer[]; relayConfigured: boolean };
      if (msg.type === 'welcome') {
        this.credentials = { room: msg.state.id, token: msg.token };
        this.update({ seat: msg.seat, invite: msg.invite || this.value.invite, waiting: false });
        this.applyState(msg.state);
        if (this.value.stream) this.send({ type: 'media', camera: this.value.camera });
      } else if (msg.type === 'state') this.applyState(msg.state);
      else if (msg.type === 'ice') {
        this.ice = msg.iceServers;
        this.update({ relayConfigured: msg.relayConfigured });
        this.ensurePeer();
      } else if (msg.type === 'signal') {
        if (this.peer) void this.peer.receive(msg).catch((e) => this.fail(e));
        else this.signals.push(msg);
      } else if (msg.type === 'pong') {
        this.samples.push({ sent: msg.sent, received: performance.now(), server: msg.time });
        this.samples = this.samples.slice(-20);
      } else if (msg.type === 'waiting') this.update({ waiting: true });
      else if (msg.type === 'error') {
        this.notify(msg.message);
        if (!this.value.room) this.update({ waiting: false });
      } else if (msg.type === 'closed') {
        this.stop();
        this.update({ room: null, waiting: false, photos: new Map(), message: msg.message });
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      clearInterval(this.pingTimer);
      this.resetPeer();
      this.update({ online: false });
      if (!this.stopped && this.credentials) {
        this.notify('Connection interrupted. Rejoining your booth…');
        this.reconnect = setTimeout(
          () => this.open({ type: 'resume', ...this.credentials! }),
          1800,
        );
      }
    };
    socket.onerror = () => this.notify('The booth server could not be reached.');
  }
  private applyState(room: RoomState) {
    const previous = this.value.room?.capture;
    this.update({ room });
    if (previous && previous.id !== room.capture?.id) {
      clearTimeout(this.timer);
      this.clearCutouts();
      this.busy = false;
    }
    const keep = new Set([
      ...room.shots.map((s) => s.id),
      ...(room.capture ? [room.capture.id] : []),
    ]);
    if ([...this.value.photos.keys()].some((id) => !keep.has(id)))
      this.update({ photos: new Map([...this.value.photos].filter(([id]) => keep.has(id))) });
    if (!room.members.every((m) => m?.connected)) {
      this.resetPeer();
      return;
    }
    this.ensurePeer();
    const cap = room.capture;
    if (cap?.phase === 'arming' && !cap.acknowledgments.includes(this.value.seat)) {
      if (
        !document.hidden &&
        this.value.connected &&
        this.value.camera &&
        this.localVideo?.videoWidth &&
        this.timing.uncertainty < 180
      )
        this.send({ type: 'armed', id: cap.id });
      else {
        this.send({ type: 'cancel', id: cap.id });
        this.notify('The cameras need a moment to synchronize. Keep both tabs open and try again.');
      }
    }
    if (cap?.phase === 'countdown' && !this.scheduled.has(cap.id)) {
      this.scheduled.add(cap.id);
      const localTarget = cap.target - this.timing.offset;
      this.timer = setTimeout(
        () => {
          void this.capture(cap.id, localTarget).catch((e) => this.fail(e));
        },
        Math.max(0, localTarget - performance.now()),
      );
    }
  }
  async enableCamera() {
    try {
      if (this.value.stream) {
        this.value.stream.getVideoTracks().forEach((t) => (t.enabled = true));
        this.update({ camera: true });
        this.send({ type: 'media', camera: true });
        this.ensurePeer();
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      stream.getVideoTracks()[0].onended = () => {
        this.update({ camera: false });
        this.send({ type: 'media', camera: false });
      };
      this.update({ stream, camera: true, message: '' });
      this.send({ type: 'media', camera: true });
      this.ensurePeer();
    } catch (error) {
      this.notify(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Camera or microphone permission was declined. Allow access in your browser, then try again.'
          : 'Your camera could not start. Close other camera apps and try again.',
      );
    }
  }
  toggleCamera() {
    if (!this.value.camera) void this.enableCamera();
    else {
      this.value.stream?.getVideoTracks().forEach((t) => (t.enabled = false));
      this.update({ camera: false });
      this.send({ type: 'media', camera: false });
    }
  }
  toggleMic() {
    const mic = !this.value.mic;
    this.value.stream?.getAudioTracks().forEach((t) => (t.enabled = mic));
    this.update({ mic });
  }
  private ensurePeer() {
    if (
      this.peer ||
      !this.ice ||
      !this.value.stream ||
      !this.value.room?.members.every((m) => m?.connected && m.camera)
    )
      return;
    this.peer = new Peer(
      this.ice,
      this.send,
      this.value.stream,
      (remote) => this.update({ remote }),
      (meta, blob) => {
        void this.receiveFile(meta, blob).catch((e) => this.fail(e));
      },
      (connected) => {
        this.update({ connected });
        if (!connected) this.send({ type: 'ready', ready: false });
        else if (this.value.seat === 0)
          for (const shot of this.value.room?.shots || []) {
            const blob = this.value.photos.get(shot.id);
            if (blob)
              void this.peer
                ?.sendFile(
                  { id: shot.id, kind: 'photo', captured: shot.created, width: 1600, height: 1200 },
                  blob,
                )
                .catch((e) => this.fail(e));
          }
      },
      (message) => this.fail(new Error(message)),
    );
    for (const signal of this.signals.splice(0))
      void this.peer.receive(signal).catch((e) => this.fail(e));
    if (this.value.seat === 0) void this.peer.offer().catch((e) => this.fail(e));
  }
  private async capture(id: string, target: number) {
    if (this.value.room?.capture?.id !== id || !this.localVideo || !this.value.camera) return;
    const { canvas, captured } = await captureLocal(this.localVideo, target);
    const bitmap = this.value.cutting
      ? await this.segmenter.cutout(canvas, canvas.width, canvas.height)
      : await createImageBitmap(canvas);
    if (this.value.room?.capture?.id !== id) {
      bitmap.close();
      return;
    }
    if (this.value.seat === 0) {
      this.cutouts.set(0, { bitmap, captured: captured + this.timing.offset });
      await this.compose(id);
    } else {
      const output = document.createElement('canvas');
      output.width = bitmap.width;
      output.height = bitmap.height;
      output.getContext('2d')!.drawImage(bitmap, 0, 0);
      bitmap.close();
      await this.peer?.sendFile(
        {
          id,
          kind: 'cutout',
          captured: captured + this.timing.offset,
          width: output.width,
          height: output.height,
        },
        await blobFromCanvas(output),
      );
    }
  }
  private async receiveFile(meta: FileMeta, blob: Blob) {
    const room = this.value.room;
    if (!room) return;
    if (
      !validPngHeader(
        new Uint8Array(await blob.slice(0, 24).arrayBuffer()),
        meta.width,
        meta.height,
      )
    ) {
      throw new Error('That photo could not be safely decoded. Please retake.');
    }
    if (
      meta.kind === 'photo' &&
      this.value.seat === 1 &&
      (room.capture?.id === meta.id || room.shots.some((s) => s.id === meta.id))
    ) {
      const bitmap = await createImageBitmap(blob);
      if (bitmap.width > 4096 || bitmap.height > 4096) {
        bitmap.close();
        throw new Error('Photo dimensions too large.');
      }
      bitmap.close();
      this.update({ photos: new Map(this.value.photos).set(meta.id, blob) });
      this.send({ type: 'received', id: meta.id });
    } else if (
      meta.kind === 'cutout' &&
      this.value.seat === 0 &&
      room.capture?.id === meta.id &&
      !this.cutouts.has(1)
    ) {
      const bitmap = await createImageBitmap(blob);
      if (
        bitmap.width !== meta.width ||
        bitmap.height !== meta.height ||
        Math.abs(meta.captured - room.capture.target) > 350
      ) {
        bitmap.close();
        throw new Error('The cameras captured too far apart. Please retake.');
      }
      if (this.value.room?.capture?.id !== meta.id) {
        bitmap.close();
        return;
      }
      this.cutouts.set(1, { bitmap, captured: meta.captured });
      await this.compose(meta.id);
    }
  }
  private async compose(id: string) {
    const cap = this.value.room?.capture;
    const a = this.cutouts.get(0),
      b = this.cutouts.get(1);
    if (!a || !b || !cap || cap.id !== id || this.busy) return;
    if (Math.abs(a.captured - b.captured) > 200)
      throw new Error('Your cameras were out of step. Please retake this photo.');
    this.busy = true;
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1200;
    drawScene(canvas, [a.bitmap, b.bitmap], cap.scene, cap.positions);
    const blob = await blobFromCanvas(canvas);
    this.clearCutouts();
    if (this.value.room?.capture?.id !== id) {
      this.busy = false;
      return;
    }
    this.update({ photos: new Map(this.value.photos).set(id, blob) });
    await this.peer?.sendFile(
      { id, kind: 'photo', captured: cap.target, width: canvas.width, height: canvas.height },
      blob,
    );
    this.send({ type: 'received', id });
    this.busy = false;
  }
  setCutting(cutting: boolean) {
    this.update({ cutting });
    this.send({ type: 'ready', ready: false });
  }
  hide() {
    this.send({ type: 'ready', ready: false });
    const cap = this.value.room?.capture;
    if (cap && cap.phase !== 'review') this.send({ type: 'cancel', id: cap.id });
  }
  private clearCutouts() {
    for (const cutout of this.cutouts.values()) cutout.bitmap.close();
    this.cutouts.clear();
  }
  private resetPeer() {
    const peer = this.peer;
    this.peer = undefined;
    peer?.close();
    this.signals = [];
    this.update({ connected: false, remote: null });
    clearTimeout(this.timer);
    this.clearCutouts();
  }
  private fail(error: unknown) {
    this.busy = false;
    this.notify(
      error instanceof Error ? error.message : 'Something interrupted the photo. Try again.',
    );
    const cap = this.value.room?.capture;
    if (cap) this.send({ type: 'cancel', id: cap.id });
  }
  leave() {
    this.send({ type: 'leave' });
    this.stop();
    this.update({ room: null, waiting: false, photos: new Map() });
  }
  stop() {
    this.stopped = true;
    this.credentials = null;
    clearTimeout(this.timer);
    clearTimeout(this.reconnect);
    clearInterval(this.pingTimer);
    this.resetPeer();
    this.socket?.close();
    this.value.stream?.getTracks().forEach((t) => t.stop());
    this.update({ stream: null, remote: null, camera: false, online: false });
  }
}
