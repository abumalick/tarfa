import type { Page } from '@playwright/test';

// A stand-in for the phone's voice: records what it is asked to say, and starts each utterance
// at once and finishes it only when the spec says so.
// `silent`: a voice that takes every utterance and never starts one (no engine for it).
// `fails`: one that answers every utterance with an error (an engine Chrome lost).
export async function fakeVoice(page: Page, voice: 'speaks' | 'silent' | 'fails' = 'speaks') {
  await page.addInitScript((voice) => {
    type U = { text: string; rate: number; onstart?: () => void; onend?: () => void; onerror?: (e: { error: string }) => void };
    const queue: U[] = [];
    const spoken: string[] = [];
    const rates: number[] = [];
    (window as unknown as { spoken: string[]; rates: number[] }).spoken = spoken;
    (window as unknown as { rates: number[] }).rates = rates;
    class Utterance {
      lang = '';
      rate = 1;
      volume = 1;
      onstart?: () => void;
      onend?: () => void;
      onerror?: (e: { error: string }) => void;
      constructor(public text: string) {}
    }
    const startHead = () => {
      if (voice === 'speaks') queue[0]?.onstart?.();
      else if (voice === 'fails') queue.shift()?.onerror?.({ error: 'synthesis-failed' });
    };
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        paused: false,
        get speaking() {
          return queue.length > 0;
        },
        get pending() {
          return queue.length > 1;
        },
        getVoices: () => [],
        resume() {},
        speak(u: U) {
          if (u.text.trim() === '') return;
          spoken.push(u.text);
          rates.push(u.rate);
          queue.push(u);
          if (queue.length === 1) startHead();
        },
        cancel() {
          queue.splice(0).forEach((u) => u.onend?.());
        },
      },
    });
  }, voice);
}

