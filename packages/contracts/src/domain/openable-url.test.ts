import { describe, expect, it } from 'vitest';
import { MAX_OPENABLE_URL_LENGTH, isOpenableUrl } from './openable-url';

describe('isOpenableUrl', () => {
  it('accepts http and https pages', () => {
    expect(isOpenableUrl('https://claude.ai/code/artifact/3f2a')).toBe(true);
    expect(isOpenableUrl('http://example.com/a?b=c#d')).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'intent://scan#Intent;scheme=zxing;end',
    'file:///etc/passwd',
    'about:blank',
    'not a url',
    '',
  ])('refuses %s', (url) => {
    expect(isOpenableUrl(url)).toBe(false);
  });

  it('refuses a URL with credentials, which can disguise its host', () => {
    expect(isOpenableUrl('https://claude.ai@evil.example/')).toBe(false);
    expect(isOpenableUrl('https://user:pass@example.com/')).toBe(false);
  });

  it('refuses one longer than the cap', () => {
    const base = 'https://example.com/';
    expect(isOpenableUrl(base + 'a'.repeat(MAX_OPENABLE_URL_LENGTH - base.length))).toBe(true);
    expect(isOpenableUrl(base + 'a'.repeat(MAX_OPENABLE_URL_LENGTH - base.length + 1))).toBe(false);
  });

  it('refuses whitespace and control characters a parser would quietly strip', () => {
    expect(isOpenableUrl('https://example.com/a b')).toBe(false);
    expect(isOpenableUrl('https://example.com/\n')).toBe(false);
    expect(isOpenableUrl(' https://example.com/')).toBe(false);
  });
});
