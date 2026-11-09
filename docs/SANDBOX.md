# Sandboxes

A sandbox is a disposable Tarfa machine for one worktree: that worktree's agent and PWA,
running beside every other sandbox and apart from the real agent, paired to a headless Chrome.
Agents use it to see a change working (create a workspace, run Claude or a shell in it, watch
its status) without the phone, the staging PWA or the real agent, so any number of them can
test at once. Linux only (systemd user units).

```bash
pnpm sandbox up                      # from the worktree: start it, pair the browser
ab snapshot -i                       # the browser is your current ab session
ab screenshot .tmp/list.png
pnpm sandbox rebuild                 # after a code change; --agent or --pwa for one side
pnpm sandbox exec -- pnpm -s tarfa ls
pnpm sandbox down
```

## Which test where

| Where | What it runs | Use it for |
|---|---|---|
| e2e (`pnpm --filter @tarfa/pwa e2e`) | Playwright WebKit against `e2e/fake-agent.ts`, in the gate | the UI on its own: layout, states, view logic |
| a sandbox | the real agent and PWA, Chrome, real Claude and shell workspaces | anything that touches the agent: create/close/park/unpark, hooks and status, OSC 7501, `tarfa send`/`wait`/`close`, protocol changes, pairing, the terminal |
| staging + the phone (`pnpm serve:build`) | the maintainer's device | the Android keyboard, iOS Safari and install, voice and the mic, read-aloud, the share target, links handed to other apps, cold-launch speed, Funnel |

Either of the last two ends the same way: show the result and wait for the maintainer's
verdict (`.claude/skills/work/SKILL.md`, Phase 4).

## Commands

All take `--worktree <path>`; without it they act on the checkout you are in.

- `up` — builds the PWA, starts the agent and a `vite preview`, pairs the browser, prints the
  PWA address, the tmux socket and the env file. A sandbox already up is refused; one whose
  agent died is replaced.
- `down` — stops the tmux server, the browser and both units, and deletes the sandbox.
  `pnpm worktree:remove` does it for you.
- `rebuild [--agent|--pwa]` — rebuilds the PWA and taps the browser's update banner, and/or
  reinstalls the hooks and restarts the agent. Workspaces survive (the agent unit has
  `KillMode=process`, as in production).
- `exec -- <cmd…>` — runs a command with the sandbox's environment, from where you are.
- `pair` — pairs the browser again with a fresh link (after its idle reap, say).
- `status` — ports, units, tmux sessions, the agent's last log lines.
- `ls` — every sandbox on the machine; `gc` removes those whose worktree is gone or whose
  agent is not running, never a live one unless given `--older-than-hours N`.

## Driving it

The browser is the `ab` session `up` names (`<workspace>__sb-<slug>`), and the real agent shows
it on your own workspace. Open a workspace through the PWA's form, and pick **Sonnet** for
Claude: the form still preselects Opus. To type into a workspace from the shell, send the text
and the Enter as two calls, or Claude Code keeps the text unsubmitted:

```bash
SOCK="$(dirname "$(pnpm -s sandbox env)")/tmux/tmux-$(id -u)/default"
tmux -S "$SOCK" send-keys -t '=demo-a-1:' 'Reply with just: ok'
tmux -S "$SOCK" send-keys -t '=demo-a-1:' Enter
```

Never call `tmux` without `-S` there: it would reach the real server.

## What is inside

`~/.cache/tarfa-sandbox/<slug>/` (`TARFA_SANDBOX_ROOT` overrides the parent), private to the
user. Not the worktree's `.tmp`: a tmux socket path must fit about 100 bytes.

- `home/` is the sandbox's `HOME`: `.tarfa` (agent state, `agent.env`), `.claude` (hooks,
  `"model": "sonnet"`), `.claude.json` (onboarding done and the projects trusted, so a new
  Claude session opens on its prompt), `.gitconfig`, and a `CLAUDE.md` telling sessions where
  they are.
- `projects/demo-a`, `projects/demo-b` are throwaway repositories, the machine's project root.
- `tmux/` is `TMUX_TMPDIR` and `run/` is `XDG_RUNTIME_DIR`, so the sandbox lists only its own
  agent-browser sessions. The real user bus is kept, so `systemctl --user` and the pane scope
  reaper still work.
- mise's directories point at the real home: its installs and its list of trusted folders
  live there, and a fake `HOME` would make every worktree untrusted.
- `secrets.env` holds the Claude token, read by the agent unit through `EnvironmentFile`, so it
  is in no command line; every pane inherits it.
- `manifest.json` has the ports, units and browser session; `env.sh` exports the environment.

## The Claude login

Sandboxes log Claude Code in with a one-year token from `claude setup-token`, read from
`~/.config/tarfa-sandbox/claude-oauth-token` (`TARFA_SANDBOX_CLAUDE_TOKEN_FILE` overrides it;
0600). A machine without it: copy it from the password manager item "Tarfa sandbox - Claude
Code OAuth token", or make a new one with `claude setup-token`, which needs the account
owner's approval. Login files are never copied: each copy refreshes on its own and can log the
original out.

Codex is not set up in sandboxes yet: its login and the trust its hooks need are still open.

## Limits

- **Disposable, not contained.** Sessions in a sandbox run as your user and can reach any path
  by name. The fake `HOME` makes every default path the sandbox's, and the kill guard is
  installed there; that prevents accidents, not intent.
- A daemon a pane starts with `setsid` escapes `down` (`tmux kill-server`) as it escapes a
  close in production; closing the workspace in the PWA reaps its scope. `pgrep -af` the
  sandbox path to find one.
- The units cap the agent at 4 GB and the preview at 1 GB; workspaces run in their own scopes,
  outside that cap, as real ones do.

## Checking the tool itself

`deploy/sandbox.test.sh` (in the gate) runs every command against stubs. The live check runs
two sandboxes for real and confirms nothing reaches the real agent:

```bash
TARFA_SANDBOX_LIVE=1 TARFA_SANDBOX_LIVE_CLAUDE=1 bash deploy/sandbox.live.test.sh
```
