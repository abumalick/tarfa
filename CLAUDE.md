# Tarfa — agent guide

Tarfa (formerly Perch) is a mobile-first PWA to view and interact with Claude Code terminal
sessions (tmux workspaces) running on multiple machines, from an iPhone, served from tarfa.app.
An **agent** runs on each machine (e.g. a Mac and a Linux
box) with a loopback phone port, which its operator publishes (`tailscale serve`, Funnel, a
proxy); the **PWA** connects to that address directly, in an end-to-end Noise session keyed by
the phone's device key, and streams its terminals. No agent listens off loopback.

## Golden rules
- **All code, docs, comments, and commits in English.**
- **Testability is the top priority.** Clean / hexagonal architecture: pure domain +
  application (ports) layers, all I/O behind infrastructure/adapters. Unit-test the core
  with fakes; keep a thin, well-covered adapter layer.
- **Surgical changes, YAGNI.** Match surrounding style. Add comments only for genuinely
  tricky logic, not to restate code.
- Toolchain via **mise** (`mise.toml` pins node 24 + pnpm 11). Package manager is **pnpm**
  (workspace monorepo). Any Python would use **uv** (none today).
- **Never commit secrets.** Machine settings live in `~/.tarfa/agent.env` (a source install: the gitignored `deploy/agent.env`), keys in `~/.tarfa`. `deploy/agent.env.example` is the template.

## Layout
- `packages/contracts` (`@tarfa/contracts`) — the zod wire protocol and shared types.
  `ClientMessage` / `AgentMessage` discriminated unions. Terminal `data` is base64.
  **Change the protocol here first**, then the agent and PWA.
- `packages/agent` (`@tarfa/cli`) — per-machine agent. tmux via `node:child_process`,
  terminal streaming via `node-pty`, a loopback phone port phones connect to directly (served
  through `NoiseClientConnection`), and a `node:http` server on
  `127.0.0.1` with four bearer-token-guarded routes: `POST /hooks` (Claude Code hooks report
  attention here), `POST /unpark` (`tarfa unpark`), `POST /close` (`tarfa close`) and
  `POST /message` (`tarfa send`).
  Domain/application in `application/` + `ports/`, adapters in `infrastructure/`, wiring in
  `server/`. It is also the published npm package; packaging and releases: `docs/AGENT-RUNTIME.md`.
- `packages/secure-channel` (`@tarfa/secure-channel`) — the Noise IK session both ends run, its
  framing, the device hello, pairing codes and links, and refusals (see `docs/DEVICE-KEYS.md`).
- `packages/pwa` (`@tarfa/pwa`) — Svelte 5 (runes) PWA, launched as Tarfa. xterm.js terminal, vite-plugin-pwa
  (an update bar above the list's title and over the terminal's top, reload on tap: `registerType: 'prompt'`), Playwright e2e. Core logic (connection manager, aggregator, store) is in
  `src/core` + `src/adapters` and unit-tested with a fake socket; `src/lib` is the UI.
- **The PWA speaks English and French.** Every string a user reads goes in
  `src/core/i18n/en/<namespace>.ts` and its French twin (typed `Messages['<namespace>']`, so the
  typecheck fails on a missing entry) and is read with `msg()` from `src/i18n.svelte.ts` at the
  point of use, never in a module-level constant, which would freeze the language at load.
  The language follows the phone (`navigator.languages`), unless Settings → Language pins one
  (`tarfa.language`); `main.ts` applies it before the pairing prompt. Not translated: what the
  agent sends, commands inside messages, key caps, model and provider names, the default
  dictation presets, the body of the `/terms` and `/privacy` pages (one authoritative English
  text; their link labels are translated), and anything that only reaches a log. Connection diagnostics stay English
  at the source (the connection log keeps them) and are worded at display
  (`lib/machine-status.ts`).

