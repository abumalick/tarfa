import type { DictationKeys } from '../application/dictation-keys';

export interface DictationKeysPort {
  // The keys the operator stored, for an authenticated phone that asked. Empty when there are
  // none, or when the file cannot be trusted (malformed, or open to other users).
  read(): Promise<DictationKeys>;
}

export interface DictationKeysWriter {
  // Applies `change` to the stored keys and writes them, never interleaved with another writer
  // (the agent and the `tarfa` CLI are different processes). A file that cannot be trusted is
  // left alone and its problem returned.
  update(change: (keys: DictationKeys) => DictationKeys): Promise<{ ok: true } | { problem: string }>;
}
