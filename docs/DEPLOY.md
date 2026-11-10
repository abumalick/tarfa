# Deploying Tarfa (macOS and Linux agents, a phone client)

Tarfa runs an **agent** on each machine and a **PWA**, Tarfa, that your phone installs from
tarfa.app. Each agent listens on a loopback **phone port** (`TARFA_PHONE_PORT`, default 8797)
that its operator publishes (`tailscale serve`, Funnel or a proxy; see "The phone port" below),
and the PWA connects there directly, end to end encrypted with a device key (a Noise IK session
pinned to the agent's key). Both listeners bind `127.0.0.1` only: the hooks endpoint
(`TARFA_PORT`) and the phone port.

## 0. Prerequisites (every machine)
- A machine published with `tailscale serve` or Funnel, and the machine hosting the staging PWA (step 5), need Tailscale with MagicDNS + HTTPS enabled in the tailnet admin (`https://login.tailscale.com/admin/dns`). An agent published another way (a reverse proxy) needs no Tailscale.
- `tmux` and [mise](https://mise.jdx.dev). Nothing else: no repository, no pnpm, no compiler.

## Install the package
```sh
mise use -g node@24 npm:@tarfa/cli@<version>   # then: tarfa setup … (next section)
```
`node-pty` ships prebuilds for macOS and Linux and the install runs no lifecycle scripts (mise
installs with `--ignore-scripts`), so there is nothing to build. A **global node 24 is required**:
the `~/.local/bin/tarfa` wrapper and the service's launcher look node up from `$HOME`, never from
the folder they are run in, so a project's own node never runs Tarfa.

mise lays the install (`mise where npm:@tarfa/cli`) out in one of two ways, and every lookup
(the launcher, the wrapper, `tarfa update`, the port check) takes either: npm's, with the CLI linked
at `<install>/bin/tarfa`, or aube's (a newer mise's npm backend), with no `bin/` and the package
under `<install>/node_modules/@tarfa/cli`, run as `node …/node_modules/@tarfa/cli/dist/cli.js`
(its `node_modules/.bin/tarfa` is a shell script, which node cannot run).

What a package install leaves on the machine:
- `~/.tarfa/agent.env`: the agent's settings (`tarfa setup` writes it; the annotated example is `deploy/agent.env.example`
  in the repository). Every command reads it, in one order: `TARFA_AGENT_ENV`, then `~/.tarfa/agent.env`,
  then a clone's `deploy/agent.env`.
- `~/.tarfa/bin/tarfa-agent`: the launcher the service runs. It sources `agent.env`, then runs the
  checkout named by `~/.tarfa/agent-source` when that file exists and still points at a checkout,
  else `tarfa serve` of the installed release through mise.
- `~/.local/bin/tarfa` (and `perch`, a link to it): a wrapper script, not a mise shim, which resolves
  the install and node from `$HOME` and never changes directory.
- The systemd user unit (linger) or launchd agent, running the launcher.

## Updating: `tarfa update` and `tarfa apply`
```sh
tarfa update              # the newest release; --version <v> pins one, --force re-applies the current
```
`tarfa update` asks the registry for the newest version, installs it with
`mise --cd $HOME use -g npm:@tarfa/cli@<v>`, then runs the **new** version's `tarfa apply` (found with
`mise where`, never the PATH, since `update` runs from project folders). `tarfa apply` rewrites the
launcher and unit when they differ, reinstalls the hooks, restarts the agent and checks the phone
port and the log's `phones on` line since the restart. Workspaces survive: the unit has
`KillMode=process`. `tarfa update` never touches Claude Code or Codex. From a clone it prints
`this is a source install; git pull` and exits 2.

