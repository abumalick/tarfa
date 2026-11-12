# Feature worktrees

Work on each new feature in its own git worktree under `.worktrees/` (gitignored),
so the `main` checkout stays untouched and several features can be built and tested
side by side.

## Why ports don't clash

Almost everything already binds an ephemeral port, so parallel worktrees are safe:

- **Unit / integration tests** (`pnpm -r test`): the agent's `ws-server` tests and the
  PWA's `e2e/fake-agent.ts` bind `port: 0` — the OS hands out a free port that the test
  reads back. Run them in as many worktrees at once as you like, no coordination needed.
- **Vite dev server** (`pnpm --filter @tarfa/pwa dev`): defaults to 5173 and
  auto-increments to the next free port when one is taken.
- **Playwright e2e** (`pnpm --filter @tarfa/pwa e2e`): the **only** fixed port. The
  config runs `vite preview --port ${E2E_PORT:-4173} --strictPort`, so two checkouts both
  defaulting to 4173 collide. Assign each its own `E2E_PORT`.

> **On the host running `deploy/run-pwa.sh`, 4173 is already taken.** It keeps a standing
> `vite preview --port 4173 --strictPort` running (the PWA served to the phone), so the
> default 4173 will always fail there — for *any* checkout, including `main`. Use 4174+ for
> all local e2e on that host.

## Port convention (e2e only)

4173 is reserved for the standing deploy. Assign each checkout its own port from 4174 up:

| Checkout                  | E2E_PORT |
| ------------------------- | -------- |
| standing deploy (run-pwa) | 4173 (reserved) |
| `main` local e2e          | 4174     |
| first feature worktree    | 4175     |
| second feature worktree   | 4176     |
| …                         | …        |

Pass it on the command line (or export it once per shell in that worktree):

```sh
E2E_PORT=4175 pnpm --filter @tarfa/pwa e2e
```

## Recipe

```sh
# from the primary checkout (e.g. ~/workspace/tarfa)
git worktree add .worktrees/<feature> -b <feature>
cd .worktrees/<feature>
mise trust                         # new path, so mise.toml isn't trusted yet — see note below

pnpm install                       # node_modules is per-worktree (not committed)

pnpm -s test                       # safe to run in parallel with other worktrees

# e2e: vite preview serves dist/, which is gitignored, so build first
pnpm --filter @tarfa/pwa build
E2E_PORT=4175 pnpm --filter @tarfa/pwa e2e   # use this worktree's assigned port
```

Notes:
- The `build` before e2e is required: `vite preview` serves `dist/`, and `dist/` is
  gitignored so a fresh worktree has none. Rebuild after each source change you want
  the e2e to exercise.
- Playwright browsers live in a shared cache (`~/.cache/ms-playwright`), so no
  per-worktree browser install is needed — only `pnpm install` for node_modules
  (which rebuilds `node-pty` and runs the spawn-helper `chmod` postinstall).
- `mise` pins node/pnpm repo-wide, but trust is per-path, not per-repo: a worktree's
  `mise.toml` is a copy at a new path, so it starts untrusted even though the main
  checkout's copy is trusted. Skipping `mise trust` doesn't just break interactive
  commands — any Claude Code hook that shells out through a mise shim (`node`, `pnpm`, …)
  with cwd inside the worktree fails the same way, surfacing as a raw `mise ERROR` in
  hook output instead of an obvious "run mise trust" prompt.

## Testing in a sandbox

Most changes can be seen working without the phone: `pnpm sandbox up` from the worktree starts
a disposable Tarfa machine from that worktree's code, paired to a headless browser, and any
number of worktrees can have one at once. `pnpm worktree:remove` takes it down. See
`docs/SANDBOX.md`, which also says which changes still need the phone.

## Testing a worktree build on the phone

To try a worktree's build on the real installed PWA on the phone (without permanently
replacing production), temporarily point the live deploy at it:

```sh
pnpm serve:build .worktrees/<feature>   # build it and serve it at the live origin
# … test on the phone; the installed PWA offers the update within ~60s (tap its update bar) …
pnpm serve:restore                      # point back at main's build
```

`run-pwa.sh` serves a `deploy/pwa-live` symlink (gitignored); `serve:build` rebuilds the
worktree's PWA with `TARFA_BUILD_LABEL=<slug>` and flips the symlink at it. While a test
build is live, the home header shows the slug as a badge (production `main` shows none), so
you always know what the device is serving. Restarting the `tarfa-pwa` service does **not**
restore main: on start `run-pwa.sh` runs `serve-build.sh --ensure`, which re-points the
symlink at main only when it is absent or dangling, so an active worktree deploy survives a
restart. Run `serve:restore` to flip back.

### Serving a worktree's agent

A protocol change touches both the PWA **and** the agent, so testing it on-device needs the
agent to run the worktree's code too — otherwise the updated PWA talks to the installed
agent and the versions skew. The agent equivalent of `serve:build`:

```sh
pnpm serve:agent .worktrees/<feature>   # run that worktree's agent live, restart the service
# … test on the phone …
pnpm serve:agent-restore                # back to the installed release
```

**Merging to main does not update the dev agent.** A machine installed from the package runs the
released `@tarfa/cli`; a tag plus `tarfa update` (`docs/DEPLOY.md`, "Releasing") is what changes it.
To run unreleased code there, use `pnpm serve:agent .` (the main checkout as the override) and
`pnpm serve:agent-restore` to go back to the release.

