const ALPHABET = new TextEncoder().encode('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/');
const PAD = 61; // '='

// Encodes into ASCII bytes and decodes them once: building a binary string for btoa one byte
// at a time took over a second for a 20 MB upload, on the main thread.
export function bytesToBase64(bytes: Uint8Array): string {
  const out = new Uint8Array(4 * Math.ceil(bytes.length / 3));
  const whole = bytes.length - (bytes.length % 3);
  let o = 0;
  let i = 0;
  for (; i < whole; i += 3) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out[o++] = ALPHABET[v >> 18]!;
    out[o++] = ALPHABET[(v >> 12) & 63]!;
    out[o++] = ALPHABET[(v >> 6) & 63]!;
    out[o++] = ALPHABET[v & 63]!;
  }
  const rest = bytes.length - whole;
  if (rest) {
    const v = (bytes[i]! << 16) | (rest === 2 ? bytes[i + 1]! << 8 : 0);
    out[o++] = ALPHABET[v >> 18]!;
    out[o++] = ALPHABET[(v >> 12) & 63]!;
    out[o++] = rest === 2 ? ALPHABET[(v >> 6) & 63]! : PAD;
    out[o++] = PAD;
  }
  return new TextDecoder().decode(out);
}
