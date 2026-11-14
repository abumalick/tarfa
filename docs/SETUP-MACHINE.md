# Set up your own Tarfa machine

This walks through one Ubuntu machine (a home server, a VPS, a spare PC) where Claude Code and
Codex run in tmux workspaces that you drive from your phone. Your phone loads the app (Tarfa,
from tarfa.app or your own copy) and connects to the machine directly, end to end encrypted. You
need:

- an Ubuntu machine you have sudo on (the steps were written on Ubuntu 26.04);
- [Tailscale](https://tailscale.com) on the machine and the phone (or a reverse proxy of your own
  in front of the agent's phone port);
- a phone.

A fork of this repository is needed only to serve your own copy of the app (step 7).

```
phone (the app, https://tarfa.app or your own origin)
   │  wss, Noise-encrypted end to end
   ▼
tailscale serve / funnel (https://<machine>.<tailnet>.ts.net:<port>/<slug>)
   │  proxies to the loopback phone port
   ▼
Ubuntu machine: tarfa-agent (systemd user unit) ── tmux server ── claude / codex workspaces
```

This guide gives the commands in order; `docs/DEPLOY.md` explains them in depth and wins wherever
it disagrees with this page. Placeholders: `<user>`, `<uid>`, `<machine>`, `<tailnet>`,
`<account-id>`, `<Area/City>`.

## 1. Prepare the machine (sudo, once)

```bash
sudo apt update
sudo apt install -y tmux git curl ripgrep fd-find unzip htop unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # security updates install themselves

sudo locale-gen en_US.UTF-8
sudo update-locale LANG=en_US.UTF-8
sudo timedatectl set-timezone <Area/City>

sudo loginctl enable-linger <user>
```

- **A UTF-8 locale** keeps tmux from replacing accents, Arabic or box drawing with `_` in what
  your phone shows.
- **Linger** keeps your user services (the agent, the tmux server) running when nobody is logged
  in, and starts them at boot.
- `node-pty` ships prebuilt binaries, so build tools are not required (`docs/DEPLOY.md`, step 0).

Check: `locale` (after a new login), `timedatectl`, `loginctl show-user <user> -p Linger`.

## 2. Keep one runaway job from freezing the machine

Several agents share one machine. A job that eats all the memory is not killed quickly: the
machine thrashes and stops answering, phone included. Cap your user's whole slice, and give big
jobs a smaller cap of their own.

```bash
sudo mkdir -p /etc/systemd/system/user@<uid>.service.d
sudo tee /etc/systemd/system/user@<uid>.service.d/50-memory.conf >/dev/null <<'EOF'
[Service]
# roughly 80% and 90% of physical memory
MemoryHigh=<e.g. 12G>
MemoryMax=<e.g. 14G>
EOF
sudo systemctl daemon-reload
```

`daemon-reload` applies the limits to the running unit. **Do not restart `user@<uid>.service`**:
that stops every user service and every workspace.

A `heavy` wrapper for builds and test suites, saved as `~/.local/bin/heavy` and made executable:

```bash
#!/usr/bin/env bash
exec systemd-run --user --scope -q -p MemoryMax="${HEAVY_MEM:-8G}" -p MemorySwapMax=2G "$@"
```

`heavy pnpm test`, `HEAVY_MEM=12G heavy uv run train.py`: a job past its cap is killed alone, in
under a second. Tarfa's home screen shows how much memory is left before the slowdown and before
the kill (`docs/MACHINE-LOAD.md`).

## 3. Toolchain

As your user:

```bash
curl https://mise.run | sh                       # mise: runtimes and CLIs, in ~/.local/bin
echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
exec bash
mise use -g node@24 gh npm:@openai/codex

curl -LsSf https://astral.sh/uv/install.sh | sh  # uv, if you work in Python
curl -fsSL https://claude.ai/install.sh | bash   # Claude Code, in ~/.local/bin/claude
```

Log in to Claude Code (`claude`) and Codex (`codex`) once, from a terminal on the machine.

Docs: [mise](https://mise.jdx.dev/getting-started.html),
[uv](https://docs.astral.sh/uv/getting-started/installation/),
[Claude Code setup](https://code.claude.com/docs/en/setup),
[Codex CLI](https://developers.openai.com/codex/cli).

## 4. Give user services your PATH (do not skip)

Each workspace command runs through a non-interactive shell that reads no profile, so it starts
with the PATH systemd gives user services. On stock Ubuntu that PATH lacks `~/.local/bin`, where
Claude Code lives: the workspace exits at once with status 127 and the phone shows **"No
session"**. `docs/DEPLOY.md` (step 2) has the fix:

```bash
mkdir -p ~/.config/environment.d
echo 'PATH=$HOME/.local/bin:$HOME/.local/share/mise/shims:${PATH}' > ~/.config/environment.d/999-user-path.conf
systemctl --user daemon-reload && systemctl --user show-environment | grep ^PATH=
```

The name must sort after `/usr/lib/environment.d/99-environment.conf`, which sets PATH from
`/etc/environment` and would override an earlier file.

## 5. Run tmux as its own service (recommended)

The agent unit already uses `KillMode=process`, so restarting the agent leaves tmux alone. A
tmux server of its own also keeps your workspaces independent of the agent entirely.

`~/.config/systemd/user/tmux-server.service`:

```ini
[Unit]
Description=tmux server

[Service]
ExecStart=/usr/bin/bash -lc 'exec /usr/bin/tmux -D'
Restart=always
RefuseManualStop=yes

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload && systemctl --user enable --now tmux-server
```

Never run `tmux kill-server` on this machine: every workspace lives on that one server.
Workspaces do not keep running through a reboot: each Claude workspace whose conversation the
agent knew comes back **parked**, and opening it on the phone resumes the conversation. Close
the others.

## 6. Install the agent

Details: `docs/DEPLOY.md`, "Install the package" and "In one command".

```bash
mise use -g node@24 npm:@tarfa/cli@<version>          # a release: see docs/DEPLOY.md, "Releasing"
tarfa setup --machine-id <name> --project-roots /home/<user>/workspace \
  --default-path /home/<user>/workspace --tailscale none --dry-run   # publish in step 8
```

There is no repository, no pnpm and no compiler: `node-pty` ships prebuilds and the install runs
no lifecycle scripts. A global node 24 is required, because the `tarfa` wrapper and the service's
launcher find node from `$HOME`, never from the folder they run in.

`tarfa setup` writes `~/.tarfa/agent.env` (`600`), the launcher
`~/.tarfa/bin/tarfa-agent` and the `~/.local/bin/tarfa` wrapper, installs and starts the user unit with
linger, and installs the status hooks, without prompting; it is safe to rerun and changes only what
differs. If you run tmux as its own service (step 5), add its drop-in first:

```bash
mkdir -p ~/.config/systemd/user/tarfa-agent.service.d
printf '[Unit]\nAfter=tmux-server.service\nWants=tmux-server.service\n' \
  > ~/.config/systemd/user/tarfa-agent.service.d/10-tmux.conf
systemctl --user daemon-reload
```

It also writes `~/.tarfa/devices.json`, the roster of phones; only a `tarfa pair` code adds one.
`--tailscale none` publishes nothing yet: step 8 asks how phones reach the machine and publishes the
phone port (setup refuses to guess without one of `--tailscale funnel|serve|none` or an address). `tarfa setup --help` explains the flags and the Tailscale admin settings.
The `tarfa-spawn` and `tarfa-orchestrate` skills live in the repository, not the package: link them
from a clone (`ln -sfn <clone>/.claude/skills/tarfa-spawn ~/.claude/skills/tarfa-spawn`, same for
`tarfa-orchestrate`) if you want sessions to launch further workspaces.

Check: `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8787/hooks` prints
`401` (running, and refusing an unauthenticated hook).

**From a clone, for development.** A source install runs the agent from a checkout:
`git clone <your fork> tarfa && cd tarfa && mise trust && mise install && mise exec -- pnpm install`,
then `pnpm tarfa setup …` with the same flags (it keeps `deploy/agent.env` and runs
`deploy/run-agent.sh`), and `deploy/install-cli.sh` for `tarfa` on PATH. A machine already running
from a clone moves to the package with `tarfa setup --adopt` (`docs/DEPLOY.md`).

**Status hooks** tell your phone whether a session is working or waiting for you. They go into
`~/.claude/settings.json`, and into Codex's `hooks.json` when its home exists (`$CODEX_HOME`, else
`~/.codex`, which Codex creates on its first run; see `docs/DEPLOY.md`, step 4, for where Tarfa reads
`CODEX_HOME`): run `install-hooks` again after you first start Codex, then open Codex,
run `/hooks` and trust them (again after any change). See `docs/DEPLOY.md`, step 4.

## 7. The app

Phones load the app from `https://tarfa.app`, the maintainer's copy, which `tarfa pair` tells phones to
install unless `TARFA_PWA_ORIGIN` says otherwise. The origin holds every phone's device key, and
whoever serves it can read what it shows, so if you would rather trust yourself, serve your own
copy. Any static host serves `packages/pwa/dist` after `pnpm --filter @tarfa/pwa build`. On a free
Cloudflare account it is a static-assets Worker, deployed from a clean, pushed `main` of your
fork, once the fork names your own domain: the route in `env.production` of
`packages/pwa/wrangler.jsonc` and the `version.json` check in `deploy/pwa-deploy.sh` both say
tarfa.app. The deploy never uses a wrangler login: it takes a Cloudflare API token on your
account (Workers Scripts:Edit, plus what a custom-domain route needs on your zone), kept in
your password manager and printed by the command `PWA_DEPLOY_TOKEN_CMD` names.

```bash
install -m 600 deploy/pwa-deploy.env.example ~/.tarfa/pwa-deploy.<name>.env   # CLOUDFLARE_ACCOUNT_ID, PWA_DEPLOY_TOKEN_CMD
deploy/pwa-deploy.sh --env-file ~/.tarfa/pwa-deploy.<name>.env --dry-run       # builds, deploys nothing
deploy/pwa-deploy.sh --env-file ~/.tarfa/pwa-deploy.<name>.env
```

Several Cloudflare accounts take one env file each. Then set
`TARFA_PWA_ORIGIN` (or pass `--pwa` to `tarfa setup` / `tarfa pair`) to your origin. Moving to
another origin later means pairing every phone again: a new origin has empty storage.

Docs: [Workers static assets](https://developers.cloudflare.com/workers/static-assets/),
[API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).

## 8. Publish the machine and pair your phone

Install Tailscale on the machine and log in (`sudo tailscale up`), turn on MagicDNS and HTTPS
certificates in the admin console, and let your user run `tailscale serve` without sudo
(`sudo tailscale set --operator=$USER`).

First decide, or ask whoever the machine is for: **must phones reach it without Tailscale on?**
Setup does not guess. Yes:

```bash
tarfa setup --tailscale funnel --pair   # phones reach it with or without Tailscale
```

No:

```bash
tarfa setup --tailscale serve --pair    # phones reach it only with Tailscale on
```

(The machine id, roots and default path come from step 6's `agent.env`.) Setup ends its checks with a
`reachability:` line saying which it is; every later bare `tarfa setup` keeps the addresses and
repeats that line. `--tailscale serve` publishes the phone port on your tailnet only: the phone needs Tailscale
connected. `--tailscale funnel` publishes it on the internet too (the phone needs no VPN; the
policy file must give the node the `funnel` attribute), at about 0.2 MB/s, which is fine for
terminals and slow for large previews. `tarfa setup --help` has the details. `--pair` prints
a pairing code and its QR code; check the agent with `journalctl --user -u tarfa-agent | grep 'phones on'`.

On your phone, open the app's origin and install it (iPhone: Share → Add to Home Screen; Android:
install from the browser menu). Then pair:

- In the installed app, **Settings → Add machine**, then **Scan QR code**, or copy the code to the
  phone and tap **Paste pairing code**. The same on an iPhone, Android or a desktop browser. The
  code is not a link: scanning it with the Camera app or pasting it in a browser's address bar does
  nothing (on an iPhone, Safari's storage is not the installed app's anyway).
- The app asks before it pairs: check that the machine key it shows is the one `tarfa pair`
  printed.
- **Android:** Chrome asks once whether the app may reach your local network (a tailnet address):
  allow it.

A code works once, for 20 minutes (or `--ttl`); `tarfa pair` makes another. An app from
before pairing codes takes a link instead: `tarfa pair --link`. Only a `tarfa pair` code adds a
phone:

```bash
tarfa devices                 # your phones; revoke a lost one by id or key
```

Check: the machine shows on your phone, a new `bash` workspace opens, and `echo hi` answers.

## 9. Updating

```bash
tarfa update            # newest release; `--version <v>` pins one, `--force` re-applies the current
```

`tarfa update` installs the release with mise, then runs the new version's `tarfa apply`, which
refreshes the launcher and unit if they differ, reinstalls the hooks, restarts the agent and checks
the phone port. Workspaces survive the restart. It never updates Claude Code or Codex. If you serve
your own app, redeploy it from step 7 only after every agent your phones use runs a release at least
as new as the app expects, and trust the Codex hooks again when the hook script changes.

## 10. Optional: reaching the machine yourself

A workspace on your phone is already a shell on the machine. For SSH and for previewing web
servers, [Tailscale](https://tailscale.com/docs/install/linux), which step 8 set up, is the simple
path:

- **SSH with keys only.** Cloud-init's `/etc/ssh/sshd_config.d/50-cloud-init.conf` turns password
  login on, and sshd keeps the first value it reads, so put yours in a file that sorts earlier:
  ```bash
  sudo tee /etc/ssh/sshd_config.d/10-keys-only.conf >/dev/null <<'EOF'
  PasswordAuthentication no
  KbdInteractiveAuthentication no
  PermitRootLogin no
  EOF
  sudo sshd -t && sudo systemctl reload ssh
  ```
  Check with `sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin) '`, and open a new
  SSH session before you close the one you are in.
- **Never hand your phone a `localhost` link**: it opens on the phone. Publish a dev server on your
  tailnet instead, and open `https://<machine>.<tailnet>.ts.net:<port>`:
  ```bash
  sudo tailscale set --operator=$USER                 # once, so serve needs no sudo
  tailscale serve --bg --https=<port> http://127.0.0.1:<port>
  tailscale serve --https=<port> off                  # when done
  ```
  It needs MagicDNS and HTTPS certificates on in your tailnet, and your access policy must let
  your phone reach that port ([serve](https://tailscale.com/docs/features/tailscale-serve),
  [grants](https://tailscale.com/docs/features/access-control/grants)). Disable key expiry for
  the machine in the admin console, or it drops off the tailnet after a few months
  ([key expiry](https://tailscale.com/docs/features/access-control/key-expiry)).

## 11. Optional: dictate through Claude Code's own `/voice` (Linux)

The "Claude Code /voice" dictation preset streams what you say to the agent, which plays it into
a virtual microphone while holding space in the open workspace, so Claude Code transcribes it into
the prompt, unsent, for you to review. It needs no speech-to-text key, but each machine
must be set up once by hand:

```bash
sudo apt install -y alsa-utils
sudo usermod -aG audio <user>       # the agent's service has no seat, so it needs the group
echo snd-aloop | sudo tee /etc/modules-load.d/snd-aloop.conf   # load the loopback at boot
sudo modprobe snd-aloop                                         # and now

# Claude Code records from ALSA's default device: make that the loopback's capture side.
cat > ~/.asoundrc <<'EOF'
pcm.!default {
  type asym
  playback.pcm "plughw:Loopback,0"
  capture.pcm "plughw:Loopback,1"
}
EOF
```

Then run `/voice` once in any Claude workspace and keep **hold** mode, the default (or set
`"voice": {"enabled": true, "mode": "hold"}` in `~/.claude/settings.json`). The setting is per
user, shared by all of that user's workspaces, and the agent refuses a dictation while voice is off
or in tap mode (tap mode would submit the prompt). If you had to add the group, reboot: the user
services run under a user manager that keeps the groups it started with, and restarting that
manager would take every workspace of that user down with it. To use it before the next reboot,
grant the user the loopback devices directly instead, through udev (`sudo apt install -y acl`
for `setfacl`):

```bash
sudo tee /etc/udev/rules.d/99-tarfa-voice-loopback.rules >/dev/null <<'EOF'
SUBSYSTEM=="sound", ACTION!="remove", KERNEL=="controlC*|pcmC*", ATTRS{id}=="Loopback", RUN+="/usr/bin/setfacl -m u:<user>:rw $devnode"
EOF
sudo udevadm control --reload
card=$(awk '/\[Loopback/ {print $1}' /proc/asound/cards)
sudo udevadm trigger --action=change /sys/class/sound/controlC$card /sys/class/sound/pcmC${card}D*
```

A plain `setfacl` on the devices does not last: udev's `uaccess` step hands sound devices to the
active seat's session at every udev event for them, and on a headless server, which has no such
session, it flushes every per-user ACL. That happens a few seconds after a fresh `modprobe`, and
again whenever a package re-triggers udev, silently. The rule runs after that step, so the grant
comes back each time. With several users it names them all: `-m u:<user1>:rw,u:<user2>:rw`. It
is harmless to leave once a reboot has given the users the `audio` group.

On the phone: Settings →
Add preset → Provider "Claude Code /voice".

- **Check:** `aplay -l | grep Loopback` lists the card, `jq .voice ~/.claude/settings.json`
  says `"enabled": true, "mode": "hold"`, and the agent's own user manager can open the
  loopback (`id -nG` in a login shell is not enough: it shows a group the manager may not have):
  `systemd-run --user --quiet --wait --pipe aplay -q -D plughw:Loopback,0 -f S16_LE -r 16000 -c 1 -t raw -d 1 /dev/zero`
  exits without an error (with several users, use that user's `TARFA_VOICE_DEVICE` as the `-D`).
- **This is meant for a headless server.** `~/.asoundrc` replaces the default device for every
  ALSA program of that user, playback included, so on a desktop with PipeWire or PulseAudio it
  would take the real microphone and speakers away. That case is untested.
- One dictation at a time per agent. The text arrives about 1.5 s after you stop speaking.
- Each agent tells the phone whether Claude voice can work on its machine (the loopback card is
  loaded). Where it cannot (macOS, or no `snd-aloop`), the preset is greyed out "not on this
  machine" and the mic uses the preset's Fallback. After loading the module, reopen the app so
  the phone asks again.

**Several Linux users on one machine (see step 13).** They share the one loopback card, and ALSA
gives each `aplay` and each recorder the lowest free subdevice, pairing playback subdevice *n*
with capture subdevice *n*. Two users dictating at once then cross over whenever their programs
open in a different order, and one user's Claude hears the other's speech (measured with
`arecord`/`aplay`: a recorder heard the tone another player sent; pinned subdevices kept apart).
Give every user its own subdevice *n* (0, 1, 2…; the card has 8), **the first user included**,
since one user left on "lowest free" can still take another's. Each user also needs the rest of
this step for itself: the `audio` group (or the direct grant above) and `/voice` in hold mode.

```bash
# In that user's ~/.asoundrc, with its own <n> on both sides:
pcm.!default {
  type asym
  playback.pcm "plughw:Loopback,0,<n>"
  capture.pcm "plughw:Loopback,1,<n>"
}
# And in its ~/.tarfa/agent.env, the playback side of the same <n>, then restart its agent:
TARFA_VOICE_DEVICE=plughw:Loopback,0,<n>
```

The agent plays into `plughw:Loopback,0` when `TARFA_VOICE_DEVICE` is unset, which is right
only for a machine with one user.

## 12. Optional: a Claude Code setup that works well here

None of this is required by Tarfa.

- **Tell Claude where it is.** A few lines in `~/.claude/CLAUDE.md` go a long way: every session
  runs in a Tarfa workspace you read on a small screen; never kill tmux sessions it did not
  create; never give `localhost` links (step 10); Tarfa questions are answered from
  `~/workspace/tarfa` and its `docs/`; `heavy` for big jobs.
- **Library docs:** [Context7](https://github.com/upstash/context7) as an HTTP MCP server, which
  works without a key: `claude mcp add --transport http --scope user context7 https://mcp.context7.com/mcp`
  ([MCP in Claude Code](https://code.claude.com/docs/en/mcp)).
- **Plugins** from the official marketplace, installed with `/plugin`; language-server plugins
  need their servers installed (e.g. `mise use -g npm:typescript-language-server npm:typescript`,
  `uv tool install pyright`) ([plugins](https://code.claude.com/docs/en/discover-plugins)).
- **Browser automation** with [agent-browser](https://github.com/vercel-labs/agent-browser) on
  Ubuntu 23.10+: its Chrome needs the usual shared libraries, and AppArmor blocks the user
  namespaces Chrome's sandbox needs
  ([Ubuntu's change](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces)).
  Allow that one binary, in `/etc/apparmor.d/agent-browser-chrome`:
  ```
  abi <abi/4.0>,
  include <tunables/global>
  profile agent-browser-chrome @{HOME}/.agent-browser/browsers/chrome-*/chrome flags=(unconfined) {
    userns,
  }
  ```
  then `sudo apparmor_parser -r /etc/apparmor.d/agent-browser-chrome`. Name a session after its
  workspace and Tarfa's browser view picks it up (`docs/BROWSER.md`).

## 13. Another Linux user on the same machine

One machine can run several Tarfa agents, one per Linux user. Each user has its own agent, tmux
server, `~/.tarfa` (agent key, paired phones, parked workspaces, and its own `hidden-folders.json`
and `launchers.json`), Claude Code login and config, and files. The phone sees
each agent as a separate machine. Use it to keep one kind of work apart from the rest: a client's
projects in an account that cannot read your home directory, your credentials or your sessions.

Everything below runs from your admin account. `<user>` is the new user, `<uid>` its id
(`id -u <user>`).

**The user.** Give it neither `sudo` nor the `docker` group: either one can read every other
user's files, which defeats the point. Check that your own home is closed to it as well
(`stat -c %a ~` should say `750` or `700`; older Ubuntu installs made homes `755`). Other users
can still see command lines in `ps`, which is why Tarfa keeps its secrets off them.

```bash
sudo adduser --disabled-password --gecos '' <user>
sudo loginctl enable-linger <user>
id <user>                     # no sudo, no docker among the groups
```

If the user needs Docker, run it rootless and private to that user
([rootless mode](https://docs.docker.com/engine/security/rootless/)).

**Memory.** With several users, cap each one's `user-<uid>.slice`, yours included, instead of the
single `user@<uid>.service` of step 2: the slice also holds the user's SSH logins. Keep the sum
of the limits within the machine, so one user's runaway job cannot freeze another's workspaces.
For each user:

```bash
sudo mkdir -p /etc/systemd/system/user-<uid>.slice.d
sudo tee /etc/systemd/system/user-<uid>.slice.d/50-share.conf >/dev/null <<'EOF'
[Slice]
MemoryHigh=<e.g. 8G>
MemoryMax=<e.g. 10G>
MemorySwapMax=2G
EOF
sudo systemctl daemon-reload
```

Then remove step 2's `user@<uid>.service.d/50-memory.conf` for your own user. Give the new user
the `heavy` wrapper of step 2 in its own `~/.local/bin`.

**Working as that user.** For the interactive parts (step 3's installers, the Claude Code and
Codex logins), open a shell as that user:

```bash
sudo -iu <user>
export XDG_RUNTIME_DIR=/run/user/$(id -u)   # or systemctl --user cannot reach its user manager
```

For scripted parts, a here-doc keeps the quoting simple. It runs a non-interactive shell, which
reads no profile, so set the two variables it lacks:

```bash
sudo -u <user> -H bash -s <<'EOF'
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export PATH=$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH
tarfa update
EOF
```

**Steps 3 to 6, 8 and 9 again, as that user** (step 7, if you serve your own app, is done once per Cloudflare account). The new user installs the package itself (mise, step 3, and `tarfa setup`).
In its `~/.tarfa/agent.env`, these values differ:

- **`TARFA_PORT` must differ from every other agent's on the machine** (and step 6's check
  `curl`s that port). Each agent listens on `127.0.0.1:<port>` for its hooks, and with the port
  taken the second agent exits at once and its service restarts it in a loop. Pick 8789 or above. `install-hooks` and the `tarfa` CLI read the port from
  `agent.env`; `install-hooks` writes it into each hook, so run it again after changing the port.
- **`TARFA_PHONE_PORT` must differ too** (8798 beside your 8797): `setup` refuses a phone port
  another user's agent holds.
- **`TARFA_PHONE_ADDRESSES`** names this agent's own address (under its `/<slug>` when it shares
  your Tailscale port), which `setup` writes.
- **`TARFA_MACHINE_ID`** is the name the phone shows: give each agent its own.

Two more matter only when both users use the feature:

- **`TARFA_STATS`**: each agent shows its own user's memory room on the home screen, which is
  how you see the new user's jobs nearing their cap. `TARFA_STATS=off` hides that line.
- **`TARFA_VOICE_DEVICE`**: for Claude voice, each user needs its own loopback subdevice, in
  its `~/.asoundrc` and its `agent.env` (step 11, "Several Linux users on one machine").

With `tarfa setup` (step 6), the second user passes its own `--machine-id` and
`--phone-port` (8798 beside your 8797; `setup` refuses a port another user's agent holds), and
sets `TARFA_PORT` in its `agent.env` first (`setup` refuses a hooks port that is taken, naming
it). To share your Tailscale port under its own path, it runs `--tailscale none --slug <user>
--address wss://<node>.<tailnet>.ts.net/<user>`, and `setup` prints the `tailscale serve` line
for you, the node's operator, to run. Ask step 8's question for that user too: an address on a port
already on Funnel (say `:10000/<user>`) is reachable without Tailscale, one on a tailnet-only port is
not, and its `reachability:` line says which.

**What not to copy from your account.**
- **`~/.tarfa`:** never copy it. It holds your agent key and your phones' roster; the new user's
  agent makes its own.
- **`~/.claude`:** never copy it whole. It holds your Claude login (`.credentials.json`) and your
  conversations (`projects/`, `history.jsonl`). Copy only what the user should have: the
  instructions in `CLAUDE.md`, chosen skills, `settings.json`. In that `settings.json` `env`, set
  `ENABLE_CLAUDEAI_MCP_SERVERS=false`, or the claude.ai connectors of a shared Claude account
  (mail, drive) come along.

**Pairing the phone (step 8).** The phone gets a separate entry for this agent, under its own
agent key. `tarfa setup --pair` prints the first pairing code; `tarfa pair` makes more.

**Running it from your account.**
- Its user services: `sudo systemctl --user -M <user>@ <status|restart> tarfa-agent`.
- Its logs: `sudo journalctl _UID=<uid> _SYSTEMD_USER_UNIT=tarfa-agent.service`.
- Updating it is step 9, run as that user.
- Each user has its own tmux server. Upgrading tmux replaces **every** user's server in the same
  step, or a newer client cannot attach to an older server (`docs/TMUX-OSC7501.md`).

## 14. Pitfalls

- **Every new workspace says "No session" (status 127):** `claude` is not on the user services'
  PATH. Step 4, then restart the agent.
- **`wrangler pages project create` made an empty Worker:** deploy the app as a static-assets
  Worker (step 7).
- **The deploy script refuses:** it wants the main checkout, on `main`, clean, equal to
  `origin/main`, and an env file only you can read. Fix the checkout rather than working around it.
- **Pairing "did nothing":** the code was scanned with the Camera app or pasted in a browser, not in
  the installed app (on an iPhone, Safari's storage is not the app's either). Scan or paste it from
  inside the app: Settings → Add machine.
- **Codex shows no status:** its hooks are not trusted yet (`/hooks`), `install-hooks` ran before
  Codex's home existed, `CODEX_HOME` is set where a login shell does not see it (`docs/DEPLOY.md`, step 4), or Codex was started without `--no-daemon` (the app's create form adds it).
- **Password SSH is still on:** cloud-init's `50-cloud-init.conf` wins unless your file sorts
  before it.
- **The phone cannot reach the machine:** read the `reachability:` line a bare `tarfa setup --dry-run`
  prints. "Only with Tailscale on" means the phone's Tailscale must be connected (rerun with
  `--tailscale funnel` if it must not be); on Android, Chrome's local-network permission for the app must be allowed (Site
  settings → Local network access). `tailscale serve status` shows what is published.
- **Accents or Arabic show as `_`:** no UTF-8 locale (step 1).
- **After a reboot the workspaces show as parked:** open one to resume its conversation; one
  that had no conversation yet (a shell, or a Claude never used) does not come back.
