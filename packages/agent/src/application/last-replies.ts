// The text of each workspace's last reply, from the turn-end hooks' `last_assistant_message`
// (Claude Code's Stop and StopFailure payloads). In memory only, and never logged: it is what the
// assistant wrote. An agent restart forgets it until the next turn ends.
export const MAX_REPLY_CHARS = 64_000;

const TURN_ENDS = new Set(['Stop', 'StopFailure']);

export class LastReplies {
  private readonly replies = new Map<string, string>();

  record(id: string, event: string, payload: unknown): void {
    if (!TURN_ENDS.has(event) || typeof payload !== 'object' || payload === null) return;
    const text = (payload as { last_assistant_message?: unknown }).last_assistant_message;
    if (typeof text !== 'string' || text.trim() === '') return;
    // A reply rides the phone's session as one message, ahead of terminal output.
    this.replies.set(id, text.slice(0, MAX_REPLY_CHARS));
  }

  get(id: string): string | null {
    return this.replies.get(id) ?? null;
  }

  forget(id: string): void {
    this.replies.delete(id);
  }
}
