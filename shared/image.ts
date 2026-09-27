// Validate dimensions before asking the browser decoder to allocate pixel memory.
export function validPngHeader(bytes: Uint8Array, width: number, height: number) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || signature.some((value, i) => bytes[i] !== value)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (
    view.getUint32(8) === 13 &&
    view.getUint32(12) === 0x49484452 &&
    width >= 1 &&
    width <= 4096 &&
    height >= 1 &&
    height <= 4096 &&
    view.getUint32(16) === width &&
    view.getUint32(20) === height
  );
}
