# Agent runtime, packaging and machine setup

How the agent is packaged, released, installed and set up on a machine, and the rename reads it keeps from Perch. Each bullet records a decision; read it before changing that code. The step-by-step runbook is `docs/DEPLOY.md`.

## The published package

**`packages/agent` (`@tarfa/cli`) is also the published package.** `pnpm --filter @tarfa/cli build` (esbuild) bundles
`src/cli.ts` and `src/serve.ts` into `dist/` with the two workspace packages inlined; `files`
adds the hook scripts and `templates/`. It has no install scripts (installers like mise run npm with
`--ignore-scripts`): `node-pty` is pinned to a version whose prebuilds load without its install step. Files are found with
`packageRoot()` (`infrastructure/package-root.ts`, realpath of the running file up to its
`package.json`), the same from `src/` and `dist/`, and `isEntrypoint` compares real paths so a
bin symlink or shim still runs the CLI. Nothing in the package directory is written at runtime.
`.pnpmfile.cjs` strips the workspace entries when packing. Pack and install it with
`TARFA_PACK_TEST=1 pnpm --filter @tarfa/cli exec vitest run src/packaging.test.ts` (opt-in,
not in the gate; it compiles node-pty). **A release is a `v<version>` tag on main** (version from
`packages/agent/package.json`): `.github/workflows/release.yml` checks the tag and that the commit is
on main, tests, packs, runs the packaging test and **stages** the tarball with `npm stage publish
--provenance` over OIDC (no token, never `npm publish`); the maintainer approves it with 2FA
(`npm stage approve`), then `tarfa update` per machine, and `deploy/pwa-deploy.sh` only once every
agent phones pair with is at least as new as `MIN_AGENT_VERSION` (PWA `core/agent-skew.ts`, `0.0.0`
today: an agent below it, or one reporting no version, gets a notice and stays connected).

## Runtime

- Each agent reads `~/.tarfa/agent.env` (a source install: `deploy/agent.env`) (`TARFA_MACHINE_ID`,
  `TARFA_PROJECT_ROOTS`, `TARFA_PORT` for the loopback hooks listener, `TARFA_PHONE_PORT` for the
  phone port, `TARFA_PHONE_ADDRESSES` for where phones reach it) and
  runs as a service: **launchd** on macOS
  (`packages/agent/templates/app.tarfa.agent.plist`), **systemd user unit + linger** on Ubuntu. Both invoke
  `deploy/run-agent.sh` (a source install) or the launcher `~/.tarfa/bin/tarfa-agent` (a package
  install: it sources `~/.tarfa/agent.env`, exports `TARFA_AGENT_ENV`, runs the checkout named by
  `~/.tarfa/agent-source` when that still exists, else the installed package's `tarfa serve` run with the node `mise where` names, from `<install>/bin/tarfa` (npm's layout) or `<install>/node_modules/@tarfa/cli/dist/cli.js` (aube's, a newer mise's npm backend, whose `.bin/tarfa` is a shell script node cannot run), as the wrapper, `tarfa update` and the macOS port check also do (never `mise exec`, which installs every missing global tool first; `mise exec` only when `where` answers nothing), with mise's shims first on PATH; `run-agent.sh`
  skips its own `deploy/agent.env` when `TARFA_AGENT_ENV` is set; `serve:agent` writes
  `agent-source` instead of flipping `agent-live` on such a machine). `tarfa apply` (package
  installs only) rewrites the launcher and unit if they differ, reinstalls the hooks, restarts and
  checks the phone port and the log's `phones on` since the restart. `tarfa update [--version v] [--force]`
  (package installs only; from a clone it prints `this is a source install; git pull`, exit 2) asks the
  registry for the newest version, runs `mise --cd $HOME use -g npm:@tarfa/cli@<v>`, then runs the
  **new** version's `apply` through `mise where` (never the PATH or a shim, since `update` runs from
  repo folders); it never touches Claude Code or Codex. `run-agent.sh` self-locates `mise` (services don't inherit an interactive
  PATH). Run `mise trust` once per machine or the unit crash-loops.
- **An agent is reached on its phone port once that is published.** It binds `127.0.0.1`
  whatever `TARFA_HOST` says (a non-loopback value is ignored with a warning). The hooks port
  (`TARFA_PORT`) serves only `POST /hooks`, `POST /unpark`, `POST /close` and `POST /message`, and is never
  published with `tailscale serve`. `tarfa setup` sets a machine up; `tarfa pair` pairs a phone
  (`docs/DEVICE-KEYS.md`).
