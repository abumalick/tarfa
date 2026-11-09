---
name: work
description: Use to implement any Tarfa feature, fix, or change. Enforces the project development flow — brainstorm first, a mandatory git worktree for every change, TDD on a clean/hexagonal architecture, a verdict gate (sandbox screenshots, or the phone for device-only changes), then `pnpm land` (a locked landing on main) with worktree cleanup. Use whenever the user asks to build, add, implement, fix, or change behavior in Tarfa.
---

# Work — Tarfa development flow

A thin orchestrator. It owns the **sequence** and the Tarfa-specific glue; each phase
delegates to the existing superpowers skill. Do not restate TDD/worktree rules here —
invoke the real skills so they stay the source of truth.

It assumes the public [`superpowers`](https://github.com/obra/superpowers) Claude Code
plugin is installed; the `superpowers:*` skills below come from it.

Follow the phases in order. Create one todo per phase.

## Phase 1 — Brainstorm → plan

Invoke `superpowers:brainstorming`. Nothing is built before a design exists. The
brainstorming skill chains to `writing-plans`; let it. Scale it down for trivial work,
but never skip it.

The specs and plans these skills write under `docs/superpowers/` are local working notes:
that directory is gitignored, so skip their "commit the design doc / plan" steps and leave
them uncommitted. Anything a future reader of the repo needs belongs in the code, a test,
`CLAUDE.md`, or a top-level `docs/*.md` instead.

## Phase 2 — Worktree gate (strict path rule)

Decide from the agreed scope:

Every change gets a worktree, docs and version bumps included. The main checkout is
shared: a commit or merge there holds its index for the minutes the gate runs, and every
other session that tries to land meanwhile is refused.

Create it via `superpowers:using-git-worktrees`, following Tarfa's convention:

```bash
git worktree add .worktrees/<feature> -b <feature>
cd .worktrees/<feature> && pnpm install   # node_modules is per-worktree
```

`<feature>` is a short kebab-case slug for the work. All implementation happens inside
the worktree.

## Phase 3 — Implement (TDD + clean architecture)

Invoke `superpowers:test-driven-development`. While implementing, honor Tarfa's
hexagonal layering: pure domain + application (`application/`, `ports/`), all I/O behind
infrastructure adapters (`infrastructure/`), wiring in `server/`. Unit-test the core with
fakes. Keep `pnpm -s test` green; add tests with every change.

Do not advance to Phase 4 until tests pass and you have verified the change does what it
should.

## Phase 4 — Show it, then wait for the verdict

When the work is green and verified, show it to the user and **stop and wait** for their
verdict. Where you show it depends on what the change needs (`docs/SANDBOX.md`, "Which test
where"):

**A sandbox, by default.** Anything a desktop Chrome can show: UI, the workspace list, the
create form, park/unpark, hooks and status, `tarfa send`/`wait`/`close`, pairing, terminal
rendering, protocol and other agent changes. It runs your worktree's agent and PWA on their
own, beside every other agent's, so there is nothing to queue for. From the worktree:

```bash
pnpm sandbox up                  # your worktree's agent + PWA, paired to a headless browser
ab snapshot -i                   # drive it: ab click/fill, ab screenshot .tmp/<name>.png
pnpm sandbox rebuild             # after a code change (workspaces survive)
```

Pick **Sonnet** in the create form for a Claude workspace. Take screenshots of what the
user should look at and send them with one line saying what to check (`telegram-send` skill:
`tg-send file <png…> --photo`). Keep the sandbox up until the verdict, in case they ask for
more; `pnpm worktree:remove` takes it down.

**Staging and the phone, only for what needs the device:** the Android keyboard, iOS
Safari or install, voice and the mic, read-aloud, the share target, links handed to other
apps, cold-launch speed, Funnel. Put it on the staging PWA yourself; it needs no permission,
since staging is a separate origin from tarfa.app. First check that no other worktree is
being served:

```bash
readlink deploy/pwa-live                      # in the main checkout
curl -s http://127.0.0.1:4173/version.json    # label "main" means it is free
```

If it points at another worktree (label other than `main`), another agent is testing:
do not serve over it; tell the user and wait. Otherwise run, from the main checkout:

```bash
pnpm serve:build .worktrees/<feature>
```

This builds the worktree's PWA and points the staging deploy at it. The installed
staging PWA offers the update within ~60s (app must be foregrounded), and the home header
shows the `<feature>` slug as a badge.

Either way, **stop and wait** for the user's verdict. Do not proceed.

## Phase 5 — Iterate or integrate

- **Rejected / feedback** → return to Phase 3, then re-offer Phase 4.
- **Approved** → integrate, in this order, from the main checkout's directory (none of
  these edits its working tree; `land` runs its gate in the worktree):

```bash
pnpm serve:restore                       # only if you served staging: flip it back to main
pnpm land <feature>                      # deploy/land.sh: merge origin/main, gate, land, push
pnpm worktree:remove .worktrees/<feature>  # restores staging, takes the sandbox down, removes
git branch -d <feature>
```

`land` merges `origin/main` into the branch and runs the gate **in the worktree**, then,
under a lock every session shares, fast-forwards main to the branch and pushes it. Several
sessions can land at once: each waits its turn for the few seconds the lock is held, and goes
round again if `origin/main` moved during its gate. It never works around what it finds:

- **A conflict with `origin/main`** is left open in the worktree. Resolve it there — read
  *both* sides and integrate the actual intent; never blind-pick with `-X ours`/`-X theirs`,
  which silently drops code — commit, and run `pnpm land <feature>` again. If a hunk is
  genuinely ambiguous, stop and hand back to the user.
- **A red gate** lands nothing. Fix it in the worktree and run `land` again.
- **A dirty main checkout, or one with an open merge**, belongs to someone else: say so and
  hand back. Never `restore`, `reset` or stash it.
- **Never push a branch to main** (`git push origin HEAD:main`, or any `<ref>:main`): the
  pre-push hook refuses it, since it jumps every other session's landing and leaves their
  mains diverged. Never run `git checkout main`, `git merge` or `git commit` in the main
  checkout either.

On landing, the post-merge hook rebuilds main's dist, so the live PWA returns to main.
`pnpm worktree:remove` is a safe wrapper around `git worktree remove`:
if the live deploy is still serving the worktree being removed, it flips back to main
first so the PWA is never left pointing at a vanished build.

## Phase 6 — Closeout report

End every run with a short, explicit status:

- **What was done** — one line.
- **What's left** — anything outstanding, or "nothing".
- **Session state** — one of:
  - **Ready to close** — landed on main and the worktree is removed.
  - **Open — awaiting your verdict** — Phase 4 shown (sandbox screenshots sent, or
    staging served), not yet approved.
  - **Open — <reason>** — e.g. tests failing, merged but worktree not yet cleaned, blocked.

Be honest about partial states. If something was skipped or failed, say so plainly.