## In one command: `tarfa setup`
Steps 1, 2 and 4 below, plus a Tailscale address for phones, are one non-interactive command
(`tarfa setup --help` lists every flag and the Tailscale primer):
```sh
tarfa setup --machine-id dev --project-roots ~/workspace --default-path ~/workspace \
  --tailscale funnel --slug me --pair            # add --dry-run first to see the plan
```
It writes `~/.tarfa/agent.env` (backed up first, `600`), creates the agent key, writes
`~/.tarfa/devices.json` before the service first starts (an agent from before token enrolment was
removed, if one is ever brought back, reads a missing roster as "the token enrols"), writes the launcher and the `~/.local/bin/tarfa` wrapper, installs the systemd user unit with linger or the launchd agent (running the launcher), runs `install-hooks`, adds one
`tailscale serve` (or `funnel`) handler for the phone port, restarts the agent only if anything
changed and checks the phone port answers. Rerun with the same flags, or with none, it changes
nothing: a flag not given takes the machine id, roots, phone port and default path from the `agent.env`
it finds, and a flag given still wins. How the port is published is not in `agent.env`, so `--tailscale`
defaults to `none`, which changes nothing, and the `TARFA_PHONE_ADDRESSES` already there are kept. It
never replaces an agent key, an installed unit that already runs the launcher (or a clone's
`deploy/run-agent.sh`) with `KillMode=process`, or a `tailscale serve` entry pointing elsewhere.
An existing `TARFA_PWA_ORIGIN` is kept unless `--pwa` names another (the default is
`https://tarfa.app`). Where Tailscale needs root, it prints `sudo tailscale set --operator=$USER`
and exits 1. The address it derives, `wss://<node>.<tailnet>.ts.net:<port>/<slug>`, goes first in
`TARFA_PHONE_ADDRESSES`, then any `--address`; `tarfa pair` then mints codes with all of them, in
order.

### A machine running from a clone: `tarfa setup --adopt`
A machine whose service runs a clone's `deploy/run-agent.sh` moves to the package without pairing
any phone again. Install the package, then plan before applying:
```sh
mise use -g node@24 npm:@tarfa/cli@<version>
tarfa setup --adopt --dry-run     # the plan, nothing changed
tarfa setup --adopt
```
It refuses from a clone and when no service is installed. In order, it: moves `~/.perch` to
`~/.tarfa` if that has not happened; copies the clone's `deploy/agent.env` to `~/.tarfa/agent.env`
(`600`, kept if already there, the original untouched); writes the launcher; removes the clone's
`deploy/agent-live` only when it is a symlink; rewrites the unit to run the launcher (the old text is
kept as `<unit>.bak-<time>`); restarts the agent; and writes the `tarfa` wrapper over a link into the
clone. Every flag you do not give (machine id, roots, phone port, default path) is read from the
copied env. On macOS, launchd lets go of a label a moment after `bootout`, so setup waits for it and
retries a refused `bootstrap` for a few seconds; if it still fails, it says no agent is loaded and
prints the `launchctl bootstrap` line that loads the new plist. The agent key, roster and parked and live state are never touched. A package-run
`tarfa setup` that finds such a unit adopts it the same way. Afterwards, `command -v tarfa` inside a
workspace pane must print `~/.local/bin/tarfa` (the wrapper); another path means something else comes
first on PATH: a project's `tarfa`, a mise shim, or another install directory (setup and `tarfa apply`
warn about it).

**Before adopting a Mac**, check that node-pty's prebuild loads and its helper is executable. This
asks node where node-pty resolves from the package, so it works in either layout:
```sh
pty="$("$(mise where node)/bin/node" -p "const p = require('path'); const i = '$(mise where npm:@tarfa/cli)'; const c = ['lib/node_modules/@tarfa/cli', 'node_modules/@tarfa/cli'].map((d) => p.join(i, d)).find((d) => require('fs').existsSync(d)); p.dirname(require.resolve('node-pty/package.json', { paths: [require('fs').realpathSync(c)] }))")"
"$(mise where node)/bin/node" -e "require('$pty')"
ls -l "$pty/prebuilds/darwin-arm64/spawn-helper"
```
**Rolling back an adoption.** The original `deploy/agent.env` was kept, so the clone runs as before.
Linux: copy the unit's `~/.config/systemd/user/tarfa-agent.service.bak-<time>` back over it, then
`systemctl --user daemon-reload` and `systemctl --user restart tarfa-agent`. macOS: copy
`~/Library/LaunchAgents/app.tarfa.agent.plist.bak-<time>` back, then
`launchctl bootout gui/$UID/app.tarfa.agent`, wait until `launchctl print gui/$UID/app.tarfa.agent`
fails (a bootstrap before then fails with `5: Input/output error`), and
`launchctl bootstrap gui/$UID ~/Library/LaunchAgents/app.tarfa.agent.plist`.

