import type { Decoration, Position, Scene } from '../shared/protocol';
import { blobFromCanvas } from './media';
export const colors = { rose: '#c9878d', cream: '#e8dbc1', blue: '#9daebb', curtain: '#692b3c' };

export function drawScene(
  canvas: HTMLCanvasElement,
  sources: [CanvasImageSource | null, CanvasImageSource | null],
  scene: Scene,
  positions: [Position, Position],
) {
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = colors[scene.background];
  ctx.fillRect(0, 0, w, h);
  if (scene.background === 'curtain') {
    for (let x = 0; x < w; x += w / 12) {
      const g = ctx.createLinearGradient(x, 0, x + w / 12, 0);
      g.addColorStop(0, '#00000038');
      g.addColorStop(0.65, '#ffffff08');
      g.addColorStop(1, '#00000028');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, w / 12, h);
    }
  }
  sources.forEach((source, i) => {
    if (!source) return;
    const p = positions[i];
    const size = source as {
      width?: number;
      height?: number;
      videoWidth?: number;
      videoHeight?: number;
    };
    const sw = size.videoWidth || size.width || w;
    const sh = size.videoHeight || size.height || h;
    const scale = (h / sh) * p.scale;
    const dw = sw * scale;
    const dh = sh * scale;
    const center =
      (scene.layout === 'overlap' ? (i === 0 ? 0.42 : 0.63) : i === 0 ? 0.28 : 0.72) + p.x;
    const top = h - dh + p.y * h - (scene.layout === 'overlap' && i === 0 ? 0.08 * h : 0);
    ctx.save();
    ctx.translate(center * w, top);
    ctx.scale(-1, 1);
    ctx.drawImage(source, -dw / 2, 0, dw, dh);
    ctx.restore();
  });
  // Pixel math keeps effects consistent on browsers without Canvas filter support.
  if (scene.effect !== 'original') {
    const image = ctx.getImageData(0, 0, w, h);
    const pixels = image.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i],
        g = pixels[i + 1],
        b = pixels[i + 2];
      if (scene.effect === 'mono') {
        const gray = (0.2126 * r + 0.7152 * g + 0.0722 * b - 128) * 1.08 + 128;
        pixels[i] = gray;
        pixels[i + 1] = gray;
        pixels[i + 2] = gray;
      } else {
        pixels[i] = r * 0.93 + g * 0.1 + 5;
        pixels[i + 1] = g * 0.94 + r * 0.04 + 3;
        pixels[i + 2] = b * 0.84 + g * 0.06 + 2;
      }
    }
    ctx.putImageData(image, 0, 0);
  }
}
export function drawDecorations(
  ctx: CanvasRenderingContext2D,
  decorations: Decoration[],
  w: number,
  h: number,
) {
  for (const item of decorations) {
    ctx.save();
    ctx.fillStyle = item.color;
    ctx.strokeStyle = item.color;
    ctx.lineWidth = w * 0.006;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (item.kind === 'stroke') {
      ctx.beginPath();
      item.points.forEach((p, i) =>
        i === 0 ? ctx.moveTo(p.x * w, p.y * h) : ctx.lineTo(p.x * w, p.y * h),
      );
      ctx.stroke();
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${item.kind === 'sticker' ? w * 0.09 : w * 0.042}px ${item.kind === 'sticker' ? 'sans-serif' : 'Georgia'}`;
      ctx.fillText(item.text, item.x * w, item.y * h, w * 0.85);
    }
    ctx.restore();
  }
}
export async function decoratePhoto(blob: Blob, decorations: Decoration[]) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  drawDecorations(ctx, decorations, canvas.width, canvas.height);
  return canvas;
}
export async function makeStrip(
  photos: { blob: Blob; decorations: Decoration[]; created: number }[],
  scene: Scene,
) {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  const margin = 60,
    gap = 28,
    frameHeight = 660;
  canvas.height = margin * 2 + photos.length * (frameHeight + gap) + 90;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = scene.border === 'cherry' ? '#761c2c' : '#fff6e5';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < photos.length; i++) {
    const photo = await decoratePhoto(photos[i].blob, photos[i].decorations);
    ctx.drawImage(photo, margin, margin + i * (frameHeight + gap), 880, frameHeight);
  }
  if (scene.finish === 'paper') {
    for (let i = 0; i < 11000; i++) {
      const x = (i * 137.13) % canvas.width,
        y = (i * 71.71) % canvas.height;
      ctx.fillStyle = i % 2 ? '#ffffff0b' : '#00000007';
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }
  ctx.fillStyle = scene.border === 'cherry' ? '#fff6e5' : '#761c2c';
  ctx.textAlign = 'center';
  ctx.font = '28px Georgia';
  ctx.fillText('KD PHOTO BOOTH', 500, canvas.height - 65);
  if (scene.finish === 'dated') {
    ctx.font = '20px sans-serif';
    ctx.fillText(new Date(photos[0].created).toISOString().slice(0, 10), 500, canvas.height - 30);
  }
  return blobFromCanvas(canvas);
}
export async function saveImage(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type });
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'KD Photo Booth' });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
