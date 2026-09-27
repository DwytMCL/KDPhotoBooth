export class Segmenter {
  // MediaPipe loads its WASM glue through importScripts; keep a classic bundled
  // worker in both development and production rather than Vite's dev ESM worker.
  private worker = new Worker('/segment.worker.js');
  private counter = 0;
  private failed = false;
  private pending = new Map<
    number,
    {
      resolve: (image: ImageBitmap) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor() {
    this.worker.onmessage = (
      event: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>,
    ) => {
      const request = this.pending.get(event.data.id);
      if (!request) {
        event.data.bitmap?.close();
        return;
      }
      clearTimeout(request.timer);
      this.pending.delete(event.data.id);
      if (event.data.bitmap) request.resolve(event.data.bitmap);
      else request.reject(new Error(event.data.error || 'Background removal failed'));
    };
    this.worker.onerror = () => {
      this.failed = true;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Background removal could not start on this browser.'));
      }
      this.pending.clear();
    };
  }
  async cutout(source: CanvasImageSource, width: number, height: number) {
    if (this.failed) throw new Error('Background removal could not start. Reload to retry.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(source, 0, 0, width, height);
    const bitmap = await createImageBitmap(canvas);
    const id = ++this.counter;
    return new Promise<ImageBitmap>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Background removal took too long. Try again.'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, bitmap }, [bitmap]);
    });
  }
  close() {
    this.worker.terminate();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Session ended'));
    }
    this.pending.clear();
  }
}

export const blobFromCanvas = (canvas: HTMLCanvasElement, type = 'image/png') =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not export image.'))),
      type,
      0.95,
    ),
  );
export async function captureLocal(video: HTMLVideoElement, target: number) {
  if (!video.videoWidth || document.hidden)
    throw new Error('Keep the camera visible to take a photo.');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Camera frame did not arrive.')), 3000);
    if ('requestVideoFrameCallback' in video)
      video.requestVideoFrameCallback(() => {
        clearTimeout(timer);
        resolve();
      });
    else
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
  });
  const captured = performance.now();
  if (Math.abs(captured - target) > 350)
    throw new Error('The shutter was delayed. Please retake this photo.');
  const canvas = document.createElement('canvas');
  const ratio = Math.min(1, 1920 / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * ratio);
  canvas.height = Math.round(video.videoHeight * ratio);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return { canvas, captured };
}
