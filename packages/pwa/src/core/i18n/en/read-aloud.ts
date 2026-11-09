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
  voiceSilent: 'The phone’s voice did not start. On Android, Chrome needs Google’s speech engine: install “Speech Services by Google” from the Play Store, with a voice for this language.',
  voiceFailed: (code: string) => `The phone’s voice failed (${code}).`,
};