### A machine set up as Perch
Install the package (above) and run `tarfa setup --adopt`, or, from a clone (`git pull`,
`pnpm install --frozen-lockfile`, `deploy/install-cli.sh`), run `tarfa setup` with the machine's usual flags. It stops `perch-agent` (launchd:
`com.perch.agent`; tmux and every workspace keep running), moves `~/.perch` to `~/.tarfa` (keeping
`~/.perch` as a link to it, and the agent key as `agent-key.json`), renames `deploy/agent.env`'s
`PERCH_*` lines to `TARFA_*`, installs and starts `tarfa-agent`
(`app.tarfa.agent`, with the old unit's drop-ins copied over), reinstalls the hooks as `tarfa-hook.sh`/`tarfa-guard.sh`, and removes the old
unit last. A Codex user then trusts the new hooks in Codex's `/hooks`. An agent merely restarted
under its old unit moves `~/.perch` and re-tags the workspaces' tmux options itself, so the
workspaces, their status, parents and Codex threads, and every paired phone carry over either way.
On macOS, check that `launchctl bootout` of the old label leaves the tmux server running before
relying on it. Setup refuses, before it stops anything, when `~/.perch` and `~/.tarfa` both hold state.
Going back to an agent from before the rename after `tarfa setup` also takes the `agent.env`
backup setup reported, since that agent reads only `PERCH_*`; one merely restarted needs nothing.

Several agents on one node share a Tailscale port under their own `--slug`, each with its own
`--phone-port` (`setup` refuses a phone port another process holds). The node has one Tailscale
operator, so a second Linux user runs
`tarfa setup … --phone-port 8798 --tailscale none --slug <name> --address wss://<node>.<tailnet>.ts.net/<name>`,
which prints the `tailscale serve --bg --https=443 --set-path=/<name> http://127.0.0.1:8798`
line for the operator. The line's port is `--tailscale-port`, else the port of the first
`--address` under `/<name>`, else 443; it reads `tailscale funnel` instead when the serve config
shows that port already on Funnel, since `tailscale serve` there would take the port off Funnel
for every agent on it; for the same reason `--tailscale serve` on a port already on Funnel adds
its handler with `tailscale funnel`. Run through `sudo -u <user>`, setup needs `XDG_RUNTIME_DIR=/run/user/<uid>`
to reach that user's systemd manager, and stops without it rather than reinstall a working unit.
`tailscale serve` replaces whatever `x-forwarded-for` a client sends with
the tailnet peer's address, so the per-address caps see the real client.

## 1. Configure each agent
`tarfa setup` writes `~/.tarfa/agent.env` for you; by hand (a source install uses `deploy/agent.env`
from the clone):
```sh
install -m 600 deploy/agent.env.example ~/.tarfa/agent.env   # the example is in the repository
# edit it: set TARFA_MACHINE_ID (unique: "mac"/"mini"), TARFA_PROJECT_ROOTS (e.g. ~/workspace),
# keep TARFA_PORT=8787
```
> Phones join only with a one-time `tarfa pair` code; a paired phone's enrolled device key is its
> credential. The local hooks use their own secret, which the agent writes to `~/.tarfa/token` at
> each start. An agent.env from before still holding `TARFA_TOKEN` starts; the agent ignores the
> line with one warning, so delete it.
>
> `agent.env` must be readable by you alone: the agent refuses to start while another user
> can read or change it (the launcher sources it, so whoever can write it runs code as you), and says so naming the fix,
> `chmod 600 ~/.tarfa/agent.env`. A plain `cp` keeps the source's mode, which on
> most systems is readable by everyone; `install -m 600` does not.
>
> Several agents can share one machine, one per Linux user, each with its own `TARFA_PORT` and
> `TARFA_MACHINE_ID`: `docs/SETUP-MACHINE.md`, step 13.

## 2. Run the agent as a service
`tarfa setup` installs the service (the unit's `ExecStart` is the launcher `~/.tarfa/bin/tarfa-agent`;
the templates carry an `AGENT_COMMAND` placeholder that setup fills), and `tarfa apply` keeps it
current. Do not copy a template by hand. Run `mise trust` first on a source install: `run-agent.sh`
calls `mise exec`, and a service context cannot ask for trust, so an untrusted config makes the unit
crash-loop.

Logs: `journalctl --user -u tarfa-agent -f` (Linux), `tail -f ~/.tarfa/agent.err.log` (macOS).
On Linux, keep the user running without a login: `loginctl enable-linger "$USER"`.

**The agent's PATH is the one every workspace starts with.** A workspace command runs through a
non-interactive shell, which reads no profile, so `claude` must be on the PATH systemd gives user
services. Claude Code's installer puts it in `~/.local/bin`, which that PATH lacks on a stock
Ubuntu with bash: the pane exits with status 127 at once and the phone reports "No session". (A
zsh login sets PATH in `~/.zshenv`, which every zsh reads, so it never shows there.) Give user
services the tools in a file that sorts after `/usr/lib/environment.d/99-environment.conf`, which
sets PATH from `/etc/environment` and would override an earlier one:
```sh
mkdir -p ~/.config/environment.d
echo 'PATH=$HOME/.local/bin:$HOME/.local/share/mise/shims:${PATH}' > ~/.config/environment.d/999-user-path.conf
systemctl --user daemon-reload && systemctl --user show-environment | grep ^PATH=
systemctl --user restart tarfa-agent
```

Confirm: `curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8787/hooks` prints `401` (server up, auth enforced). A plain `GET /hooks` returns `404` — only `POST /hooks` reaches the auth check, so the liveness probe must use `-X POST`.

## 3. Publish the phone port and pair a phone
`tarfa setup --tailscale serve|funnel` does this; by hand, publish the phone port and tell the
agent where phones reach it:
```sh
tailscale serve --bg --https=10000 --set-path=/me http://127.0.0.1:8797   # or `tailscale funnel`
# ~/.tarfa/agent.env: TARFA_PHONE_ADDRESSES=wss://<node>.<tailnet>.ts.net:10000/me
tarfa pair [--pwa https://<where phones open the app>] [--ttl <minutes>] [--link]
```
`tarfa pair` prints a one-time pairing code and its QR code (one phone, for 20 minutes, or `--ttl`
1–20) with every address in `TARFA_PHONE_ADDRESSES`. The code (`TARFA…`, letters and
digits only) is pasted or scanned inside the installed app, on any device: Settings → Add machine.
It is not a link, so nothing opens it outside the app, where it would pair nothing. The phone asks
before pairing, naming every host and the machine key `tarfa pair` printed beside the code. When a
phone enrols, every other phone connected to that machine shows "New device paired", and the agent
logs `device enrolled: <id> "<name>"`. The instructions name the origin phones install the app
from, `TARFA_PWA_ORIGIN` (default `https://tarfa.app`). `--link` prints a pairing link on that
origin instead, for an app from before pairing codes (an older self-hosted copy, or a device that
cannot fetch the origin and still runs a cached build); a current app takes both. Set
`TARFA_DEFAULT_PATH` (an absolute path) and the code hands it to the phone as the new entry's
default path; a re-scan fills it only on an entry that has none. `TARFA_RELAY_URLS` from an older setup is ignored with a warning at
startup; remove it.

**Moving a machine off relays.** An agent updated past the relays' removal no longer dials
them, so a machine phones reached only through a relay is cut off until it is moved: run
`tarfa setup` with `--tailscale serve|funnel` (or `--address` for a proxy), remove
`TARFA_RELAY_URLS` from `agent.env`, then send each phone a fresh `tarfa pair` code. The
entry, known by its agent key, takes the new addresses; its device key stays enrolled. Update the
agent before phones use a current app: an older agent refuses a new phone's hello ("too old to
pair"). A self-hosted app built before the change must be redeployed too, and the old relay
services stopped by hand (their scripts are gone).

The hooks port is never exposed with `tailscale serve`. A machine set up long ago may
still publish its agent (`tailscale serve status` shows `:8442 -> 127.0.0.1:8787`): remove it
with `tailscale serve --https=8442 off` (`sudo` on Linux).

### The phone port
The agent logs `tarfa agent: phones on 127.0.0.1:<port>` at startup. The port takes a WebSocket
upgrade on any path (`tailscale serve --set-path` strips its prefix) and answers anything else
404, so `/hooks`, `/unpark`, `/close` and `/message` are never one proxy away from the network. It is meant to sit behind
`tailscale serve` or Funnel; the only port to publish is `TARFA_PHONE_PORT`, never `TARFA_PORT`.
A phone there goes through the agent's device roster, revocation and pairing codes. Its bounds:
8 unauthenticated sockets per client
address and 32 in all (the oldest is closed when full), 20 new sockets a minute per address, a
ping every 30 s, 64 KiB frames, and at most 4 roster or pairing-file reads at once and 10 a minute
for keys that are not enrolled. The client address is the last hop of `x-forwarded-for` from the
local proxy. Refusals arrive in band (`4429`). Several agents on one machine need distinct
phone ports; if the port is taken, the agent logs `no phone port` and keeps serving its hooks.
Check it with an upgrade (`101`) and a plain request (`404`):
```sh
curl -si --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" http://127.0.0.1:8797/x | head -1
curl -si http://127.0.0.1:8797/hooks | head -1
```
To reach the phone port over the local network without Tailscale (a proxy with a real certificate),
see `docs/LAN.md`.

### Dictation keys for every paired phone
Instead of typing an ElevenLabs or OpenRouter key into each phone's Settings, store it once on
the machine. Every phone paired with that machine then dictates into that machine's workspaces
with it:
```sh
tarfa dictation-key set elevenlabs          # asks for the key with echo off
bw get password "<item>" | tarfa dictation-key set openrouter   # or pipe it in
tarfa dictation-key                          # which providers hold a key (never the key itself)
tarfa dictation-key remove elevenlabs
```
The key never goes on the command line (any local user can read a process's arguments). It is
kept in `~/.tarfa/dictation-keys.json` (0600; the agent refuses to start while another user can
read it, and sends no key from it after that). The agent reads the file on each request, so a
change reaches a phone at its next connect, with no restart. Rules the phone follows:
- **A key typed in the phone's Settings wins everywhere.** Leave the field empty to use the machine's key.
- **Only the attached workspace's machine's key is used**, never another machine's: one phone
  may reach machines with different operators, and each pays for dictation into its own.
- The phone keeps the key in memory for the session and never writes it to storage. A phone
  that is lost or revoked may still hold a key it already fetched, and anything served from the
  PWA's origin can read it (see `CLAUDE.md`, "the PWA's origin"). The remedy is to rotate the key
  at the provider, then `tarfa dictation-key set` the new one.
- An agent older than this feature sends nothing. The phone then uses only its typed keys.

## 4. Wire Claude Code hooks (each machine)
The agent writes a hooks-only secret to `~/.tarfa/token` at each start (mode 600); the hook reads it.
```sh
tarfa install-hooks     # reads the machine id and hooks port from agent.env; `tarfa apply` reruns it
# merges Stop/StopFailure/Notification/UserPromptSubmit/PreToolUse/PostToolUse/SessionStart hooks into ~/.claude/settings.json
```

It also registers a second `PreToolUse` hook on `Bash`, `~/.tarfa/tarfa-guard.sh`, which refuses
`pkill`, `killall`, `kill -1`, `xargs kill`, `kill $(pgrep …)` and an unscoped
`tmux kill-server`/`kill-session -a` run from inside a workspace. The tmux server, the agent and
every session run as one user, so one pattern kill ends them all. It also refuses a raw socket client
(`nc -U`, `socat`, `curl --unix-socket`) aimed at another session's message socket, and setting
`@tarfa_parent` or `@tarfa_codex_thread` by hand (docs/MESSAGING.md).

Where Codex is installed (its home exists: `$CODEX_HOME`, else `~/.codex`), the same command also
merges UserPromptSubmit/PreToolUse/PostToolUse/PermissionRequest/Stop hooks into its `hooks.json`.
The agent and the CLI find that home the way Codex does: `CODEX_HOME` from agent.env or the
environment, else the one the login shell sets (`$SHELL -lc`, as the panes' `codex` sees it), else
`~/.codex`. Export it in `.zshenv`/`.profile`, where a login shell, the tmux server and so every
pane see it; one exported only in `.zshrc` is invisible to a login shell. A value in agent.env alone
reaches the agent, `tarfa send` and a `tarfa spawn --cli codex` pane (spawn sets it on the session),
but not a Codex opened from the app's form, whose pane has the tmux server's environment. The agent reads it once at startup (its log says
`Codex home …`), so a change needs a restart.
Codex runs none of them until they are trusted: open Codex, run `/hooks` and trust them. Trust
is keyed on a hash of each hook, so re-trust after re-running `install-hooks` changes them.

Codex statuses only work for a Codex started with `--no-daemon`, which the create form adds. By
default Codex runs its hooks in a shared background daemon, outside the workspace's pane, and
the hook cannot tell which workspace they belong to, so it reports nothing for them.

Same idea, same per-machine cadence: link the `tarfa-spawn` and `tarfa-orchestrate` skills
into the global skills directory so a workspace on any project can launch and follow further
workspaces. They live in the repo, not in the package: link them from a clone, so `git pull`
updates them. Both use the `tarfa` CLI (next section).
```sh
ln -sfn "$(pwd)/.claude/skills/tarfa-spawn" ~/.claude/skills/tarfa-spawn
ln -sfn "$(pwd)/.claude/skills/tarfa-orchestrate" ~/.claude/skills/tarfa-orchestrate
```

### Tarfa CLI (each machine)
A package install already has `tarfa` on PATH (the wrapper `~/.local/bin/tarfa`, written by `tarfa
setup`, adoption and `tarfa apply`; it replaces only nothing, a link into a clone or an earlier copy
of itself, and leaves anything else with one warning). From a clone, for development:
```sh
deploy/install-cli.sh   # links ~/.local/bin/tarfa to deploy/tarfa-cli.sh (and perch to tarfa); safe to re-run
```
The link follows the checkout, so a `git pull` updates the CLI. The shim finds the checkout's
node through mise and runs `packages/agent/src/cli.ts` from the caller's directory. It refuses
to replace a `~/.local/bin/tarfa` or `~/.local/bin/perch` that is not a symlink. Every subcommand works through it (`tarfa
pair`, `tarfa devices`, …). These three need no `agent.env`, so a session in any repo can
use them:
- `tarfa spawn [--title <title>] [--child] [--model <model>] <projectPath>`, with the brief on stdin:
  starts a workspace running Claude Code on the brief and prints its id (also its Claude session
  name). `--child` makes the caller's own workspace its orchestrator. The child records the
  parent's workspace id, cannot ask the user or enter plan mode, and reports back with `tarfa send`.
- `tarfa ls [--json] [--mine] [--parent <workspace id>] [--role orchestrator|child|normal] [--path <dir>]`:
  every workspace, parked ones included, with its messaging name, stored status, time in that
  status, role, parent, title and folder. The role comes from the `--child` links: a workspace with
  a listed child is an orchestrator (even if it is a child too), one with a parent is a child, the
  rest are normal. `--mine` lists the caller's children, `--role` one role, and `--path` the
  workspaces whose folder is that directory or under it (relative to the caller, so `--path .`
  means "this project", worktrees included). Filters combine.
- `tarfa peek <workspace id> [-n <lines>]`: its status line and the last 40 (or N) non-blank lines
  of its pane.
- `tarfa wait <workspace id>... [--timeout <seconds, at least 10>]`: blocks until a named child stops working
  and prints `<id> <state>` for each one stopped (`needs-orchestrator`, `needs-feedback`, `idle`,
  `finished`, `parked`, `gone`). Exit 0 for a stop, 124 for the timeout, 2 for bad arguments, 1 for
  anything else. It gives a state left over from before a `tarfa send` or `tarfa spawn` time to
  change, so a stop it finds already there takes about 10 s to report. It reads the reported status:
  a Codex child whose hooks are untrusted on a stock tmux, or a Pi child without the Tarfa extension,
  reads `idle` while it works. A workspace that is not a child and ended its turn on `tarfa send`
  stays `working`, so name a `--timeout` for those.

`tarfa unpark <workspace id>...` reopens parked workspaces and `tarfa close <workspace id>...`
closes workspaces, parked ones included, one line per id, exactly as doing it on the phone does.
A close also stops the pane's systemd scope and logs `closed-by-user`, which a raw
`tmux kill-session` does not. Both ask the running agent over its loopback listener (`TARFA_PORT`
from `agent.env`, the hooks secret in `~/.tarfa/token`), so they need the agent running.

## 5. The PWA: tarfa.app, and the tailnet staging copy
Tarfa is a static-assets Worker (`packages/pwa/wrangler.jsonc`) in the maintainer's Cloudflare
account, on the `tarfa.app` custom domain. Deploy it only with the script, from a clean main that
matches origin:
```sh
cp deploy/pwa-deploy.env.example deploy/pwa-deploy.env   # once, in the main checkout: CLOUDFLARE_ACCOUNT_ID, PWA_DEPLOY_TOKEN_CMD
deploy/pwa-deploy.sh             # frozen install, build, deploy, then waits until tarfa.app serves this build
deploy/pwa-deploy.sh --dry-run   # build and check only, from any checkout
```
To test a worktree's PWA on a phone from a public origin, `deploy/pwa-deploy.sh --dev` deploys it
to a throwaway `tarfa-dev` Worker on workers.dev and prints its URL (its header shows a
`tarfa-dev` badge); pair a phone with it from `tarfa pair` (`--pwa <that URL>` names it in the instructions; `--link` for a link to it), and remove it with
`deploy/pwa-deploy.sh --dev --delete` when done. Another Cloudflare account serves its own copy with
`--env-file <its file>` from a fork whose `packages/pwa/wrangler.jsonc` names its own domain in `env.production`'s route
and whose `deploy/pwa-deploy.sh` checks that domain's `version.json` (both name tarfa.app).

The script never uses a wrangler login: `PWA_DEPLOY_TOKEN_CMD` prints an API token scoped to
Workers Scripts:Edit (kept in a password manager, e.g. `bw get password <item>`), which goes only
into each wrangler call's environment; without it the script deploys nothing (a `--dry-run` needs
none). The build writes `dist/_headers` from `src/core/security-headers.ts` (the meta CSP plus
`frame-ancestors`, nosniff, no-referrer, COOP, HSTS and a Permissions-Policy), which the Worker
applies to every response. Redirecting `http://` to `https://` is the zone's "Always Use HTTPS"
setting: static assets cannot match on the scheme.

The tailnet copy below is the **staging PWA**, which `pnpm serve:build` points at a worktree
(the always-on Linux machine only). It is a separate origin, so phones install and pair it
separately; it installs as "Tarfa Dev" with its own icon (`TARFA_APP_FLAVOR=dev`, which
`run-pwa.sh` and the build hooks set):
```sh
sed "s#REPO_PATH#$(pwd)#g" deploy/tarfa-pwa.service > ~/.config/systemd/user/tarfa-pwa.service
systemctl --user daemon-reload
systemctl --user enable --now tarfa-pwa     # builds dist/ then serves on 127.0.0.1:4173
sudo tailscale serve --bg --https=8443 4173  # Linux: sudo; ≥1.64 syntax
tailscale serve status   # shows https://mini.<tailnet>.ts.net:8443/ -> 127.0.0.1:4173
```
Staging PWA URL: `https://mini.<tailnet>.ts.net:8443/`.

## 6. Install on the phone
1. Open `https://tarfa.app/` in Safari on an iPhone (or Chrome on Android). Tailscale on the phone
   is needed only for machines published with `tailscale serve` alone; a Funneled machine is
   reached without it.
2. Share → **Add to Home Screen**. Launch Tarfa from the home screen (standalone).
3. Pair each machine: on the machine, `tarfa pair` prints a pairing code and its QR code; in Tarfa,
   **Settings → Add machine → Scan QR code** (or copy the code and **Paste pairing code**), then
   confirm the machine key matches. Nothing is typed on the phone. On Android, Chrome asks once to find devices on the local
   network the first time it opens a tailnet address: allow it.

## 7. On-device smoke test
1. On a machine: `tarfa create ~/workspace/SOME_PROJECT bash` (or create from the phone).
2. Phone list shows the workspace under the right machine with a green status dot.
3. Tap it → the terminal streams; type `echo hi` → see `hi`.
4. In a workspace run `claude`; when it finishes a turn or asks for input, the row bubbles up with "Needs you". ("Finished" is a manual status you set from the status picker — no hook sets it.)
5. Open the same workspace on a second device → the first shows "Opened on another device".
6. Close from the phone → the workspace disappears from the list.

## Releasing
`@tarfa/cli` reaches machines as an npm package. A release publishes the package only: it never
deploys tarfa.app, and `tarfa update` never touches Claude Code or Codex.
1. Bump `version` in `packages/agent/package.json` on a branch in its own worktree, like any
   change, and land it: `pnpm land <branch>` (never a commit in the main checkout).
2. Tag the landed commit `v<version>` and push the tag (the pre-push gate runs the suite):
   `git tag v<version> <branch> && git push origin v<version>`. The pre-push hook refuses a `v*`
   tag whose commit is not on `origin/main` yet, which `release.yml` would refuse too.
3. `.github/workflows/release.yml` checks that the tag equals the package version and that the
   tagged commit is on `origin/main`, runs the frozen install, typecheck and unit tests, packs the
   tarball, runs the packaging test (`TARFA_PACK_TEST=1`) and **stages** it with
   `npm stage publish --provenance` over OIDC (trusted publishing; the workflow holds no npm token and
   its `npm stage` right does not extend to `npm publish`). It does not run `pnpm test:scripts`:
   those scripts exercise this repository's local deploy tooling (worktrees, `pwa-deploy.sh`, the
   leak-word list) and the pre-push gate has already run them.
   The on-main check is a guard against mistakes, not a security boundary (anyone able to push a tag
   can edit the workflow); the 2FA approval in the next step is the real gate.
4. **The maintainer approves with 2FA; nothing is live before that.** `npm stage list @tarfa/cli`,
   then `npm stage approve <stage-id>` (or the Staged Packages tab on npmjs.com).
5. `tarfa update` on each machine.
6. `deploy/pwa-deploy.sh` only after **every agent a phone pairs with** runs a release at least as
   new as the app expects (`MIN_AGENT_VERSION` in `packages/pwa/src/core/agent-skew.ts`; an app
   deploy never runs ahead of the oldest agent). An agent reports its version in `authResult`; the app
   shows "This machine's agent is too old for this app. Update it: tarfa update" for one below the
   minimum, and keeps the connection open. Raise the constant in the release that first breaks an older agent.

`node-pty` is pinned exactly to a prerelease because it is the first upstream line with Linux
prebuilds; move it to the stable release once one ships.

## 8. Troubleshooting
- **`/hooks` 401 from the local hook:** the agent hasn't written `~/.tarfa/token` yet (start the agent first) or the hook ran before startup. The file holds a hooks-only secret the agent replaces at each start, not `TARFA_TOKEN`.
- **node-pty `posix_spawnp failed` on Ubuntu:** in a package install, an installer stripped the prebuild's execute bit: reinstall with `mise install --force npm:@tarfa/cli@<version>` then `tarfa apply` (`tarfa update --force` only re-selects an installed version and reinstalls nothing), and check `spawn-helper` under the install's `node_modules/node-pty/prebuilds/linux-*/` is `+x`. In a source install, re-run `pnpm install` (the root postinstall chmods it).
- **The phone does not connect:** the entry's message in Settings names the refusal (an agent refusal: revoked, not enrolled, a spent or expired pairing code, the wrong agent key). Check the agent logs `phones on 127.0.0.1:<port>`, that the publishing entry points at that port (`tailscale serve status`), and that the phone reaches the address (a tailnet address needs the phone's Tailscale connected; a Funnel one does not).
- **An old entry with no agent key** (made by hand before pairing links): it never connects; delete it in Settings and pair the machine again.
- **PWA loads but no workspaces:** watch the agent log (`journalctl --user -u tarfa-agent -f` on Linux, `tail -f ~/.tarfa/agent.log` on macOS where the plist writes it; a source install: `tail -f deploy/agent.log`) for `phone:` lines.
- **Port already in use:** change `TARFA_PORT` in `agent.env`, then re-run `install-hooks` (step 4), which bakes the port into the hook command.
- **`mise` or `node` not found from the service:** the launcher resolves both from `$HOME` (the global node 24 of `mise use -g`), so check `mise which node` as the service's user, and that `~/.local/bin/mise` (or the mise on the unit's PATH) exists.
