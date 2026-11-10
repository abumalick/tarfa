import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { b64url } from './keys';
import { generatePairingSecret, MAX_ADDRESSES, type PairingLink } from './pairing-link';
import { pairingCode, parsePairingCode } from './pairing-code';

const pairing: PairingLink = {
  urls: ['wss://box.example-tail.ts.net:10000/abcDEF_123-xyz', 'ws://127.0.0.1:8797/'],
  agentKey: b64url.encode(new Uint8Array(32).fill(7)),
  secret: generatePairingSecret(),
  name: 'dev box',
  defaultPath: '/home/user/workspace',
};

// The code's body, re-encoded with a fresh checksum: what a malformed but well-checksummed code is.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function encode32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits ? out + ALPHABET[(value << (5 - bits)) & 31] : out;
}
function decode32(text: string): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text) {
    value = ((value << 5) | ALPHABET.indexOf(char)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}
const withChecksum = (body: Uint8Array) => 'TARFA' + encode32(Uint8Array.from([...body, ...sha256(body).slice(0, 4)]));
const bodyOf = (code: string) => decode32(code.slice(5)).slice(0, -4);

describe('pairing code', () => {
  it('round-trips everything a pairing link carries', () => {
    expect(parsePairingCode(pairingCode(pairing))).toEqual({ ok: true, pairing });
    const { defaultPath: _, ...noPath } = pairing;
    expect(parsePairingCode(pairingCode(noPath))).toEqual({ ok: true, pairing: noPath });
  });

  it('is one opaque run of letters and digits, recognisably Tarfa’s', () => {
    const code = pairingCode(pairing);
    expect(code).toMatch(/^TARFA[0-9A-HJKMNP-TV-Z]+$/);
    expect(code).not.toContain('ts.net');
    expect(code).not.toContain(pairing.secret);
  });

  it('survives wrapping, stray whitespace and lower case', () => {
    const code = pairingCode(pairing);
    const wrapped = `  ${code.slice(0, 40)}\n${code.slice(40, 90)} \r\n\t${code.slice(90)}\n`;
    expect(parsePairingCode(wrapped)).toEqual({ ok: true, pairing });
    expect(parsePairingCode(code.toLowerCase())).toEqual({ ok: true, pairing });
  });

  // isMachineUrl takes a scheme in any case, so tarfa pair may be handed one.
  it('takes an upper-case scheme', () => {
    const read = parsePairingCode(pairingCode({ ...pairing, urls: ['WSS://box.example/abu'] }));
    expect(read.ok && read.pairing.urls).toEqual(['wss://box.example/abu']);
  });

  it('keeps a non-ASCII name and path', () => {
    const named = { ...pairing, name: 'مكتب é', defaultPath: '/home/ü/项目' };
    expect(parsePairingCode(pairingCode(named))).toEqual({ ok: true, pairing: named });
  });

  it('refuses a mistyped, truncated or extended code', () => {
    const code = pairingCode(pairing);
    const i = 30;
    const typo = code.slice(0, i) + (code[i] === '0' ? '1' : '0') + code.slice(i + 1);
    for (const bad of [typo, code.slice(0, -1), code.slice(0, -8), code + '0', code + '00000000', 'TARFA', '', 'hello']) {
      expect(parsePairingCode(bad)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('refuses characters outside the alphabet and a non-zero tail', () => {
    const code = pairingCode(pairing);
    expect(parsePairingCode(code.slice(0, 20) + 'U' + code.slice(21))).toEqual({ ok: false, reason: 'invalid' });
    expect(parsePairingCode(code.slice(0, 20) + '-' + code.slice(20))).toEqual({ ok: false, reason: 'invalid' });
    expect(parsePairingCode('XARFA' + code.slice(5))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('tells a code from a newer app apart from a broken one', () => {
    const body = bodyOf(pairingCode(pairing));
    body[0] = 2;
    expect(parsePairingCode(withChecksum(body))).toEqual({ ok: false, reason: 'newer' });
    body[0] = 0;
    expect(parsePairingCode(withChecksum(body))).toEqual({ ok: false, reason: 'invalid' });
    body[0] = 200;
    expect(parsePairingCode(withChecksum(body))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses trailing bytes behind a valid checksum', () => {
    const body = bodyOf(pairingCode(pairing));
    expect(parsePairingCode(withChecksum(Uint8Array.from([...body, 0])))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('validates its addresses, name and path as strictly as the link does', () => {
    const tooMany = { ...pairing, urls: Array(MAX_ADDRESSES + 1).fill('wss://box.example') };
    const refused: PairingLink[] = [
      { ...pairing, urls: [] },
      tooMany,
      { ...pairing, urls: ['ws://box.example'] },
      { ...pairing, urls: ['wss://box.example/a/b'] },
      { ...pairing, name: 'x'.repeat(65) },
      { ...pairing, agentKey: 'short' },
      { ...pairing, secret: 'short' },
    ];
    for (const p of refused) expect(() => pairingCode(p)).toThrow();
  });

  it('drops a default path the phone cannot use and keeps the pairing', () => {
    const body = bodyOf(pairingCode({ ...pairing, defaultPath: 'relative/xx' }));
    const parsed = parsePairingCode(withChecksum(body));
    expect(parsed).toEqual({ ok: true, pairing: { ...pairing, defaultPath: undefined } });
  });

  it('names a blank machine "machine", as the link does', () => {
    const body = bodyOf(pairingCode({ ...pairing, name: '   ' }));
    const parsed = parsePairingCode(withChecksum(body));
    expect(parsed.ok && parsed.pairing.name).toBe('machine');
  });
});
