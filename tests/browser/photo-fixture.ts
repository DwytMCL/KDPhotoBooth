import type { Page } from '@playwright/test';

// Test-only prerecorded fictional people. The normal app never replaces a camera.
// Keep a real synthetic audio track and real canvas/video/WebRTC processing.
export async function usePhotoCamera(page: Page, half: 0 | 1) {
  await page.addInitScript((side) => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      if (!constraints?.video) return stream;
      const image = new Image();
      image.src = '/pose-sheet.png';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 960;
      const ctx = canvas.getContext('2d')!;
      const draw = () =>
        ctx.drawImage(
          image,
          (side * image.naturalWidth) / 8,
          0,
          image.naturalWidth / 8,
          image.naturalHeight / 2,
          0,
          0,
          640,
          960,
        );
      draw();
      const timer = setInterval(draw, 33);
      const video = canvas.captureStream(30).getVideoTracks()[0];
      const stop = video.stop.bind(video);
      video.stop = () => {
        clearInterval(timer);
        stop();
      };
      stream.getVideoTracks().forEach((track) => {
        track.stop();
        stream.removeTrack(track);
      });
      stream.addTrack(video);
      return stream;
    };
  }, half);
}
