# Sandboxes

A sandbox is a disposable Tarfa machine for one worktree: that worktree's agent and PWA,
running beside every other sandbox and apart from the real agent, paired to a headless Chrome.
Agents use it to see a change working (create a workspace, run Claude, Codex or a shell in it,
watch its status) without the phone, the staging PWA or the real agent, so any number of them can
test at once. Linux only (systemd user units); the browser is
[agent-browser](https://github.com/vercel-labs/agent-browser).

```bash
pnpm sandbox up                      # from the worktree: start it, pair the browser
B="$(jq -r .browser "$(dirname "$(pnpm -s sandbox env)")/manifest.json")"
agent-browser --session "$B" snapshot -i
agent-browser --session "$B" screenshot .tmp/list.png
pnpm sandbox rebuild                 # after a code change; --agent or --pwa for one side
pnpm sandbox exec -- pnpm -s tarfa ls
pnpm sandbox down
```

## Which test where

| Where | What it runs | Use it for |
|---|---|---|
| e2e (`pnpm --filter @tarfa/pwa e2e`) | Playwright WebKit against `e2e/fake-agent.ts`, in the gate | the UI on its own: layout, states, view logic |
| a sandbox | the real agent and PWA, Chrome, real Claude, Codex and shell workspaces | anything that touches the agent: create/close/park/unpark, hooks and status, OSC 7501, `tarfa send`/`wait`/`close`, protocol changes, pairing, the terminal |
| staging + the phone (`pnpm serve:build`) | the maintainer's device | the Android keyboard, iOS Safari and install, voice and the mic, read-aloud, the share target, links handed to other apps, cold-launch speed, Funnel |

Either of the last two ends the same way: show the result and wait for the maintainer's
verdict (`.claude/skills/work/SKILL.md`, Phase 4).

## Commands

All take `--worktree <path>`; without it they act on the checkout you are in.

- `up` — builds the PWA, starts the agent, a `vite preview` and (with a Codex login) the Codex
  app server, pairs the browser, prints the
  PWA address, the browser session, the tmux socket and the env file. A sandbox already up is
  refused; one whose agent died is replaced. If anything fails on the way, it is taken down
  again. `TARFA_SANDBOX_NO_BROWSER=1` skips the browser and only prints the pairing link (`tarfa pair --link`, which the browser opens).
- `down` — stops the tmux server, the browser and its units, and deletes the sandbox.
  `pnpm worktree:remove` does it for you.
- `rebuild [--agent|--pwa]` — rebuilds the PWA and taps the browser's update pill, and/or
  reinstalls the hooks and restarts the agent. Workspaces survive (the agent unit has
  `KillMode=process`, as in production).
- `exec -- <cmd…>` — runs a command with the sandbox's environment, from where you are.
- `pair` — pairs the browser again with a fresh link (after its idle reap, say).
- `status` — ports, units, tmux sessions, the agent's last log lines.
- `ls` — every sandbox on the machine; `gc` removes those whose worktree is gone or whose
  agent is not running, never a live one unless given `--older-than-hours N`, and never one
  another sandbox command is working on (each takes `<root>.lock`).

A sandbox is named after its worktree: the folder name's first 12 characters and a hash of its
path, so two checkouts with the same folder name never share one. A command run from another
checkout than the sandbox's own is refused.

## Driving it

The browser is the agent-browser session `up` prints: `sb-<slug>`, prefixed with your own
workspace's id and `__` when you run inside a Tarfa workspace, so the real agent shows it there
for the maintainer to watch. Open a workspace through the PWA's form and pick **Sonnet** for
Claude: the form preselects Opus, which stays available for a test that needs it. To type into a workspace from the shell, send the text
and the Enter as two calls, or Claude Code keeps the text unsubmitted:

```bash
SOCK="$(dirname "$(pnpm -s sandbox env)")/tmux/tmux-$(id -u)/default"
tmux -S "$SOCK" send-keys -t '=demo-a-1:' 'Reply with just: ok'
tmux -S "$SOCK" send-keys -t '=demo-a-1:' Enter
```

Never call `tmux` without `-S` there: it would reach the real server.

## What is inside

`~/.cache/tsb/<slug>/` (`TARFA_SANDBOX_ROOT` overrides the parent), private to the user. Kept
short on purpose: the sandbox's tmux and agent-browser sockets live under it, and a unix socket
path holds at most 107 bytes. `up` refuses a folder in which
`<slug>/home/.codex/app-server-control/app-server-control.sock` would pass that, a bound that keeps
every socket under it short (that one is only a link to Codex's real socket in `/tmp`, which the
agent connects to).

- `home/` is the sandbox's `HOME`: `.tarfa` (agent state, `agent.env`), `.claude` (hooks,
  `"model": "sonnet"`), `.codex` (hooks, a `config.toml` of its own, the login linked),
  `.claude.json` (onboarding done and the projects trusted, so a new Claude session opens on its
  prompt), `.gitconfig`, and a `CLAUDE.md` telling sessions where they are.