- **`tarfa setup` sets a machine up without prompting** (`application/setup-machine.ts` plans
  from flags plus what the machine holds, `run-setup.ts` applies; `docs/DEPLOY.md`, "In one
  command"): agent.env, agent key, roster, service, hooks, a `tailscale serve`/`funnel` handler,
  then a restart and a phone-port check. Things not to "simplify": **every step is planned only
  when it changes something**, so a rerun is a no-op and the agent is restarted only after a
  change; **the roster is written before the service first starts**, with `tokenEnrolment: false`
  (an agent from before token enrolment was removed, brought back, reads a missing roster or an
  absent field as "the token enrols", and a Funnel port is public); **an installed unit counts
  as current when it runs `<checkout>/deploy/run-agent.sh` or the launcher
  `~/.tarfa/bin/tarfa-agent`, with `KillMode=process`**, however
  it gets there (dev's runs it through `mise exec` from `WorkingDirectory`), so setup never
  rewrites a working unit; **a package install always runs the launcher** (`write-launcher`,
  then a unit whose ExecStart is its absolute path), while a source checkout keeps running
  `run-agent.sh` until its unit already runs the launcher, and is never pointed back at the
  checkout (a unit that names the launcher but lacks `KillMode=process` is reinstalled for the
  launcher); **only a package install replaces the launcher file**, a checkout writes it only when
  it is missing, so a feature branch never changes what the live service runs; **`agent.env` is found in one pinned order** (`resolveAgentEnvPath`):
  `TARFA_AGENT_ENV`, `~/.tarfa/agent.env`, then `<checkout>/deploy/agent.env` (a package install has
  no third candidate and never runs `git`), for setup and every other command, so a checkout's CLI
  on an adopted machine reads the file the service reads; **nothing is written under `~/.tarfa`
  before `move-state`** (`~/.tarfa/agent.env`, the launcher), or the agent's own startup move
  would find both directories and refuse; **a package install writes `~/.local/bin/tarfa` as a wrapper script**
  (`templates/tarfa-cli-wrapper.sh`, not a mise shim: a shim run from a folder with an untrusted
  `mise.toml` dies, and from a trusted one runs Tarfa under that project's node; the wrapper looks
  the install and node up from `$HOME` and never changes directory) and `perch` as a link to it, by
  `setup`, adoption and `apply`, replacing only nothing, a link into a clone's `deploy/` or an earlier
  copy of itself, anything else left alone with one warning, never a reason to restart;
  **adoption** (`--adopt`, or a package-run `setup` that finds a unit running a clone's
  `deploy/run-agent.sh`; refused from a clone) is the same plan: copy the clone's `deploy/agent.env`
  to `~/.tarfa/agent.env` 0600 (kept if already there, the original untouched; after `move-state`),
  launcher, remove the clone's `deploy/agent-live` **only if it is a symlink** (before the unit is
  rewritten, so a rerun after a failure still knows the clone), unit (old text kept as
  `<unit>.bak-<time>`), restart, wrapper; the agent key, roster and parked/live state are never
  touched, so no phone pairs again; **every run takes machine id, roots, phone port and default path
  from the agent.env it found (or the clone's, when adopting) unless a flag gives one**, so a bare rerun
  of an adopted machine plans nothing; **`--tailscale` has no default and setup never picks
  tailnet-only on its own** (`resolveReachability`): without the flag, an `--address`, the
  `TARFA_PHONE_ADDRESSES` agent.env holds (kept as they are) or a serve handler already proxying to the
  phone port settle it (a tailnet-only one on a relay machine is refused), and only then does a machine moving off a public relay (`TARFA_RELAY_URL(S)`
  in its agent.env, or a `perch-agent` unit being swapped) default to Funnel, said in the output and
  refused, never downgraded, when Funnel is not allowed; the relay rule ranks last because setup never
  removes the relay line, so above the others a bare rerun would publish a machine kept on the tailnet;
  with none of them setup refuses, naming `--tailscale funnel` and `--tailscale serve`. Every run,
  dry run and no-op included, prints one `reachability:` line worded from the result (a serve port
  already on Funnel is public; a proxy or an unreadable serve config is "cannot tell"). An agent
  setting a machine up asks its operator whether phones must reach it without Tailscale; **on macOS the install waits for launchd to
  drop the label after `bootout` and retries `bootstrap`** (a bootstrap right after a bootout fails
  `5: Input/output error`), then says no agent is loaded and how to load the plist on disk; **hooks count as installed regardless of key order and entry order**
  (Claude Code rewrites `settings.json` with sorted keys); **an existing `TARFA_PWA_ORIGIN` is
  kept unless `--pwa` is given**; **a phone or hooks port held by anything but this user's
  agent is refused** (another Linux user's processes are invisible to `ss`/`lsof`; the agent is a
  listener in the `tarfa-agent`/`perch-agent` unit's cgroup, and on macOS one whose command is
  `… tarfa serve` or `…/@tarfa/cli/dist/cli.js serve`, which the launcher execs, or a checkout's `src/serve.ts`); and **an
  existing serve handler on the same port and path is never replaced**; **the `--tailscale none` operator line
  takes its port from `--tailscale-port`, else the `--address` under the slug, else 443,
  and reads `funnel` when that port is already on Funnel** (`serve` would turn Funnel off for every
  agent on it; `--tailscale serve` on a Funnel port runs `tailscale funnel` for the same reason); and **a `systemctl --user` that cannot reach the manager stops setup** (without
  `XDG_RUNTIME_DIR` it would read as "not installed" and reinstall a working unit). `tarfa pair` mints a
  code with every `TARFA_PHONE_ADDRESSES` address in order (`--link`: a link on `TARFA_PWA_ORIGIN`,
  default `https://tarfa.app`).
- **The rename from Perch reads the old names for one release; don't drop a read early.** Each
  one goes when its condition holds:
  - `PERCH_*` env names stand in for `TARFA_*` (`application/legacy-env.ts`, through
    `loadConfig`; the agent warns once per name, `childEnv` strips both prefixes), until every
    machine's agent.env is rewritten by `tarfa setup`.
  - `~/.perch` is moved to `~/.tarfa` by the agent at startup, **before it reads anything**
    (`infrastructure/state-dir.ts`, under `~/.tarfa-migrate.lock`), which leaves `~/.perch` a link
    to it and renames `relay-key.json` to `agent-key.json`, leaving the old name a link too (an
    agent from before the rename, brought back, would otherwise make a new key). It never merges:
    both holding something, or a `~/.perch` link to nothing, stops the agent, since starting on an empty `~/.tarfa` beside the old key would make
    a new key and every phone would refuse it. The CLI never moves it (an older agent may still
    run): it reads whichever exists (`resolveStateDir`, `resolveAgentKeyPath`), and
    `install-hooks` refuses until the move. Goes once every machine moved and no hook entry names it.
  - `@perch_command`/`_parent`/`_codex_thread` are read beside `@tarfa_*`, and the startup
    re-tags them (`retagLegacyOptions`) **before** `trackLiveWorkspaces`, `reconcileParked` and the
    prune (`application/startup-reconcile.ts`): a session missing its marker reads as a bare shell
    to park, kill or prune. `createSession` sets both names, so an agent from before the rename
    (still running until its restart, or a rollback) sees every session. Goes once every startup
    logs zero re-tagged for a week.
  - `~/.local/bin/perch` is a link to `tarfa`, `deploy/perch-cli.sh` (what an older install
    links) to `tarfa-cli.sh`, `@tarfa/cli` has both bins and `pnpm perch` runs the CLI, for one
    release after `tarfa` ships.
  - `deploy/check-leaks.sh` falls back to `$PERCH_LEAK_WORDS` and `~/.perch/leak-words.txt`, for a
    machine whose agent has not moved `~/.perch` yet. Goes with the `~/.perch` read.
  - The guard refuses `.perch/inbox/` and `@perch_parent`/`_codex_thread` too, and the quoting
    regex quotes `[Perch message` and `[Tarfa message`. `send` writes the Tarfa header since 0.1.2;
    the receivers' rules accept both spellings, and the Perch reads go a release after that.
  - `tarfa setup` swaps the service: stop `perch-agent`/`com.perch.agent`, move `~/.perch`,
    install and start `tarfa-agent`/`app.tarfa.agent` **before any step that can fail** (a failed
    hooks or serve step must not leave a remote machine with no agent), remove the old one last;
    never two agents on one hooks port. The old unit's drop-ins are copied to the new one.
    `port-owner` counts either unit as this user's agent meanwhile.
  Not renamed: the Noise prologue `perch-relay-noise-v3` (a wire change of its own), the
  `perch-<6 hex>` ids and `sessionPrefix` (data), and Pi's `perch-message` custom type.
