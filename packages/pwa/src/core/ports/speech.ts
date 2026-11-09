// The phone's own voice (speechSynthesis), faked in tests. `speak` queues one utterance;
// `cancel` drops the queue, and may still fire `end` on what it dropped.
export interface SpeechPort {
  speak(text: string, lang: string, events: { start: () => void; end: () => void }): void;
  cancel(): void;
  // Called in the tap that asks for a reply: the voice speaks later, once the agent answers, and
  // WebKit lets a page speak only after it spoke inside a user gesture.
  unlock(): void;
}
