import type { Messages } from '../en';

export const readAloud: Messages['readAloud'] = {
  listen: 'Écouter la dernière réponse',
  player: 'Lecture de la dernière réponse',
  play: 'Lire',
  pause: 'Pause',
  back: 'Reculer d’environ 10 secondes',
  forward: 'Avancer d’environ 10 secondes',
  close: 'Arrêter et fermer',
  nothingToRead: 'Aucune réponse à lire pour l’instant. La prochaine réponse de Claude pourra être lue une fois terminée.',
  noAnswer: 'La machine n’a pas envoyé la réponse. Réessayez.',
  dismiss: 'Fermer',
  voiceSilent: 'La voix du téléphone n’a pas démarré. Sur Android, Chrome a besoin du moteur vocal de Google : installez « Services de reconnaissance et de synthèse vocales de Google » depuis le Play Store, avec une voix pour cette langue.',
  voiceFailed: (code: string) => `La voix du téléphone a échoué (${code}).`,
};
