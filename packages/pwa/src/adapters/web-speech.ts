import type { SpeechPort } from '../core/ports/speech';

// Chrome drops a speak() that follows a cancel() too closely, so speaking that soon waits this long.
const AFTER_CANCEL_MS = 150;

// The browser's speechSynthesis, or null where there is none (the 🔊 key is then not shown).
// `ios`: only WebKit needs the silent utterance in the tap (see SpeechPort.unlock).
export function webSpeech(ios: boolean): SpeechPort | null {
  const synth = globalThis.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return null;
  // Chrome may collect a queued utterance and never fire its events, so each is held until it ends.
  const queued = new Set<SpeechSynthesisUtterance>();
  // Utterances held back after a cancel, spoken in order by one timer.
  let deferred: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelledAt = -Infinity;

  // An explicit voice for the language: Android's Chrome may otherwise stay silent on a bare `lang`.
  const voiceFor = (lang: string) => synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()));

  return {
    speak(text, lang, events) {
      const run = () => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        const voice = voiceFor(lang);
        if (voice) utterance.voice = voice;
        utterance.onstart = events.start;
        utterance.onend = () => {
          queued.delete(utterance);
          events.end();
        };
        utterance.onerror = (e) => {
          queued.delete(utterance);
          if (e.error === 'interrupted' || e.error === 'canceled') events.end();
          else events.error(e.error);
        };
        queued.add(utterance);
        if (synth.paused) synth.resume();
        synth.speak(utterance);
      };
      const wait = cancelledAt + AFTER_CANCEL_MS - performance.now();
      if (timer === null && wait <= 0) return run();
      deferred.push(run);
      timer ??= setTimeout(() => {
        timer = null;
        const due = deferred;
        deferred = [];
        due.forEach((speak) => speak());
      }, Math.max(wait, 0));
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      deferred = [];
      if (synth.speaking || synth.pending) {
        synth.cancel();
        cancelledAt = performance.now();
      }
    },
    unlock() {
      if (!ios) return;
      const silent = new SpeechSynthesisUtterance(' ');
      silent.volume = 0;
      synth.speak(silent);
    },
  };
}
