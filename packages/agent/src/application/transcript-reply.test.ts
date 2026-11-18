import { describe, expect, it } from 'vitest';
import { lastReplyInTranscript } from './transcript-reply';

const assistant = (id: string, stop: string | null, content: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', isSidechain: false, message: { id, stop_reason: stop, content }, ...extra });
const text = (t: string) => ({ type: 'text', text: t });
const user = (t: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: t } });

describe('lastReplyInTranscript', () => {
  // Claude Code's rule: the last assistant line's text blocks, joined by a newline and trimmed.
  it('returns the text of the last line that ended a turn, as the Stop hook builds it', () => {
    const lines = [
      user('first'),
      assistant('m1', 'end_turn', [text('Old reply.')]),
      user('second'),
      assistant('m2', 'tool_use', [{ type: 'thinking', thinking: 'hm' }]),
      assistant('m2', 'tool_use', [{ type: 'tool_use', id: 't', name: 'Read', input: {} }]),
      assistant('m3', 'end_turn', [{ type: 'thinking', thinking: 'ok' }]),
      assistant('m3', 'end_turn', [text('An earlier block.')]),
      assistant('m3', 'end_turn', [text('  First paragraph.'), text('Second paragraph.\n')]),
    ];
    expect(lastReplyInTranscript(lines)).toBe('First paragraph.\nSecond paragraph.');
  });

  it('skips a turn still running, sidechains, and lines that do not parse', () => {
    const lines = [
      assistant('m1', 'end_turn', [text('Finished reply.')]),
      user('next'),
      assistant('m2', 'end_turn', [text('Subagent reply.')], { isSidechain: true }),
      assistant('m3', 'tool_use', [text('Interim note.'), { type: 'tool_use', id: 't', name: 'Bash', input: {} }]),
      '{"type":"assistant","message":{"id":"m4",',
    ];
    expect(lastReplyInTranscript(lines)).toBe('Finished reply.');
  });

  it('returns null when no turn ended with text', () => {
    expect(lastReplyInTranscript([])).toBeNull();
    expect(lastReplyInTranscript([user('hi'), assistant('m1', 'end_turn', [{ type: 'thinking', thinking: 'x' }])])).toBeNull();
    expect(lastReplyInTranscript([assistant('m1', 'end_turn', [text('Earlier.')]), assistant('m1', 'end_turn', [{ type: 'thinking', thinking: 'x' }])])).toBeNull();
    expect(lastReplyInTranscript([assistant('m1', 'end_turn', [text('   ')])])).toBeNull();
  });
});