## Commands (per package via `pnpm --filter @tarfa/<pkg> …`)
- Test: `test` (vitest). Types: `typecheck`. Build (pwa): `build`. E2E (pwa):
  `exec playwright test` (uses a faithful fake agent in `e2e/fake-agent.ts`).
- Run the whole suite: `pnpm -s test`. Keep it green; add tests with every change.

## Worktrees & on-device testing
Build each feature in its own git worktree; full runbook in `docs/WORKTREES.md`.
- **NEVER do feature work in the main checkout — and NEVER `git checkout`/`git checkout -b`
  there.** The main checkout is shared: switching its branch or leaving edits in its working
  tree blocks every other agent and process bound to it (the standing deploy, other worktrees'
  expectations). Start a feature with its own worktree *first* (below), before editing. If you
  somehow already have uncommitted edits in the main checkout, surface it and move them into a
  worktree — do not `checkout -b` in place to "branch" them.
- Create: `git worktree add .worktrees/<feature> -b <feature>` (`.worktrees/` is gitignored),
  then `pnpm install` (node_modules is per-worktree). Docs and version bumps too: nothing is
  committed in the main checkout.
- **Land with `pnpm land <feature>` (`deploy/land.sh`), never by hand.** It merges `origin/main`
  into the branch and runs the gate in the worktree, then, under a lock every checkout shares,
  fast-forwards main and pushes. A gate run in the shared checkout held an open merge there for
  minutes, and concurrent sessions tripped over it, reverted it, or pushed around it. A conflict
  stays in the worktree to resolve and re-land; a dirty or mid-merge main checkout is someone
  else's and is reported, never restored or reset. **Only local main is pushed to `main`:** the
  pre-push hook refuses `git push origin HEAD:main` (or any `<ref>:main`) and a `v*` tag whose
  commit is not on `origin/main` yet. Unit/integration tests bind ephemeral
  ports, so they run in parallel across worktrees with no clash.
- **e2e ports clash** — `vite preview` uses a fixed port. On the host running `run-pwa.sh`,
  **4173 is the standing deploy**; give each checkout its own:
  `E2E_PORT=4175 pnpm --filter @tarfa/pwa e2e` (build first — `vite preview` serves the gitignored `dist/`).
- **See a change working in a sandbox first** (`docs/SANDBOX.md`): `pnpm sandbox up` from a
  worktree runs that worktree's agent and PWA as a disposable machine (its own `HOME`, tmux
  server, runtime dir and ports, Claude logged in with a token kept off every command line,
  Codex on a ChatGPT login of the sandboxes' own, linked and never copied, with its hooks
  trusted), paired to a headless Chrome, beside every other sandbox and apart from the real agent.
  Where a change gets shown: the fake-agent e2e for the UI alone, a sandbox for anything that
  touches the agent, staging and the phone only for what needs the device (the Android
  keyboard, iOS install, voice, read-aloud, the share target, links to other apps, launch
  speed, Funnel). Either way the maintainer gives the verdict. Never call `tmux` without
  `-S <sandbox socket>` against one; `pnpm worktree:remove` takes a worktree's sandbox down.
- **Test a worktree build on the phone:** `pnpm serve:build .worktrees/<feature>` points the
  staging PWA on the tailnet at it (the installed PWA offers the update within ~60s, applied on a tap of its update bar; the home header shows the
  worktree slug as a badge); `pnpm serve:restore` flips back to main. From a public origin,
  `deploy/pwa-deploy.sh --dev` puts a checkout on a throwaway `tarfa-dev` Worker instead
  (`--dev --delete` afterwards).
