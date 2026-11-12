import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { buildVersionJson, VERSION_FILE } from './src/core/version-file';
import { CONTENT_SECURITY_POLICY } from './src/core/csp';
import { buildHeadersFile, HEADERS_FILE, SECURITY_HEADERS } from './src/core/security-headers';
import { appIdentity, parseAppFlavor, type AppIdentity } from './src/core/app-flavor';
import { LEGAL_FILES, readOperator, renderLegalPage, type LegalPage } from './src/core/legal-pages';

const buildLabel = process.env.TARFA_BUILD_LABEL ?? 'main';
// A per-build id (timestamp) that changes on every build, even a rebuild of the same
// commit, written to version.json — the label alone can't distinguish two `main` builds.
const buildId = process.env.TARFA_BUILD_ID ?? String(Date.now());
const identity = appIdentity(parseAppFlavor(process.env.TARFA_APP_FLAVOR));

// Emit version.json at the site root with the build label and id, so a running PWA can
// read the *incoming* build's identity when an update is waiting. Kept out of the SW
// precache (json is not in workbox's default globPatterns) so the fetch always hits the
// network.
function emitVersionFile(label: string, id: string): Plugin {
  return {
    name: 'tarfa-version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: VERSION_FILE, source: buildVersionJson(label, id) });
    },
  };
}

// terms.html and privacy.html, with the operator named by the build's TARFA_OPERATOR_* (see legal-pages.ts).
// Emitted in the bundle, so the service worker precaches them like the app shell.
function emitLegalPages(): Plugin {
  const operator = readOperator(process.env);
  return {
    name: 'tarfa-legal-pages',
    generateBundle() {
      for (const page of Object.keys(LEGAL_FILES) as LegalPage[]) {
        this.emitFile({ type: 'asset', fileName: LEGAL_FILES[page], source: renderLegalPage(page, operator) });
      }
    },
  };
}

// dist/_headers, from the same policy as the meta tag, so the two cannot drift.
function emitHeadersFile(): Plugin {
  return {
    name: 'tarfa-headers-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: HEADERS_FILE, source: buildHeadersFile() });
    },
  };
}

function previewHeaders(): Record<string, string> {
  const { 'Strict-Transport-Security': _hsts, ...headers } = SECURITY_HEADERS;
  return headers;
}

// The CSP goes in at build only: the dev server's module graph and HMR are not what ships.
function contentSecurityPolicy(): Plugin {
  return {
    name: 'tarfa-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY }, injectTo: 'head-prepend' },
    ],
  };
}

// The page title, the iOS Home Screen icon (iOS takes it from apple-touch-icon, not the manifest)
// and the flavor on <html>, which App.svelte's tokens key the dev background off.
function appHead(id: AppIdentity): Plugin {
  return {
    name: 'tarfa-app-head',
    transformIndexHtml: (html) => ({
      html: html.replace('<html', `<html data-flavor="${id.flavor}"`),
      tags: [
        { tag: 'title', children: id.name, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: id.appleTouchIcon }, injectTo: 'head' },
      ],
    }),
  };
}

// workbox-build bundles the service worker through a file in a fresh folder under the system temp
// dir and never removes it, so every build left one behind. Give the build a folder of its own
// (workbox reads TMPDIR when the PWA plugin loads it, at the end of the build) and remove it on exit.
function privateTempDir(): Plugin {
  return {
    name: 'tarfa-private-tmpdir',
    apply: 'build',
    config() {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'tarfa-pwa-build-'));
      process.env.TMPDIR = dir;
      process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
    },
  };
}

export default defineConfig({
  plugins: [
    svelte(),
    privateTempDir(),
    contentSecurityPolicy(),
    appHead(identity),
    emitVersionFile(buildLabel, buildId),
    emitHeadersFile(),
    emitLegalPages(),
    VitePWA({
      // 'prompt', not 'autoUpdate': the new worker waits instead of reloading on its own.
      // main.ts surfaces an update bar above the list's title and over the terminal's top, and reloads only on the user's tap (see UpdateBar).
      registerType: 'prompt',
      // We register the SW ourselves in main.ts so we can poll for updates
      // (detect a new build in an OPEN app, not just on next launch).
      injectRegister: false,
      // Add one imported script to the Workbox-generated SW: it claims the Web Share Target
      // POST (`/share-target`) and lets every other request fall through to Workbox's router
      // (a POST is never a navigation GET, so they don't contend). Keeps `generateSW` and the
      // existing precache/update machinery untouched. Android-only in effect; inert on iOS.
      workbox: {
        importScripts: ['share-target-sw.js'],
      },
      manifest: {
        name: identity.name,
        short_name: identity.shortName,
        theme_color: '#111111',
        background_color: '#111111',
        display: 'standalone',
        start_url: '/',
        icons: identity.icons,
        // Register Tarfa as an Android share target so "Share → Tarfa" from any app POSTs the
        // image to the SW helper (share-target-sw.js). Ignored by iOS WebKit (no Web Share Target).
        share_target: {
          action: '/share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [{ name: 'file', accept: ['*/*'] }],
          },
        },
      },
    }),
  ],
  // Slug of the build being produced, surfaced in the UI so we know which build a
  // device is serving. 'main' for normal builds; `pnpm serve:build` sets it to a
  // worktree slug when temporarily serving a test build (see docs/WORKTREES.md).
  define: {
    __TARFA_BUILD_LABEL__: JSON.stringify(buildLabel),
    __TARFA_APP_NAME__: JSON.stringify(identity.name),
  },
  // Svelte 5's mount() needs the 'browser' export condition under vitest/jsdom; vitest does not honor test.resolve.conditions, so this must stay top-level. Harmless for the production build (a browser app already resolves the browser condition).
  resolve: {
    conditions: ['browser'],
  },
  // `vite preview` (used by deploy/run-pwa.sh) is fronted by `tailscale serve` and bound to
  // loopback, so the tailnet Host header must be allowed (vite's anti-DNS-rebinding check would
  // otherwise 403 it). Safe here: only localhost + tailscale serve reach the loopback listener.
  // It also sends tarfa.app's headers, so the staging origin and the e2e run under them too, but
  // HSTS: on a tailnet host it would force https on every port of that machine.
  preview: {
    allowedHosts: true,
    headers: previewHeaders(),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest-setup.ts'],
    include: ['src/**/*.test.ts'],
    globals: true,
    // Bound the worker count. Uncapped, vitest runs one fork per core and each jsdom+Svelte+
    // xterm worker holds over a gigabyte, so the suite alone can claim most of a machine's
    // memory. The gate runs on every commit and is not the only thing running, so a
    // predictable ceiling is worth more than the last few seconds of wall-clock.
    // Guarded by deploy/parallelism-caps.test.sh.
    maxWorkers: 4,
  },
});
