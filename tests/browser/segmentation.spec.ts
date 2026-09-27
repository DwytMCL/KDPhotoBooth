import { test, expect } from '@playwright/test';

test('real local segmentation removes background and retains a person', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/media.ts';
    const { Segmenter } = await import(/* @vite-ignore */ path);
    const image = new Image();
    image.src = '/pose-sheet.png';
    await image.decode();
    const input = document.createElement('canvas');
    input.width = 443;
    input.height = 443;
    input
      .getContext('2d')!
      .drawImage(image, 0, 0, image.naturalWidth / 4, image.naturalHeight / 2, 0, 0, 443, 443);
    const segmenter = new Segmenter();
    try {
      const bitmap = await segmenter.cutout(input, 443, 443);
      const output = document.createElement('canvas');
      output.width = 443;
      output.height = 443;
      const ctx = output.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = ctx.getImageData(0, 0, 443, 443).data;
      let transparent = 0,
        opaque = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] < 20) transparent++;
        if (pixels[i] > 230) opaque++;
      }
      return { transparent, opaque, total: pixels.length / 4 };
    } finally {
      segmenter.close();
    }
  });
  expect(result.transparent / result.total).toBeGreaterThan(0.08);
  expect(result.opaque / result.total).toBeGreaterThan(0.25);
});
