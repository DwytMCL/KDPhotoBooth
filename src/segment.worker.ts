import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

let segmenter: ImageSegmenter;
const ready = (async () => {
  const files = await FilesetResolver.forVisionTasks('/wasm');
  segmenter = await ImageSegmenter.createFromOptions(files, {
    baseOptions: { modelAssetPath: '/models/selfie_segmenter.tflite', delegate: 'CPU' },
    runningMode: 'IMAGE',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
})();
self.onmessage = async (event: MessageEvent<{ id: number; bitmap: ImageBitmap }>) => {
  const { id, bitmap } = event.data;
  try {
    await ready;
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const result = segmenter.segment(bitmap);
    const mask = result.confidenceMasks?.[0];
    if (!mask) throw new Error('No person mask returned');
    const values = mask.getAsFloat32Array();
    const maskCanvas = new OffscreenCanvas(mask.width, mask.height);
    const maskCtx = maskCanvas.getContext('2d')!;
    const pixels = maskCtx.createImageData(mask.width, mask.height);
    for (let i = 0; i < values.length; i++) {
      pixels.data[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, (values[i] - 0.15) / 0.7)) * 255);
    }
    maskCtx.putImageData(pixels, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(maskCanvas, 0, 0, bitmap.width, bitmap.height);
    result.close();
    const output = canvas.transferToImageBitmap();
    self.postMessage({ id, bitmap: output }, { transfer: [output] });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : 'Background removal failed',
    });
  } finally {
    bitmap.close();
  }
};
