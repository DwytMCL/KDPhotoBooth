import { useEffect, useRef, useState } from 'react';
import { Camera, Heart } from 'lucide-react';
import type { Booth, Snapshot } from './booth';
import { drawScene } from './render';

export function Stage({ booth, state }: { booth: Booth; state: Snapshot }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    local = useRef<HTMLVideoElement>(null),
    remote = useRef<HTMLVideoElement>(null);
  const [remaining, setRemaining] = useState(0);
  const room = state.room;
  useEffect(() => {
    if (local.current) {
      local.current.srcObject = state.stream;
      booth.localVideo = local.current;
      void local.current.play().catch(() => {});
    }
  }, [state.stream, booth]);
  useEffect(() => {
    if (remote.current) {
      remote.current.srcObject = state.remote;
      if (state.remote)
        void remote.current
          .play()
          .catch(() => booth.notify('Tap “Hear partner” to enable their audio.'));
    }
  }, [state.remote, booth]);
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const render = async () => {
      if (stopped || !canvas.current || !room) return;
      const own = local.current,
        other = remote.current;
      const sources: [CanvasImageSource | null, CanvasImageSource | null] = [null, null];
      const bitmaps: ImageBitmap[] = [];
      try {
        const inputs = state.seat === 0 ? [own, other] : [other, own];
        for (let i = 0; i < inputs.length; i++) {
          const input = inputs[i];
          if (!input?.videoWidth || input.readyState < 2 || !room.members[i]?.camera) continue;
          if (state.cutting) {
            const bitmap = await booth.segmenter.cutout(
              input,
              480,
              Math.round((480 * input.videoHeight) / input.videoWidth),
            );
            sources[i] = bitmap;
            bitmaps.push(bitmap);
          } else sources[i] = input;
        }
        if (!stopped && canvas.current)
          drawScene(canvas.current, sources, room.scene, room.positions);
      } catch {
        if (!stopped) {
          booth.setCutting(false);
          booth.notify(
            'Background removal is unavailable right now. Your original background is visible. You can retry it below.',
          );
        }
      } finally {
        bitmaps.forEach((b) => b.close());
        if (!stopped)
          timer = setTimeout(
            () => {
              void render();
            },
            state.cutting ? 100 : 40,
          );
      }
    };
    void render();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [
    booth,
    room?.scene,
    room?.positions,
    room?.members,
    state.stream,
    state.remote,
    state.cutting,
    state.seat,
  ]);
  useEffect(() => {
    const update = () =>
      setRemaining(
        room?.capture
          ? Math.max(0, Math.ceil((room.capture.target - booth.serverNow()) / 1000))
          : 0,
      );
    update();
    const timer = setInterval(update, 80);
    return () => clearInterval(timer);
  }, [room?.capture?.id, booth]);
  const cap = room?.capture;
  return (
    <div className="stage-frame">
      <div className="stage-top">
        <span>THE TWO OF US</span>
        <span>{room ? 'PRIVATE BOOTH' : 'NO DISTANCE TOO FAR'}</span>
      </div>
      <div className="stage">
        <canvas ref={canvas} width={960} height={720} aria-label="Shared photo composition" />
        {!state.camera && (
          <div className="stage-empty">
            <div className="empty-mark">
              <Camera size={36} strokeWidth={1.3} />
            </div>
            <h2>{room ? 'Step into the frame.' : 'A little closer.'}</h2>
            <p>
              {room
                ? 'Turn on your camera to begin.'
                : 'Your own little booth, wherever you both are.'}
            </p>
            {room && (
              <button className="light-button" onClick={() => void booth.enableCamera()}>
                Turn on camera
              </button>
            )}
          </div>
        )}
        {state.camera && !state.connected && (
          <div className="waiting-note">
            <Heart size={15} />{' '}
            {room?.members[1] ? 'Connecting your cameras…' : 'Saving a spot for your person.'}
          </div>
        )}
        {cap && ['arming', 'countdown'].includes(cap.phase) && (
          <div className="countdown" role="status">
            {remaining > 3 ? (
              <span className="get-ready">Find your pose…</span>
            ) : (
              remaining || <span className="get-ready">Hold it!</span>
            )}
          </div>
        )}
        {cap?.phase === 'processing' && (
          <div className="developing" role="status">
            <span className="developing-dot" />
            Developing your photo…
          </div>
        )}
        <video className="source-video" ref={local} autoPlay playsInline muted aria-hidden="true" />
        <video className="source-video" ref={remote} autoPlay playsInline aria-hidden="true" />
      </div>
      <div className="stage-bottom">
        <span>
          {room?.members[0]?.name || 'YOU'} <span className="ampersand">&</span>{' '}
          {room?.members[1]?.name || 'YOUR PERSON'}
        </span>
        <span>01 / TOGETHER</span>
      </div>
      {state.remote && (
        <button
          className="audio-unlock"
          onClick={() =>
            void remote.current
              ?.play()
              .catch(() =>
                booth.notify('Your browser is still blocking audio. Check site permissions.'),
              )
          }
        >
          Hear partner
        </button>
      )}
    </div>
  );
}