- **Protocol changes need the worktree's agent too:** the PWA and agent share the zod wire
  protocol, so testing a protocol change on-device requires running the worktree's agent or
  the installed agent silently drops the new/changed messages. `pnpm serve:agent
  .worktrees/<feature>` runs that worktree's agent live and restarts the service (safe via
  `KillMode=process`); it takes the same phone port with the same identity, so the phone's entries
  reach it unchanged. `pnpm serve:agent-restore` goes back to the release. On a launcher machine
  (package install) it writes `~/.tarfa/agent-source` and the settings are `~/.tarfa/agent.env`; on a
  source install it flips `deploy/agent-live` and the secrets come from main's `deploy/agent.env`. A
  worktree branched before `run-agent.sh` learned to skip `deploy/agent.env` under the launcher will not
  start there: merge main into it. **Merging to main no longer updates the dev agent** (a tag plus
  `tarfa update` does): to run unreleased code, `pnpm serve:agent .` (the main checkout) and
  `pnpm serve:agent-restore` back to the release. Make additive protocol fields backward-compatible
  (e.g. `z.array(...).default([])`) so a version-skewed rollout degrades gracefully instead
  of the strict client parser dropping the whole message.

## Subsystem docs — read the one you are about to touch
Each holds the decisions behind its code ("things not to simplify"). They are not loaded
automatically: open the matching one before changing that area.
- `docs/AGENT-RUNTIME.md` — packaging and releases, `agent.env` and the launcher, `tarfa
  setup`/`apply`/`update`, the hooks port, the Perch → Tarfa rename reads.
- `docs/CONNECTIONS.md` — the phone port and its admission limits, address lists and address
  sync, `MachineConnection`'s connect chain, reconnect UX, the connection-event log.
- `docs/DEVICE-KEYS.md` — Noise IK, device keys in IndexedDB, the roster (`devices.json`),
  enrolment, pairing codes and links, refusals, push-on-handshake, secret files, `childEnv`,
  session channels and their ack backpressure (media, browser stream), the hooks secret kept off
  argv (`tarfa-hook.sh`), and the PWA's CSP (`core/csp.ts`).
- `docs/PWA-HOSTING.md` — tarfa.app and `pwa-deploy.sh`, legal pages, the staging (Tarfa Dev)
  origin, what a public origin can reach, the cold-launch path.
- `docs/WORKSPACES.md` — hidden folders, launchers, the create form's `--model` quoting,
  lifecycle log, parking, lost-server recovery, workspace ids, the `tarfa` CLI
  (`spawn`/`ls`/`wait`/`close`/`rename`), workspace links, scope reaping on close.
- `docs/MESSAGING.md` — `tarfa send` and cross-agent authority.
- `docs/ATTENTION-STATUS.md` — `tarfa-hook.sh` and hooks → status (`attention-decision.ts`), OSC 7501, the hook
  event log, background-task deferral, the kill guard, Codex hooks.
- `docs/VOICE.md` — dictation presets and keys, Claude voice (`/voice`), 🔊 read-aloud.
- `docs/TERMINAL-INPUT.md` — Android input adapter, keyboard bar (keys, dropdowns, cursor pad),
  select mode, OSC 52, links to other apps, media previews, attachments. Workspace-id links in
  the terminal are in `docs/WORKSPACES.md`.
- `docs/BROWSER.md` — the browser view and agent-browser sessions (its stream's backpressure is in
  `docs/DEVICE-KEYS.md`).
- `docs/MACHINE-LOAD.md` — the stats collector and the home screen's load strip.
- Runbooks: `docs/DEPLOY.md`, `docs/WORKTREES.md`, `docs/SANDBOX.md`, `docs/SETUP-MACHINE.md`,
  `docs/TMUX-OSC7501.md`.

## Invariants that bite anywhere
- **Every process the agent starts goes through `childEnv()`**: no child may inherit a `TARFA_`
  variable (`docs/DEVICE-KEYS.md`).
- **Every tmux target goes through `exactTarget` (`=name:`)**: tmux matches `-t` as a prefix,
  and `perch-1` is a prefix of `perch-10` (`docs/WORKSPACES.md`).
- **The PWA runs no script but its own bundle**: a new external host it must reach goes in
  `connect-src` in `core/csp.ts` (`docs/DEVICE-KEYS.md`).
