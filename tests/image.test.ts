import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validPngHeader } from '../shared/image';

test('reject oversized, mismatched or non-PNG image headers before decoding', () => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  view.setUint32(12, 0x49484452);
  view.setUint32(16, 1600);
  view.setUint32(20, 1200);
  assert.equal(validPngHeader(bytes, 1600, 1200), true);
  assert.equal(validPngHeader(bytes, 800, 600), false);
  view.setUint32(16, 50000);
  assert.equal(validPngHeader(bytes, 50000, 1200), false);
  bytes[0] = 0;
  assert.equal(validPngHeader(bytes, 1600, 1200), false);
  assert.equal(validPngHeader(new Uint8Array(), 1600, 1200), false);
});
