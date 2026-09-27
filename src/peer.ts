import type { ClientMessage } from '../shared/protocol';
export type FileMeta = {
  id: string;
  kind: 'cutout' | 'photo';
  size: number;
  captured: number;
  width: number;
  height: number;
};
const MAX_BYTES = 12 * 1024 * 1024;
export class Peer {
  connection: RTCPeerConnection;
  channel?: RTCDataChannel;
  private candidates: RTCIceCandidateInit[] = [];
  private incoming: {
    meta: FileMeta;
    parts: ArrayBuffer[];
    size: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private queue = Promise.resolve();
  private closed = false;
  constructor(
    iceServers: RTCIceServer[],
    private signal: (msg: ClientMessage) => void,
    stream: MediaStream,
    private onStream: (stream: MediaStream) => void,
    private onFile: (meta: FileMeta, blob: Blob) => void,
    private onState: (ready: boolean) => void,
    private onError: (message: string) => void,
  ) {
    this.connection = new RTCPeerConnection({ iceServers });
    stream.getTracks().forEach((track) => this.connection.addTrack(track, stream));
    this.connection.onicecandidate = (event) => {
      if (event.candidate)
        this.signal({
          type: 'signal',
          candidate: { ...event.candidate.toJSON(), candidate: event.candidate.candidate },
        });
    };
    this.connection.ontrack = (event) => {
      if (event.streams[0]) this.onStream(event.streams[0]);
    };
    this.connection.ondatachannel = (event) => this.attach(event.channel);
    this.connection.onconnectionstatechange = () => {
      this.onState(
        this.connection.connectionState === 'connected' && this.channel?.readyState === 'open',
      );
      if (this.connection.connectionState === 'failed')
        this.onError(
          'The camera connection failed. Reconnect, or check relay configuration for different networks.',
        );
    };
  }
  async offer() {
    this.attach(this.connection.createDataChannel('photos'));
    await this.connection.setLocalDescription(await this.connection.createOffer());
    this.signal({
      type: 'signal',
      description: { type: 'offer', sdp: this.connection.localDescription!.sdp },
    });
  }
  async receive(msg: Extract<ClientMessage, { type: 'signal' }>) {
    if (msg.description) {
      await this.connection.setRemoteDescription(msg.description);
      for (const candidate of this.candidates.splice(0))
        await this.connection.addIceCandidate(candidate);
      if (msg.description.type === 'offer') {
        await this.connection.setLocalDescription(await this.connection.createAnswer());
        this.signal({
          type: 'signal',
          description: { type: 'answer', sdp: this.connection.localDescription!.sdp },
        });
      }
    } else if (msg.candidate) {
      if (this.connection.remoteDescription) await this.connection.addIceCandidate(msg.candidate);
      else this.candidates.push(msg.candidate);
    }
  }
  private attach(channel: RTCDataChannel) {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 128 * 1024;
    channel.onopen = () => this.onState(true);
    channel.onclose = () => this.onState(false);
    channel.onmessage = (event) => {
      try {
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data);
          if (msg.type === 'start') {
            if (
              this.incoming ||
              !/^[\da-f-]{36}$/i.test(msg.id) ||
              !['photo', 'cutout'].includes(msg.kind) ||
              !Number.isInteger(msg.size) ||
              msg.size < 1 ||
              msg.size > MAX_BYTES ||
              !Number.isFinite(msg.captured) ||
              !Number.isInteger(msg.width) ||
              !Number.isInteger(msg.height) ||
              msg.width < 1 ||
              msg.height < 1 ||
              msg.width > 4096 ||
              msg.height > 4096
            )
              throw new Error('Invalid photo transfer');
            this.incoming = {
              meta: msg,
              parts: [],
              size: 0,
              timer: setTimeout(() => {
                this.incoming = null;
                this.onError('Photo transfer timed out. Retake the photo.');
              }, 30000),
            };
          } else if (msg.type === 'end' && this.incoming && msg.id === this.incoming.meta.id) {
            const current = this.incoming;
            this.incoming = null;
            clearTimeout(current.timer);
            if (current.size !== current.meta.size) throw new Error('Incomplete photo');
            this.onFile(current.meta, new Blob(current.parts, { type: 'image/png' }));
          }
        } else if (event.data instanceof ArrayBuffer && this.incoming) {
          this.incoming.size += event.data.byteLength;
          if (this.incoming.size > this.incoming.meta.size) throw new Error('Photo too large');
          this.incoming.parts.push(event.data);
        }
      } catch {
        if (this.incoming) clearTimeout(this.incoming.timer);
        this.incoming = null;
        this.onError('Photo transfer failed. Please retake.');
      }
    };
  }
  sendFile(meta: Omit<FileMeta, 'size'>, blob: Blob) {
    const task = this.queue.then(async () => {
      const channel = this.channel;
      if (!channel || channel.readyState !== 'open' || blob.size > MAX_BYTES || this.closed)
        throw new Error('Partner is not ready to receive a photo.');
      channel.send(JSON.stringify({ type: 'start', ...meta, size: blob.size }));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      for (let offset = 0; offset < bytes.length; offset += 16384) {
        if (channel.bufferedAmount > 256 * 1024)
          await new Promise<void>((resolve, reject) => {
            const finish = () => {
              clearTimeout(timer);
              channel.removeEventListener('bufferedamountlow', success);
              channel.removeEventListener('close', failure);
            };
            const success = () => {
              finish();
              resolve();
            };
            const failure = () => {
              finish();
              reject(new Error('Photo connection closed.'));
            };
            const timer = setTimeout(failure, 10000);
            channel.addEventListener('bufferedamountlow', success, { once: true });
            channel.addEventListener('close', failure, { once: true });
          });
        if (channel.readyState !== 'open') throw new Error('Photo connection closed.');
        channel.send(bytes.slice(offset, offset + 16384));
      }
      channel.send(JSON.stringify({ type: 'end', id: meta.id }));
    });
    this.queue = task.catch(() => {});
    return task;
  }
  close() {
    this.closed = true;
    if (this.incoming) clearTimeout(this.incoming.timer);
    this.incoming = null;
    this.channel?.close();
    this.connection.close();
  }
}
