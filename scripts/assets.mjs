import { mkdir, cp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await mkdir('public/models', { recursive: true });
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/wasm', { recursive: true });
const response = await fetch(
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
);
if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
if (
  createHash('sha256').update(bytes).digest('hex') !==
  '191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b'
)
  throw new Error('Model integrity check failed.');
await writeFile('public/models/selfie_segmenter.tflite', bytes);
console.log('Local segmentation assets ready; runtime inference does not call Google.');
