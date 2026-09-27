import { build } from 'esbuild';
await build({
  entryPoints: ['src/segment.worker.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'public/segment.worker.js',
  minify: true,
});
