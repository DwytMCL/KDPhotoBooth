import { useEffect, useRef, useState } from 'react';
import { Heart, Pencil, Type, Undo2, X, Download, Move } from 'lucide-react';
import type { Booth } from './booth';
import type { Decoration, Shot } from '../shared/protocol';
import { decoratePhoto, drawDecorations, saveImage } from './render';
import { blobFromCanvas } from './media';

export function Decorate({
  booth,
  shot,
  blob,
  close,
}: {
  booth: Booth;
  shot: Shot;
  blob: Blob;
  close: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [tool, setTool] = useState<'move' | 'stroke'>('move');
  const [caption, setCaption] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [color, setColor] = useState<Decoration['color']>('#ffffff');
  const gesture = useRef<Decoration | null>(null);
  const baseImage = useRef<ImageBitmap | null>(null);
  useEffect(() => {
    let active = true;
    void createImageBitmap(blob).then((image) => {
      if (active) baseImage.current = image;
      else image.close();
    });
    return () => {
      active = false;
      baseImage.current?.close();
      baseImage.current = null;
    };
  }, [blob]);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let active = true;
    void decoratePhoto(blob, shot.decorations).then((image) => {
      if (active && canvas.current) {
        canvas.current.width = image.width;
        canvas.current.height = image.height;
        canvas.current.getContext('2d')!.drawImage(image, 0, 0);
      }
    });
    return () => {
      active = false;
    };
  }, [blob, shot.decorations]);
  const add = (kind: 'text' | 'sticker', text: string) => {
    if (!text.trim()) return;
    booth.send({
      type: 'decorate',
      shot: shot.id,
      decoration: {
        id: crypto.randomUUID(),
        kind,
        text: text.trim(),
        x: kind === 'sticker' ? 0.85 : 0.5,
        y: kind === 'sticker' ? 0.15 : 0.84,
        color,
        points: [],
      },
    });
    setTool('move');
    setCaption('');
  };
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };
  return (
    <dialog
      ref={dialog}
      className="decoration-dialog"
      onCancel={close}
      aria-labelledby="decorate-title"
    >
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">A LITTLE PERSONAL TOUCH</span>
          <h2 id="decorate-title">Make it yours.</h2>
        </div>
        <button className="icon-button" aria-label="Close decorations" onClick={close}>
          <X />
        </button>
      </div>
      <p className="muted">Both of you can edit. Drag a caption or sticker to move it.</p>
      <canvas
        ref={canvas}
        className="decoration-canvas"
        aria-label="Photo decoration canvas"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const p = point(event);
          if (tool === 'stroke')
            gesture.current = {
              id: crypto.randomUUID(),
              kind: 'stroke',
              text: '',
              ...p,
              color,
              points: [p],
            };
          else {
            const item = [...shot.decorations]
              .reverse()
              .find(
                (d) =>
                  d.kind !== 'stroke' && Math.abs(d.x - p.x) < 0.18 && Math.abs(d.y - p.y) < 0.1,
              );
            gesture.current = item ? { ...item, ...p } : null;
          }
        }}
        onPointerMove={(event) => {
          const item = gesture.current;
          if (!item) return;
          const p = point(event);
          if (item.kind === 'stroke') {
            const previous = item.points[item.points.length - 1];
            if (item.points.length >= 250 || Math.hypot(previous.x - p.x, previous.y - p.y) < 0.003)
              return;
            item.points.push(p);
            const ctx = event.currentTarget.getContext('2d')!;
            ctx.strokeStyle = color;
            ctx.lineWidth = event.currentTarget.width * 0.006;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(
              previous.x * event.currentTarget.width,
              previous.y * event.currentTarget.height,
            );
            ctx.lineTo(p.x * event.currentTarget.width, p.y * event.currentTarget.height);
            ctx.stroke();
          } else {
            item.x = p.x;
            item.y = p.y;
            if (baseImage.current) {
              const target = event.currentTarget;
              const ctx = target.getContext('2d')!;
              ctx.drawImage(baseImage.current, 0, 0);
              drawDecorations(
                ctx,
                [...shot.decorations.filter((d) => d.id !== item.id), item],
                target.width,
                target.height,
              );
            }
          }
        }}
        onPointerUp={() => {
          const item = gesture.current;
          gesture.current = null;
          if (item) booth.send({ type: 'decorate', shot: shot.id, decoration: item });
        }}
        onPointerCancel={() => {
          gesture.current = null;
        }}
      />
      <div className="decoration-tools">
        <button
          className={tool === 'move' ? 'selected' : ''}
          aria-pressed={tool === 'move'}
          onClick={() => setTool('move')}
        >
          <Move size={16} />
          Move
        </button>
        <button
          className={tool === 'stroke' ? 'selected' : ''}
          aria-pressed={tool === 'stroke'}
          onClick={() => setTool('stroke')}
        >
          <Pencil size={16} />
          Draw
        </button>
        <button onClick={() => add('sticker', '♥')}>
          <Heart size={16} />
          Heart
        </button>
        <button onClick={() => add('sticker', '✦')}>✦ Star</button>
        <label>
          Ink
          <select
            aria-label="Decoration color"
            value={color}
            onChange={(e) => setColor(e.target.value as Decoration['color'])}
          >
            <option value="#ffffff">White</option>
            <option value="#761c2c">Cherry</option>
            <option value="#edb55a">Gold</option>
            <option value="#222222">Ink</option>
          </select>
        </label>
        <button
          disabled={!shot.decorations.length}
          onClick={() =>
            booth.send({ type: 'erase', shot: shot.id, id: shot.decorations.at(-1)!.id })
          }
        >
          <Undo2 size={16} />
          Remove last
        </button>
      </div>
      <form
        className="caption-form"
        onSubmit={(e) => {
          e.preventDefault();
          add('text', caption);
        }}
      >
        <input
          aria-label="Photo caption"
          maxLength={60}
          placeholder="Something just for the two of you…"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
        <button type="submit" disabled={!caption.trim()}>
          <Type size={16} />
          Add caption
        </button>
      </form>
      <div className="decoration-items">
        {shot.decorations
          .filter((d) => d.kind !== 'stroke')
          .map((item) => (
            <div key={item.id}>
              <span>{item.text}</span>
              <button
                aria-label={`Move ${item.text} left`}
                onClick={() =>
                  booth.send({
                    type: 'decorate',
                    shot: shot.id,
                    decoration: { ...item, x: Math.max(0, item.x - 0.05) },
                  })
                }
              >
                ←
              </button>
              <button
                aria-label={`Move ${item.text} right`}
                onClick={() =>
                  booth.send({
                    type: 'decorate',
                    shot: shot.id,
                    decoration: { ...item, x: Math.min(1, item.x + 0.05) },
                  })
                }
              >
                →
              </button>
              <button
                aria-label={`Remove ${item.text}`}
                onClick={() => booth.send({ type: 'erase', shot: shot.id, id: item.id })}
              >
                <X size={14} />
              </button>
            </div>
          ))}
      </div>
      {saveError && (
        <p className="save-error" role="alert">
          {saveError}
        </p>
      )}
      <button
        className="primary"
        disabled={saving}
        onClick={() => {
          setSaving(true);
          setSaveError('');
          void decoratePhoto(blob, shot.decorations)
            .then(blobFromCanvas)
            .then((b) => saveImage(b, 'kdphotobooth-photo.png'))
            .catch(() => setSaveError('Could not save this photo. Please try again.'))
            .finally(() => setSaving(false));
        }}
      >
        <Download size={17} />
        {saving ? 'Preparing…' : 'Save this photo'}
      </button>
    </dialog>
  );
}
