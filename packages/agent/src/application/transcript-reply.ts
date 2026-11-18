// The reply a Stop hook would carry, read back from a Claude Code transcript (JSONL). Claude
// writes one line per content block, so a message's text can span several lines sharing its id;
// `last_assistant_message` is the text blocks of the last main-chain message that ended the turn.
export function lastReplyInTranscript(lines: readonly string[]): string | null {
  const entries: { id: string; stop: unknown; content: unknown }[] = [];
  for (const line of lines) {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;
    const { type, isSidechain, message } = entry as { type?: unknown; isSidechain?: unknown; message?: unknown };
    if (type !== 'assistant' || isSidechain === true || typeof message !== 'object' || message === null) continue;
    const { id, stop_reason, content } = message as { id?: unknown; stop_reason?: unknown; content?: unknown };
    if (typeof id === 'string') entries.push({ id, stop: stop_reason, content });
  }
  const lastId = [...entries].reverse().find((e) => e.stop === 'end_turn')?.id;
  if (lastId === undefined) return null;
  const texts = entries
    .filter((e) => e.id === lastId && Array.isArray(e.content))
    .flatMap((e) => e.content as unknown[])
    .flatMap((block) => {
      const b = block as { type?: unknown; text?: unknown };
      return b?.type === 'text' && typeof b.text === 'string' ? [b.text] : [];
    });
  const reply = texts.join('\n\n');
  return reply.trim() === '' ? null : reply;
}
