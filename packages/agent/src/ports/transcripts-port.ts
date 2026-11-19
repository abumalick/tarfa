export interface TranscriptsPort {
  // The last reply in that Claude Code session's transcript, or null when there is none or the
  // transcript cannot be found or read.
  lastReply(claudeSessionId: string): Promise<string | null>;
}