- **Agents bind loopback only**; the hooks port is never published (`docs/AGENT-RUNTIME.md`).
- **Don't drop a Perch-era read early**: each goes only when its condition holds
  (`docs/AGENT-RUNTIME.md`).
- **Never suggest "clear site data"** to fix a stale PWA: it deletes the device key, and the
  device has to pair again (`docs/PWA-HOSTING.md`).
- **Deploy the PWA only with `deploy/pwa-deploy.sh`** from a clean, pushed main, and only once
  every agent is new enough for it (`MIN_AGENT_VERSION`, `docs/AGENT-RUNTIME.md`).
- **A user-facing string goes through i18n** (above); **a new agent capability is a feature
  name in `AGENT_FEATURES`**, never a version compare (`docs/VOICE.md`, read-aloud).

## Gotchas already fixed (don't regress)
- **A new `Workspace` field must be added to `workspaceSchema` too — the type guard will not
  tell you.** `messages.ts` asserts schema/domain agreement with
  `Equals<z.infer<typeof workspaceSchema>, Workspace>`, but that check is blind to a *missing
  optional* property: a type lacking an optional key is still assignable in both directions,
  so the drift typechecks clean. Since `z.object()` strips unknown keys, the agent then sends
  the field and the client parser deletes it before the store sees it — both sides' unit tests
  green, nothing in the UI, no error anywhere. `agentAddress` shipped this way once. Guard a
  new optional field with a `workspaceSchema.parse` test (the only thing that proves it
  survives the wire) and, when it renders, an e2e through `e2e/fake-agent.ts` (the only thing
  that proves it reaches the DOM).
- **Terminal encoding:** the agent base64-encodes the pty's UTF-8 bytes; the PWA must
  decode base64 → bytes → `TextDecoder` (UTF-8), never `atob` into a latin1 string (that
  mojibakes box-drawing/accents and breaks the xterm render). Guarded by a store unit test.
