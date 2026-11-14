# PWA hosting, the origin and launch

Where the PWA is served (tarfa.app, the staging origin), what a public origin can reach, and what the cold launch carries. Each bullet records a decision; read it before changing that code.

- **The PWA is served from tarfa.app**, a static-assets Worker (`packages/pwa/wrangler.jsonc`)
  deployed only by `deploy/pwa-deploy.sh` from a clean main that matches its upstream, after a
  frozen install. It is done only once `https://tarfa.app/version.json` names the build just
  made (its id is the commit plus the build time). `env.production` is the Worker `tarfa` on the
  custom domain alone (no workers.dev host, no preview URLs; a test keeps it so); the top level
  is a local Worker of its own, so a bare `wrangler deploy` never reaches production.
  `--dev` deploys any checkout to a throwaway `tarfa-dev` Worker on workers.dev for an
  on-device test (badge `tarfa-dev`), and `--dev --delete` removes it afterwards. Every run,
  production included, builds into `.tmp/pwa-deploy-dist` and deploys that, never main's `dist`,
  which the staging PWA serves with its own name and icon; `--dry-run` does not combine with `--dev`. The account is
  `CLOUDFLARE_ACCOUNT_ID` in main's gitignored `deploy/pwa-deploy.env` (or `--env-file`), with `PWA_DEPLOY_TOKEN_CMD` printing the scoped API token wrangler gets (never a wrangler login).
  **The build also emits `/terms` and `/privacy`** (`core/legal-pages.ts`, script-free, precached by
  the service worker), linked from the first-run screen (whose line says using the app accepts them)
  and Settings. The repo's text names no operator: the name, contact and governing law come from
  `TARFA_OPERATOR_*` in the env file at build, HTML-escaped, so a self-hoster's copy names its own;
  a production deploy and `--dry-run` refuse without them. Keep personal names out of the repo.
  **Its storage keys are `tarfa.*`** (localStorage), `tarfa-device` (IndexedDB) and
  `tarfa-shared` (Cache Storage): it reads nothing an older build stored and needs no migration.
- The tailnet origin is the **staging PWA** for worktree tests: it is built and served on the
  always-on machine via `deploy/run-pwa.sh` + `tailscale serve`, from the same code. It is a
  separate origin, so a separate install and pairing on each phone.
  - **It installs as "Tarfa Dev" with a cyan-on-teal icon**, so it never looks like tarfa.app on
    a home screen. `TARFA_APP_FLAVOR=dev` picks the name, title and `*-dev.png` icons at build
    time (`core/app-flavor.ts`); unset means production, so a self-hoster's plain build is
    "Tarfa". Every script that builds for a non-production origin sets it: `run-pwa.sh`,
    `build-current.sh` (the post-commit/post-merge hooks), `serve-build.sh`, the test gate
    (it rebuilds main's `dist`) and `pwa-deploy.sh --dev`; production and `--dry-run` build
    production. iOS bakes the name and icon in at Add to Home Screen, so an existing install
    keeps the old ones until it is re-added (a new install has new storage, so it pairs again).
  - **The host running `run-pwa.sh`:** it keeps a `vite preview`
    process serving the `deploy/pwa-live` symlink (defaults to `packages/pwa/dist/`), fronted
    by `tailscale serve` on :8443. The preview stays up and serves whatever the symlink points
    at, so `deploy/build-current.sh` (a dev-flavored build) re-deploys here — no process
    restart, just reload the PWA; a bare `pnpm --filter @tarfa/pwa build` would serve the
    production name and icon. `pnpm serve:build` temporarily repoints the symlink at a worktree
    build (`CLAUDE.md`, "Worktrees & on-device testing").

## CRITICAL: the PWA's origin and what it can reach
The PWA was first served from the tailnet because browsers once blocked a **public-origin page
from opening a WebSocket to a tailnet `100.x` address**. Measured on 2026-11-05 from a public
origin, that no longer holds:

| Device | Tailscale | Tailnet address (`serve`) | Funnel address |
|---|---|---|---|
| iPhone, Safari, iOS 26.6 | on | works: open 0.7 s, RTT 3 ms | works, and resolves to the tailnet |
| Android Chrome 156 | on | works after a one-time local-network prompt: open 1.5 s | works, via the tailnet |
| Android Firefox 160 | on | works, open 5.4 s | works, via the tailnet |
| iPhone / Android Chrome | off | fails (expected) | works: open 0.8–1.2 s, RTT ~170 ms, ~0.2 MB/s |

So the PWA is on a public origin, tarfa.app, and what follows from that:
- **One hostname serves both paths.** With MagicDNS on, the phone resolves the node's `ts.net`
  name to its `100.x` address; off the tailnet, public DNS resolves it to Funnel's ingress. A
  machine whose `serve` entry is also Funneled needs a single address; several addresses are for
  the other cases (serve and Funnel on different ports, a LAN or proxy address).
- **Funnel moves about 0.2 MB/s.** Terminal traffic is fine; a several-MB media preview takes
  tens of seconds over it (3 MB: 22 s on a Galaxy Tab, against 1.7 s over the tailnet).
- **The origin holds every phone's device key.** Where IndexedDB will not keep a `CryptoKey`,
  the key is stored as raw bytes readable by any script on the origin, and an enrolled key is the
  phone's whole credential; whoever serves the PWA can also read everything it shows.
  **tarfa.app is the maintainer's origin**: whoever does not trust it serves their own copy
  (any static host, or `deploy/pwa-deploy.sh --env-file` for their own Cloudflare account from
  a fork that names their own domain in `wrangler.jsonc` and the script's `version.json` check,
  which say tarfa.app) and
  points their pairing links at it (`tarfa pair --pwa`). Moving origins means a new device key
  (a new origin has empty storage), so every phone pairs again there.
- **`tarfa pair` names the PWA's origin** (`TARFA_PWA_ORIGIN`, default `https://tarfa.app`): its
  instructions say where to install the app, and a `--link` link points at it.
- **A device that cannot fetch the PWA's origin never updates, and nothing says so.** It keeps
  running its cached service-worker build, which can still connect, so the app looks healthy
  while `sw.js` cannot be fetched (on the tailnet staging origin, a device with Tailscale off).
  When one device misses a deploy another picked up (a new field missing, an old badge in the
  header), ask first whether it can reach the origin. Only then look further: the update bar,
  `chrome://serviceworker-internals` → Unregister, or adb. Never suggest "clear site data": it
  deletes the device key, and the device has to pair again.

## Cold launch
- **A cold launch's path to the first connect carries only what connecting needs.** Measured on
  Android: the time from launch to `start()` was mostly compiling and evaluating the bundle, and
  xterm plus marked/dompurify were half of it, so `TerminalView` and `FileViewer` are their own
  chunks (`App.svelte`'s loaders). They are fetched once the first workspace list arrives, well
  before anyone can open one; a failed import is forgotten, so opening the view again retries it.
  Don't import either statically from anything the main bundle reaches. The device key's
  IndexedDB read then waited on the main thread, so `public/warm-device-key.js` (an `async`
  classic script: module scripts in `index.html` are folded into the main bundle) opens the
  database first. **It must create nothing**: a first launch's upgrade is aborted, or the app's
  own `open(DB, 1)` would find a database without its object store. The name is duplicated in
  `device-keys.ts`; `warm-device-key.test.ts` keeps the two equal.
