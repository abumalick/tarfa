// The reply a Stop hook would carry, read back from a Claude Code transcript (JSONL). Claude
// writes one line per content block and builds `last_assistant_message` from the last assistant
// line alone: its text blocks joined by a newline, trimmed. The last main-chain line that ended
// the turn stands in for it, so a turn still running is not read mid-way.
export function lastReplyInTranscript(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: unknown;
    try {
      entry = JSON.parse(lines[i] ?? '');
    } catch {
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;
    const { type, isSidechain, message } = entry as { type?: unknown; isSidechain?: unknown; message?: unknown };
    if (type !== 'assistant' || isSidechain === true || typeof message !== 'object' || message === null) continue;
    const { stop_reason, content } = message as { stop_reason?: unknown; content?: unknown };
    if (stop_reason !== 'end_turn' || !Array.isArray(content)) continue;
    const reply = content
      .flatMap((block) => {
        const b = block as { type?: unknown; text?: unknown };
        return b?.type === 'text' && typeof b.text === 'string' ? [b.text] : [];
      })
      .join('\n')
      .trim();
    return reply === '' ? null : reply;
  }
  return null;
}
