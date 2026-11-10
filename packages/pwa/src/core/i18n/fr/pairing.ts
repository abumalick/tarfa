import type { Messages } from '../en';

export const pairing: Messages['pairing'] = {
  otherKey: (machine) =>
    `Ce code indique pour ${machine} une autre clé que celle à laquelle ce téléphone fait confiance. Si l’identité de la machine a changé, supprimez d’abord cette entrée.`,
  question: (machine, host, fingerprint) =>
    `Associer ${machine} via ${host} ?\n\n` +
    `Clé de la machine ${fingerprint} : vérifiez qu’elle correspond à ce qu’a affiché tarfa pair.\n\n` +
    'Ne continuez que si vous venez de lancer tarfa pair sur cette machine.',
  linkUnreachable: (machine) =>
    `Impossible de se connecter à ${machine} via ce code d’association : rien n’a été modifié. Si la machine a changé d’adresse, lancez tarfa pair dessus pour obtenir un nouveau code.`,
  notALink: "Ce n’est pas un code d’association Tarfa. Lancez `tarfa pair` sur la machine pour en obtenir un nouveau.",
  newerCode: 'Ce code d’association vient d’un Tarfa plus récent que cette application. Mettez l’application à jour (rechargez-la), puis réessayez.',
  otherOrigin: (origin, own) => `Ce code d’association est pour le Tarfa de ${origin}, pas pour celui-ci (${own}).`,
  cameraRefused: "L’accès à la caméra a été refusé. Autorisez-le pour cette application, ou collez le code d’association ci-dessous.",
  cameraFailed: (error) => `Impossible d’ouvrir la caméra (${error}). Collez plutôt le code d’association ci-dessous.`,
  clipboardFailed: 'Impossible de lire le presse-papiers. Collez-le plutôt dans le champ ci-dessous.',
  cancel: 'Annuler',
  scan: 'Scanner le QR code',
  pasteLink: 'Coller le code d’association',
  orPaste: 'Ou collez un code d’association',
  pair: 'Associer',
  hintBefore: 'Lancez ',
  hintAfter: ' sur la machine pour obtenir un code. Il sert une fois, pendant le nombre de minutes indiqué.',
};
