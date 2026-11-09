import type { SpeechPort } from '../core/ports/speech';

// The browser's speechSynthesis, or null where there is none (the 🔊 key is then not shown).
export function webSpeech(): SpeechPort | null {
  const synth = globalThis.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return null;
  // Chrome may collect a queued utterance and never fire its events, so each is held until it ends.
  const queued = new Set<SpeechSynthesisUtterance>();
  return {
    speak(text, lang, events) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      const done = () => {
        queued.delete(utterance);
        events.end();
      };
      utterance.onstart = events.start;
      utterance.onend = done;
      utterance.onerror = done;
      queued.add(utterance);
      synth.speak(utterance);
    },
    cancel() {
      synth.cancel();
    },
    unlock() {
      const silent = new SpeechSynthesisUtterance(' ');
      silent.volume = 0;
      synth.speak(silent);
    },
  };
}
