import { describe, it, expect } from 'vitest';
import { LastReplies, MAX_REPLY_CHARS } from './last-replies';

describe('LastReplies', () => {
  it('keeps the last assistant message of a turn that ended', () => {
    const replies = new LastReplies();
    replies.record('w', 'Stop', { last_assistant_message: 'First.' });
    replies.record('w', 'Stop', { last_assistant_message: 'Second.' });
    expect(replies.get('w')).toBe('Second.');
  });

  it('keeps the message of a turn an API error ended', () => {
    const replies = new LastReplies();
    replies.record('w', 'StopFailure', { last_assistant_message: 'Partial.' });
    expect(replies.get('w')).toBe('Partial.');
  });

  it('ignores other events and payloads without a message, keeping what it had', () => {
    const replies = new LastReplies();
    replies.record('w', 'Stop', { last_assistant_message: 'Kept.' });
    replies.record('w', 'PostToolUse', { last_assistant_message: 'Not a reply.' });
    replies.record('w', 'Stop', {});
    replies.record('w', 'Stop', { last_assistant_message: 42 });
    replies.record('w', 'Stop', { last_assistant_message: '   ' });
    replies.record('w', 'Stop', null);
    expect(replies.get('w')).toBe('Kept.');
  });

  it('knows nothing of a workspace it never saw, or one it forgot', () => {
    const replies = new LastReplies();
    expect(replies.get('w')).toBeNull();
    replies.record('w', 'Stop', { last_assistant_message: 'Gone soon.' });
    replies.forget('w');
    expect(replies.get('w')).toBeNull();
  });

  it('caps a very long reply', () => {
    const replies = new LastReplies();
    replies.record('w', 'Stop', { last_assistant_message: 'x'.repeat(MAX_REPLY_CHARS + 10) });
    expect(replies.get('w')).toHaveLength(MAX_REPLY_CHARS);
  });
});
