// Which app a build installs as. Production is tarfa.app; dev is every other origin we serve
// (the tailnet staging PWA, the throwaway tarfa-dev Worker), named and drawn differently so the
// two never look alike on a home screen. Chosen at build time by TARFA_APP_FLAVOR.
export type AppFlavor = 'production' | 'dev';

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: 'any' | 'maskable';
}

export interface AppIdentity {
  flavor: AppFlavor;
  name: string;
  shortName: string;
  appleTouchIcon: string;
  icons: ManifestIcon[];
}

export function parseAppFlavor(value: string | undefined): AppFlavor {
  if (!value || value === 'production') return 'production';
  if (value === 'dev') return 'dev';
  throw new Error(`TARFA_APP_FLAVOR must be "production" or "dev", got "${value}"`);
}

export function appIdentity(flavor: AppFlavor): AppIdentity {
  const suffix = flavor === 'dev' ? '-dev' : '';
  const icon = (base: string, sizes: string, purpose: ManifestIcon['purpose']): ManifestIcon => ({
    src: `${base}${suffix}.png`,
    sizes,
    type: 'image/png',
    purpose,
  });
  const name = flavor === 'dev' ? 'Tarfa Dev' : 'Tarfa';
  return {
    flavor,
    name,
    shortName: name,
    appleTouchIcon: `/apple-touch-icon${suffix}.png`,
    icons: [
      icon('icon-192', '192x192', 'any'),
      icon('icon-512', '512x512', 'any'),
      icon('icon-192-maskable', '192x192', 'maskable'),
      icon('icon-512-maskable', '512x512', 'maskable'),
    ],
  };
}
