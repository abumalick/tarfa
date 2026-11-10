# @tarfa/cli

The Tarfa agent and command line. Tarfa is a phone app ([tarfa.app](https://tarfa.app)) that shows
and drives the Claude Code, Codex and shell sessions (tmux workspaces) running on your machines.
This package runs on each machine (macOS or Linux): it serves that machine's workspaces to your
phone, end to end encrypted, and gives every workspace the `tarfa` command.

## Install

Needs `tmux` and [mise](https://mise.jdx.dev). Nothing is compiled.

```sh
mise use -g node@24 npm:@tarfa/cli@latest
tarfa setup --machine-id <name> --project-roots ~/workspace --tailscale serve --dry-run   # see the plan
tarfa setup --machine-id <name> --project-roots ~/workspace --tailscale serve --pair      # run it
```

`tarfa setup` writes `~/.tarfa/agent.env`, the agent key, the service (a systemd user unit or a
launchd agent) and the Claude Code hooks, publishes the phone port with Tailscale, and prints a
pairing code and its QR code. In the installed app on the phone, Settings → Add machine: scan it,
or paste the code. `tarfa setup --help`
lists every flag.

## Day to day

```sh
tarfa pair        # a one-time pairing code for another phone (--link: a link, for an older app)
tarfa devices     # paired phones; revoke or forget one
tarfa update      # install the newest release and restart the agent; workspaces survive
tarfa ls          # this machine's workspaces
tarfa --help      # every command
```

## More

The full runbook, including publishing the phone port without Tailscale and running your own copy
of the app, is [docs/DEPLOY.md](https://github.com/abumalick/tarfa/blob/main/docs/DEPLOY.md).
Source and issues: [github.com/abumalick/tarfa](https://github.com/abumalick/tarfa).
