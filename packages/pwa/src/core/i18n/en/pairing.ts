export const pairing = {
  otherKey: (machine: string) =>
    `This code names another key for ${machine} than the one this phone trusts. If the machine's identity changed, remove that entry first.`,
  question: (machine: string, host: string, fingerprint: string) =>
    `Pair with ${machine} through ${host}?\n\n` +
    `Machine key ${fingerprint}: check it matches what tarfa pair printed.\n\n` +
    'Continue only if you just ran tarfa pair on that machine.',
  linkUnreachable: (machine: string) =>
    `Could not connect to ${machine} through this pairing code, so nothing was changed. If the machine moved, run tarfa pair on it for a fresh code.`,
  notALink: 'That is not a Tarfa pairing code. Run `tarfa pair` on the machine for a fresh one.',
  newerCode: 'This pairing code comes from a newer Tarfa than this app. Update the app (reload it), then try again.',
  otherOrigin: (origin: string, own: string) => `This pairing code is for the Tarfa at ${origin}, not this one (${own}).`,
  cameraRefused: 'Camera access was refused. Allow it for this app, or paste the pairing code below.',
  cameraFailed: (error: string) => `Cannot open the camera (${error}). Paste the pairing code below instead.`,
  clipboardFailed: 'Cannot read the clipboard. Paste it in the field below instead.',
  cancel: 'Cancel',
  scan: 'Scan QR code',
  pasteLink: 'Paste pairing code',
  orPaste: 'Or paste a pairing code',
  pair: 'Pair',
  hintBefore: 'Run ',
  hintAfter: ' on the machine to get a code. It works once, for the minutes it states.',
};