On a launcher machine (a package install: the unit runs `~/.tarfa/bin/tarfa-agent`), `serve:agent`
writes `~/.tarfa/agent-source`, which the launcher follows while it still points at a checkout, and
`serve:agent-restore` removes it. The agent's settings come from `~/.tarfa/agent.env`, not from main's
`deploy/agent.env`; `run-agent.sh` skips its own `deploy/agent.env` when the launcher has set
`TARFA_AGENT_ENV`. A worktree branched before that skip will not start under the launcher (its
`run-agent.sh` would source a `deploy/agent.env` that is not there): merge main into it first.
The worktree also needs `mise trust` (run it there once): `run-agent.sh` calls `mise exec`, and a service
cannot answer a trust prompt, so without it the service restart-loops until `pnpm serve:agent-restore`.

On a source install, `run-agent.sh` runs the agent from a `deploy/agent-live` symlink (gitignored)
when it resolves, else from main; secrets are sourced from main's `deploy/agent.env`, so the
worktree needs no `agent.env` of its own. `serve:agent` flips the symlink at the worktree and
restarts the service (`systemctl --user restart tarfa-agent`, or `launchctl kickstart` on
macOS). The restart is safe: `KillMode=process` keeps the tmux server and its sessions alive
(the agent re-discovers them via `tmux list-sessions`), each session keeps its status (it is
stored in `~/.tarfa/status.json`), and the PWA briefly reconnects.
The worktree must have its deps installed (`pnpm install`) since the agent runs from its
source. Restarting the `tarfa-agent` service does **not** restore main on its own (same as
the PWA) — the symlink (or `agent-source`) persists across restarts; run `serve:agent-restore` (or
`worktree:remove`, below) to flip back.

`agent-live` (and `agent-source`) is a **single global slot**: there is one symlink and one agent service, so two
sessions each running `serve:agent` on their own worktree clobber each other (last writer
wins). If the live agent is unexpectedly running another worktree's code, a parallel session
grabbed the slot — check `readlink deploy/agent-live`. `worktree:remove` only restores the
agent if the slot points into the worktree it's removing, so it won't disturb another
session's serve.

All the `serve:*` commands and `worktree:remove` act on the **main** checkout's `deploy/*-live`
symlinks wherever they run from, so they work the same from inside a worktree
(`pnpm serve:agent .`).

## Git hooks (auto test + build)

The repo ships git hooks in `deploy/git-hooks/`, activated once per clone with:

```sh
pnpm hooks:install   # sets core.hooksPath=deploy/git-hooks
```

`core.hooksPath` is shared via the common git dir and holds an absolute path, so every
worktree runs the main checkout's hook scripts; each one then calls the `run-tests.sh` or
`build-current.sh` of the worktree it runs in. This single command covers `main` and every
current or future worktree — no per-worktree setup.

What they do:

- **pre-commit / pre-merge-commit / pre-push** — run the same gate
  (`deploy/git-hooks/run-tests.sh`): the leak check (`deploy/check-leaks.sh`), `pnpm -r
  typecheck`, the unit tests (`pnpm -r test`) and deploy-script tests (`pnpm test:scripts`),
  then a PWA build and the Playwright e2e on a free port. A failure aborts the commit, merge
  or push. `pre-commit` alone would not gate `main` — git skips it for merge commits and
  fast-forwards — which is why the merge and push hooks exist.
- **post-commit / post-merge** — rebuild the current working tree's PWA
  (`deploy/build-current.sh`). A hook runs in the working tree where the action
  happened, so committing in `main` rebuilds main's `dist` (which the live deploy serves
  — the phone offers the update) and committing in a feature worktree rebuilds *that*
  worktree's `dist` without touching the live deploy. `post-merge` covers merges
  (including fast-forwards, which create no commit), so merging a worktree into `main`
  rebuilds main. Skip a build with `TARFA_NO_BUILD=1 git commit …`.

A feature-worktree build only produces that worktree's `dist`; it does **not** repoint
the live deploy. To actually serve it on the phone, still use `pnpm serve:build` (above).

## Cleanup

```sh
# from the main checkout's directory (nothing here edits its working tree)
pnpm land <feature>                          # merge origin/main, gate here, land on main, push
pnpm worktree:remove .worktrees/<feature>   # safe removal (see below)
git branch -d <feature>                      # once landed
```

`pnpm land` (`deploy/land.sh`) is the only way onto main. The slow part (merging
`origin/main` into the branch and running the gate) happens in the worktree, in parallel
with other sessions; the main checkout is touched only under a lock shared by every
checkout, for a fast-forward and a push whose suite pre-push skips because `land` just gated
that exact tree (`TARFA_GATE_PASSED`; the leak check still runs). It refuses a main checkout
that is dirty or mid-merge, and local commits on main that origin lacks, and goes round again
when `origin/main` moved during its gate. The pre-push hook refuses any push to a remote's
`main` but local `main`'s, and a `v*` tag not yet on `origin/main`.

`pnpm worktree:remove` wraps `git worktree remove` with a deploy safety check: if a live
symlink is currently serving that worktree — `deploy/pwa-live` (you ran `serve:build`),
or `deploy/agent-live` (you ran `serve:agent`) and never restored — it flips that deploy back to
main **first**, so removing the worktree can't leave the PWA or agent pointed at a vanished
checkout. It then runs `serve:build --heal` and `serve:agent --heal` as backstops.
Like plain `git worktree remove`, it refuses if the worktree has uncommitted changes —
commit them or use `git worktree remove --force` yourself to discard.

If a worktree build ever does get removed out-of-band (raw `git worktree remove`, a
deleted directory), `pnpm serve:heal` restores main whenever the live symlink dangles;
restarting the `tarfa-pwa` service does the same (on start it re-points a dangling or missing
symlink at main, and leaves a healthy one alone).