- **Machine routing:** the PWA routes attach/input/close by the **connection id** (the
  PWA's machine config id), not the agent's `TARFA_MACHINE_ID`. The aggregator stamps each
  workspace with the connection id. The e2e uses a deliberately mismatched agent id to
  cover this.
- **List on connect:** the agent sends workspaces in response to an explicit `list`, or pushes
  them right behind the handshake to a phone it serves at once (`docs/DEVICE-KEYS.md`). Otherwise the PWA sends `list` (with `listKeyterms`) once each session is
  authenticated, on every (re)connect (`openingRequests`). The e2e fake agent is faithful to both.
- **Restarting the agent must NOT kill tmux sessions:** the agent spawns the tmux server
  as a child, so it lives in the systemd unit's cgroup. The default
  `KillMode=control-group` would SIGTERM the whole cgroup on restart and take every
  workspace (and the Claude Code session inside it) down with it. `packages/agent/templates/tarfa-agent.service`
  sets **`KillMode=process`** so a restart stops only the agent; the tmux server and its
  sessions survive. Don't drop this. On restart the agent re-discovers live sessions via
  `tmux list-sessions` (no in-memory session registry), so workspaces reappear on the PWA's
  next `list`. Status is **durable** (`FileStatusStore` → `~/.tarfa/status.json`): it reloads
  on startup, so each session keeps its last status across a restart instead of resetting to
  `idle`, and entries for sessions that no longer exist are pruned at startup. After changing
  the unit, re-deploy it and `systemctl --user daemon-reload`; this and `install-hooks` must
  be redone per machine.

## The test gate is at commit, merge, AND push — don't punch holes in it
Three hooks (`deploy/git-hooks/`) run the full suite via a shared `run-tests.sh`:
`pre-commit`, `pre-merge-commit`, and `pre-push`. The merge and push hooks exist because
`pre-commit` alone does **not** gate `main`: git never runs it for merge commits (the
dominant integration path here), fast-forward merges, or direct ref moves. `pre-merge-commit`
catches red merges before they land; `pre-push` is the universal backstop so nothing red
reaches `origin`, including FF merges and `git update-ref` advances no commit hook can see.
- **The agent suite sandboxes itself, however it is started** (`test-sandbox.test-support.ts`):
  a private tmux server and a temporary `HOME`, with `TMUX`/`TMUX_PANE` removed. Its tests drive
  real tmux with bare `tmux` calls, and a session on the machine's real server is listed by the
  running agent, flashes on the phone and lands in `~/.tarfa/workspace-log.jsonl` as `exited`.
  `test-isolation.test.ts` fails if a worker escapes it, and the root `vitest.config.ts` applies
  the same setup to a filtered run from the repo root. `deploy/tarfa-cli.test.sh` clears `TMUX`
  and points `TMUX_TMPDIR` at a sandbox by hand; its `HOME` stays real because mise needs it, for
  paths that fail before touching anything.
- **Never land code on `main` through a path that skips the gate.** Do **not** use
  `git commit --no-verify`, `git push --no-verify`, or `git update-ref refs/heads/main`
  to integrate — every one of these bypasses the suite and is how red code reached `main`
  before these hooks existed. If the gate is in your way, the tests are red — fix them.
  `TARFA_GATE_PASSED` (pre-push skips the suite for the tree it names, never the leak check) is
  set by `deploy/land.sh` alone, for the tree it has just gated; never set it by hand.
- The gate first runs `deploy/check-leaks.sh`: gitleaks over the staged diff and history,
  then a whole-word check of tracked files against a word list kept **outside** the repo
  (`~/.tarfa/leak-words.txt`, or `$TARFA_LEAK_WORDS`) — names of other projects,
  organisations and hosts that must never be published. gitleaks only knows credential
  shapes, so it can't catch those; and committing the list would publish the names it
  guards. No list on a machine → that half is skipped. Use neutral fixture names (`foo`,
  `acme-org/acme-app`), never real ones.
- It then runs `pnpm -r typecheck` + `pnpm -r test` + `pnpm test:scripts`, builds the
  PWA and runs the Playwright **e2e** on a free port (the default 4173 is the standing
  deploy on the host running `run-pwa.sh`). The suite runs on **WebKit only** (the Tarfa client is exclusively WebKit —
  iPhone/iPad/Safari), so a machine needs it once — `pnpm --filter @tarfa/pwa exec
  playwright install webkit` — alongside `mise trust`; without them the gate fails closed.

## Pushing & merge conflicts
**There is no remote test CI on pushes.** The GitHub Actions are a gitleaks secret scan
(`.github/workflows/gitleaks.yml`), a backstop for the local leak check, and `release.yml`, which
runs on `v*` tags only and stages the npm package (see "Releasing" in `docs/DEPLOY.md`). The test
gate runs entirely on the local git hooks (commit/merge/push) before anything reaches `origin`.
So after a `git push`, do **not** wait for a remote test run — there is none (a pushed tag starts `release.yml`, which only stages a package). Verifying locally with
`pnpm -s test` + e2e is the whole story.

`origin` is a real GitHub remote (no push CI). `pnpm land` is what pushes main, and it
integrates a moved `origin/main` itself (merge into the branch, gate, retry); do **not** stop
and ask. When its merge of `origin/main` conflicts:
1. Resolve in the worktree by reading **both** sides and integrating the real intent — never
   blind-pick `-X ours`/`-X theirs`, which silently drops code.
2. Commit, then run `pnpm land <feature>` again (its gate decides): green → it lands; red, or a
   conflict hunk that's genuinely ambiguous → **stop and hand back**. Never push a red or
   guessed `main`.
If `land` reports local commits on main that origin lacks, they reached main without it: find
whose they are and hand back rather than pushing them.

## Reference
- Deploy and release runbook: `docs/DEPLOY.md`. Worktree runbook: `docs/WORKTREES.md`.
- The repo has no CI on pushes (only the tag-triggered `release.yml` and the gitleaks scan); verify locally (`pnpm -s test` + e2e) before pushing.
