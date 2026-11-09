import { describe, it, expect } from 'vitest';
import { speakableChunks, MAX_CHUNK_CHARS } from './speakable';

describe('speakableChunks', () => {
  it('splits prose into sentences', () => {
    expect(speakableChunks('First one. Second one! Third?')).toEqual(['First one.', 'Second one!', 'Third?']);
  });

  it('reads markdown content without its syntax', () => {
    const reply = [
      '## Summary',
      '',
      'The fix is **done** and `pnpm test` passes. See [the docs](https://example.com/x).',
      '',
      '- first point',
      '* second point',
      '> quoted',
      '---',
      '```ts',
      'const a = 1;',
      '```',
    ].join('\n');
    expect(speakableChunks(reply)).toEqual([
      'Summary',
      'The fix is done and pnpm test passes.',
      'See the docs.',
      'first point',
      'second point',
      'quoted',
      'const a = 1;',
    ]);
  });

  it('reads a table row by row, dropping its separator', () => {
    expect(speakableChunks('| File | Change |\n|---|:---:|\n| a.ts | new |')).toEqual(['File, Change', 'a.ts, new']);
  });

  it('keeps underscores in identifiers', () => {
    expect(speakableChunks('Call __init__ and snake_case.')).toEqual(['Call __init__ and snake_case.']);
  });

  it('cuts a very long sentence at spaces', () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const chunks = speakableChunks(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= MAX_CHUNK_CHARS)).toBe(true);
    expect(chunks.join(' ')).toBe(long);
  });

  it('has nothing to say for blank text', () => {
    expect(speakableChunks(' \n\n ')).toEqual([]);
  });
});
