export const readAloud = {
  listen: 'Listen to the last reply',
  player: 'Reading the last reply',
  play: 'Play',
  pause: 'Pause',
  back: 'Back about 10 seconds',
  forward: 'Forward about 10 seconds',
  close: 'Stop and close',
  nothingToRead: 'No reply to read yet. Claude’s next reply can be read once it finishes.',
  noAnswer: 'The machine did not send the reply. Try again.',
  dismiss: 'Dismiss',
  voiceSilent: 'The phone’s voice did not start.',
  voiceFailed: (code: string) => `The phone’s voice failed (${code}).`,
  speed: 'Reading speed',
  speedIs: (rate: string) => `Speed ${rate}×`,
  howToFix: 'How to fix',
  helpTitle: 'Turning on the phone’s voice',
  // One list per platform (lib/voice-platform.ts).
  helpSteps: {
    'android-chrome': [
      'Chrome on Android speaks only with Google’s speech engine, even when the phone has another one set (Samsung’s, for one).',
      'Install “Speech Services by Google” from the Play Store. If it says the app is disabled, tap Enable.',
      'In Android’s Settings, search for “Text-to-speech”, open Speech Services by Google and install the voice for your language.',
      'Restart Chrome (Settings → Apps → Chrome → Force stop), then open Tarfa again: Chrome finds the engine only when it starts.',
      'Turn the media volume up: the voice plays on it.',
    ],
    'android-firefox': [
      'Firefox speaks with the phone’s own speech engine.',
      'In Android’s Settings, search for “Text-to-speech”, choose an engine and install the voice for your language.',
      'Close the browser completely and open it again.',
      'Turn the media volume up: the voice plays on it.',
    ],
    ios: [
      'Check that Silent mode is off and the volume is up.',
      'In Settings → Accessibility → Spoken Content → Voices, download a voice for your language.',
      'Close Tarfa completely and open it again.',
    ],
    desktop: [
      'Install a voice for your language in the system’s speech settings.',
      'Restart the browser, and check the sound output.',
    ],
  },
  // Android Chrome, when the voice answered `synthesis-failed`: the engine is there, but Chrome lost
  // it (it does when the engine updates while Chrome runs) and finds it again only on a restart.
  restartSteps: [
    'Chrome has most likely lost its connection to the speech engine. It happens when the engine updates while Chrome is running.',
    'In Android’s Settings → Apps → Chrome (or the browser Tarfa was installed from), tap Force stop. Swiping Tarfa away is not enough: the browser keeps running.',
    'Open Tarfa again and tap 🔊.',
  ],
  stillFailing: 'Still failing?',
  openStore: 'Open in the Play Store',
  done: 'Done',
};
