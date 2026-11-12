import type { Messages } from '../en';

export const create: Messages['create'] = {
  back: 'Retour',
  title: 'Nouvel espace de travail',
  machine: 'Machine',
  noMachines: 'Aucune machine',
  connecting: 'connexion…',
  offline: 'hors ligne',
  waiting: 'En attente de la connexion d’une machine…',
  recent: 'Récents',
  path: 'Chemin',
  pathRelative: (root: string) => `Chemin (relatif à ${root})`,
  pathPlaceholder: 'projet',
  browse: 'Parcourir',
  browseButton: 'Parcourir…',
  command: 'Commande',
  forget: (label: string) => `Oublier ${label}`,
  custom: 'Personnalisée…',
  model: 'Modèle',
  customCommand: 'Commande personnalisée',
  create: 'Créer',
};
