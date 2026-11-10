import type { DictationKeysWriter } from '../ports/dictation-keys-port';

// The dictation provider keys an operator stores on the agent machine, for every phone paired
// with it. Nothing here may put a key, or the file's text, into an error: errors reach logs and
// the phone.
export const DICTATION_PROVIDERS = ['elevenlabs', 'openrouter'] as const;
export type DictationProvider = (typeof DICTATION_PROVIDERS)[number];
export type DictationKeys = Partial<Record<DictationProvider, string>>;

const MAX_KEY_LENGTH = 512;

export function providerOf(name: string): DictationProvider | null {
  return (DICTATION_PROVIDERS as readonly string[]).includes(name) ? (name as DictationProvider) : null;
}

export function checkKey(raw: string): { ok: true; key: string } | { ok: false; error: string } {
  const key = raw.trim();
  if (key === '') return { ok: false, error: 'no key given' };
  if (/\s/.test(key)) return { ok: false, error: 'a key holds no whitespace' };
  if (key.length > MAX_KEY_LENGTH) return { ok: false, error: `a key is at most ${MAX_KEY_LENGTH} characters` };
  return { ok: true, key };
}

// 'malformed' carries no detail on purpose: JSON.parse's message quotes the text it read.
export function parseDictationKeys(raw: string): DictationKeys | 'malformed' {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return 'malformed';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'malformed';
  const keys: DictationKeys = {};
  for (const provider of DICTATION_PROVIDERS) {
    const candidate = (value as Record<string, unknown>)[provider];
    if (typeof candidate !== 'string') continue;
    const checked = checkKey(candidate);
    if (checked.ok) keys[provider] = checked.key;
  }
  return keys;
}

export function withKey(keys: DictationKeys, provider: DictationProvider, key: string): DictationKeys {
  return { ...keys, [provider]: key };
}

export function withoutKey(keys: DictationKeys, provider: DictationProvider): DictationKeys {
  const { [provider]: _removed, ...rest } = keys;
  return rest;
}

// Stores (`raw`) or removes (`null`) one provider's key, for `tarfa dictation-key` and for a
// phone's setDictationKey alike. An error is fixed wording and never holds the key.
export async function changeDictationKey(
  store: DictationKeysWriter,
  provider: DictationProvider,
  raw: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let key: string | null = null;
  if (raw !== null) {
    const checked = checkKey(raw);
    if (!checked.ok) return checked;
    key = checked.key;
  }
  const result = await store.update((keys) => (key === null ? withoutKey(keys, provider) : withKey(keys, provider, key)));
  return 'problem' in result ? { ok: false, error: result.problem } : { ok: true };
}
