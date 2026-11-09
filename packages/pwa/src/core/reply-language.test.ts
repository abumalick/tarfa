import { describe, it, expect } from 'vitest';
import { replyLanguage } from './reply-language';

describe('replyLanguage', () => {
  it('hears English', () => {
    expect(replyLanguage('The tests pass and the branch is merged. Nothing is left to do.', 'fr')).toBe('en');
  });

  it('hears French', () => {
    expect(replyLanguage('Les tests passent et la branche est fusionnée. Il ne reste rien à faire.', 'en')).toBe('fr');
  });

  it('hears Arabic from its script', () => {
    expect(replyLanguage('تم الانتهاء من العمل وكل الاختبارات ناجحة. `pnpm test`', 'en')).toBe('ar');
  });

  it('keeps the fallback when nothing tells', () => {
    expect(replyLanguage('`pnpm -s test` → 42 ✓', 'fr')).toBe('fr');
  });
});
