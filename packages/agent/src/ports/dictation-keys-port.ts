import type { DictationKeys } from '../application/dictation-keys';

export interface DictationKeysPort {
  // The keys the operator stored, for an authenticated phone that asked. Empty when there are
  // none, or when the file cannot be trusted (malformed, or open to other users).
  read(): Promise<DictationKeys>;
}
