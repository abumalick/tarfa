// A pairing code: what a pairing link carries (`PairingLink`), as one opaque string the owner
// pastes or scans inside an installed app. A link looks like something to open, and opened outside
// the app it pairs nothing; a code looks like nothing but itself.
//
// `TARFA` + Crockford base32 (upper case: a QR code holds it in its denser alphanumeric mode, and a
// double-click selects it whole) of:
//   version (1) | agent key (32) | secret (32) | name | default path | address count (1) | addresses
//   | the first 4 bytes of the SHA-256 of everything before them
// where name, path and each address are a 2-byte big-endian length and UTF-8, the path empty when
// there is none, and an address is a scheme byte (0 wss, 1 ws) and what follows `<scheme>://`.
import { sha256 } from '@noble/hashes/sha2.js';
import { b64url } from './keys';
import { isMachineUrl, isPairingPath, MAX_ADDRESSES, type PairingLink } from './pairing-link';

const PREFIX = 'TARFA';
const VERSION = 1;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_BYTES = 32;
const CHECKSUM_BYTES = 4;
const MAX_NAME = 64;
const SCHEMES = ['wss://', 'ws://'];

export type PairingCodeRead = { ok: true; pairing: PairingLink } | { ok: false; reason: 'invalid' | 'newer' };

export function pairingCode(pairing: PairingLink): string {
  const out: number[] = [VERSION, ...rawKey(pairing.agentKey), ...rawKey(pairing.secret)];
  const text = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length > 0xffff) throw new Error('pairing code field too long');
    out.push(bytes.length >> 8, bytes.length & 0xff, ...bytes);
  };
  text(pairing.name);
  text(pairing.defaultPath ?? '');
  out.push(pairing.urls.length);
  for (const url of pairing.urls) {
    const scheme = SCHEMES.findIndex((s) => url.startsWith(s));
    if (scheme < 0) throw new Error(`not a machine address: ${url}`);
    out.push(scheme);
    text(url.slice(SCHEMES[scheme]!.length));
  }
  const body = Uint8Array.from(out);
  const code = PREFIX + encode32(Uint8Array.from([...body, ...sha256(body).slice(0, CHECKSUM_BYTES)]));
  // A code the phone would refuse must never be handed out.
  if (!parsePairingCode(code).ok) throw new Error('these pairing details do not make a valid pairing code');
  return code;
}

function rawKey(key: string): Uint8Array {
  const bytes = /^[A-Za-z0-9_-]{43}$/.test(key) ? b64url.decode(key) : new Uint8Array();
  // A non-canonical spelling would come back from the phone spelled otherwise.
  if (bytes.length !== KEY_BYTES || b64url.encode(bytes) !== key) throw new Error('a pairing key must be 32 bytes, canonically encoded');
  return bytes;
}

// Whitespace anywhere is ignored (a terminal or a chat app wraps a long code), and so is case.
// Anything else that is not exactly a code this app can read is refused, whole.
export function parsePairingCode(text: string): PairingCodeRead {
  const invalid = { ok: false, reason: 'invalid' } as const;
  const compact = text.replace(/\s+/g, '').toUpperCase();
  if (!compact.startsWith(PREFIX)) return invalid;
  const bytes = decode32(compact.slice(PREFIX.length));
  if (!bytes || bytes.length < 1 + CHECKSUM_BYTES) return invalid;
  // A newer app's code may be laid out, and checksummed, differently.
  if (bytes[0]! > VERSION) return { ok: false, reason: 'newer' };
  const body = bytes.slice(0, -CHECKSUM_BYTES);
  const sum = sha256(body);
  if (!bytes.slice(-CHECKSUM_BYTES).every((b, i) => b === sum[i])) return invalid;
  if (body[0] !== VERSION) return invalid;
  const pairing = readBody(body);
  return pairing ? { ok: true, pairing } : invalid;
}

function readBody(body: Uint8Array): PairingLink | null {
  let at = 1;
  const take = (n: number): Uint8Array | null => {
    if (at + n > body.length) return null;
    at += n;
    return body.slice(at - n, at);
  };
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const text = (): string | null => {
    const length = take(2);
    const bytes = length && take((length[0]! << 8) | length[1]!);
    if (!bytes) return null;
    try {
      return decoder.decode(bytes);
    } catch {
      return null;
    }
  };
  const agentKey = take(KEY_BYTES);
  const secret = take(KEY_BYTES);
  const rawName = text();
  const path = text();
  const count = take(1)?.[0];
  if (!agentKey || !secret || rawName === null || path === null || count === undefined) return null;
  if (count === 0 || count > MAX_ADDRESSES) return null;
  const urls: string[] = [];
  for (let i = 0; i < count; i++) {
    const scheme = SCHEMES[take(1)?.[0] ?? -1];
    const rest = text();
    if (!scheme || rest === null || !isMachineUrl(scheme + rest)) return null;
    urls.push(scheme + rest);
  }
  if (at !== body.length) return null;
  // The same name rule as the link's.
  const name = rawName.trim() || 'machine';
  if (name.length > MAX_NAME) return null;
  return {
    urls,
    agentKey: b64url.encode(agentKey),
    secret: b64url.encode(secret),
    name,
    // A path the phone cannot use costs the path, not the pairing.
    ...(isPairingPath(path) ? { defaultPath: path } : {}),
  };
}

function encode32(bytes: Uint8Array): string {
  let out = '';
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? out + ALPHABET[(value << (5 - bits)) & 31] : out;
}

// Null for a character outside the alphabet, a length no byte string encodes to, or padding bits
// that are not zero: each byte string has exactly one spelling.
function decode32(text: string): Uint8Array | null {
  const out: number[] = [];
  let value = 0;
  let bits = 0;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) return null;
    value = ((value << 5) | digit) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bits >= 5 || (value & ((1 << bits) - 1)) !== 0) return null;
  return Uint8Array.from(out);
}