- `projects/demo-a`, `projects/demo-b` are throwaway repositories, the machine's project root.
- `tmux/` is `TMUX_TMPDIR` and `run/` is `XDG_RUNTIME_DIR`, so the sandbox lists only its own
  agent-browser sessions. The real user bus is kept, so `systemctl --user` and the pane scope
  reaper still work.
- mise's directories point at the real home: its installs and its list of trusted folders
  live there, and a fake `HOME` would make every worktree untrusted.
- `secrets.env` holds the Claude token, read by the agent unit through `EnvironmentFile`, so it
  is in no command line; every pane inherits it, and `env.sh` loads it, so
  `pnpm sandbox exec -- claude` is logged in too.
- `manifest.json` has the ports, units and browser session; `env.sh` exports the environment.

## The Claude login

Sandboxes log Claude Code in with a one-year token from `claude setup-token`, read from
`~/.config/tarfa-sandbox/claude-oauth-token` (`TARFA_SANDBOX_CLAUDE_TOKEN_FILE` overrides it;
0600). On a machine without it, make one with `claude setup-token` (it needs the account
owner's approval in a browser) and keep a copy in your password manager. Login files are never
copied: each copy refreshes on its own and can log the original out.

## The Codex login

Sandboxes share one ChatGPT login of their own, `~/.config/tarfa-sandbox/codex/auth.json`
(`TARFA_SANDBOX_CODEX_HOME` overrides the folder), never your `~/.codex`. Make it once, with the
account owner's approval in a browser:

```bash
mkdir -p -m 700 ~/.config/tarfa-sandbox/codex
CODEX_HOME=~/.config/tarfa-sandbox/codex codex login --device-auth
```

Run the last line again when Codex in a sandbox says to sign in again. Without the login, or
without a `codex` that runs, `up` still works, says so, and starts no Codex app server; a login
made later reaches a sandbox at its next `up`. A `CODEX_HOME` in your environment is dropped
inside a sandbox, since Codex would prefer it to the sandbox's `HOME`.

- **Linked, never copied.** Codex's refresh token is single-use: a copy that refreshes signs
  out every other copy. Each sandbox's `home/.codex/auth.json` and `auth.lock` are links to the
  shared files; Codex writes a refreshed token onto the link's target and takes its commit lock
  beside it, so every sandbox sees each refresh. A separate login, rather than links to your
  own, keeps a refresh race in a sandbox from ever signing your own Codex out.
- **The hooks are trusted by `up`.** Codex runs a hook only once it is trusted in `/hooks`, which
  stores a hash of the hook in `config.toml`. `up` (and `rebuild --agent`) writes those hashes
  for exactly the hooks `install-hooks` wrote, computed as Codex 0.167 computes them, and prints
  the installed Codex version beside the one the hashes were made for. If a Codex release hashes
  differently, its hooks stop reporting in sandboxes (the live check fails);
  trust them by hand in `/hooks`, or start Codex with `--dangerously-bypass-hook-trust`, until
  `codex_hook_trust` in `deploy/sandbox.sh` is updated.
- **The app server is a unit.** `tarfa spawn --cli codex` and `tarfa send` talk to
  `codex app-server`, which `up` runs as the unit `tarfa-sb-<slug>-codex`, so `down` stops it
  with the rest.

## Limits

- **Disposable, not contained.** Sessions in a sandbox run as your user and can reach any path
  by name. The fake `HOME` makes every default path the sandbox's, and the kill guard is
  installed there; that prevents accidents, not intent.
- A daemon a pane starts with `setsid` escapes `down` (`tmux kill-server`) as it escapes a
  close in production; closing the workspace in the PWA reaps its scope. `pgrep -af` the
  sandbox path to find one.
- The units cap the agent at 4 GB, the Codex app server at 2 GB and the preview at 1 GB;
  workspaces run in their own scopes, outside that cap, as real ones do. So `up` refuses a fifth
  sandbox while four are up (`TARFA_SANDBOX_MAX` changes the limit) and names the running ones.
  Those are usually other agents': never take one down. Wait for one to finish, run
  `pnpm sandbox gc` to clear dead ones, or ask the maintainer; for a UI-only change, the fake-agent
  e2e needs no sandbox. Inside a sandbox, run one Claude session at a time and wrap test runs
  and builds in `heavy` where it exists.

## Checking the tool itself

`deploy/sandbox.test.sh` (in the gate) runs every command against stubs. The live check runs
two sandboxes for real and confirms nothing reaches the real agent:

```bash
TARFA_SANDBOX_LIVE=1 TARFA_SANDBOX_LIVE_CLAUDE=1 TARFA_SANDBOX_LIVE_CODEX=1 bash deploy/sandbox.live.test.sh
```
