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
  voiceSilent: 'La voix du téléphone n’a pas démarré.',
  voiceFailed: (code: string) => `La voix du téléphone a échoué (${code}).`,
  speed: 'Vitesse de lecture',
  speedIs: (rate: string) => `Vitesse ${rate}×`,
  howToFix: 'Comment corriger',
  helpTitle: 'Activer la voix du téléphone',
  helpSteps: {
    'android-chrome': [
      'Chrome sur Android ne parle qu’avec le moteur vocal de Google, même quand le téléphone en utilise un autre (celui de Samsung, par exemple).',
      'Installez « Services de reconnaissance et de synthèse vocales de Google » depuis le Play Store. S’il est indiqué comme désactivé, touchez Activer.',
      'Dans les Paramètres d’Android, cherchez « Synthèse vocale », ouvrez le moteur de Google et installez la voix de votre langue.',
      'Fermez complètement Tarfa (balayez-la hors des applications récentes) puis rouvrez-la : Chrome trouve le moteur à son démarrage.',
      'Montez le volume multimédia : la voix passe par lui.',
    ],
    'android-firefox': [
      'Firefox parle avec le moteur vocal du téléphone.',
      'Dans les Paramètres d’Android, cherchez « Synthèse vocale », choisissez un moteur et installez la voix de votre langue.',
      'Fermez complètement le navigateur puis rouvrez-le.',
      'Montez le volume multimédia : la voix passe par lui.',
    ],
    ios: [
      'Vérifiez que le mode Silencieux est désactivé et que le volume est monté.',
      'Dans Réglages → Accessibilité → Contenu énoncé → Voix, téléchargez une voix pour votre langue.',
      'Fermez complètement Tarfa puis rouvrez-la.',
    ],
    desktop: [
      'Installez une voix pour votre langue dans les réglages vocaux du système.',
      'Redémarrez le navigateur et vérifiez la sortie audio.',
    ],
  },
  openStore: 'Ouvrir dans le Play Store',
  done: 'OK',
};
