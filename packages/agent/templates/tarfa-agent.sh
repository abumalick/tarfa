#!/bin/sh
# The agent service's stable entry point: the unit or plist names this file, never a versioned
# path, so upgrading the package changes what runs without touching the service definition.
set -eu
# Kept apart from $HOME: agent.env is sourced below, and a HOME= line there must not move the lookups.
home="$HOME"
state="$home/.tarfa"
if [ ! -f "$state/agent.env" ]; then
  echo "tarfa-agent: $state/agent.env is missing: run tarfa setup" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. "$state/agent.env"
set +a
TARFA_AGENT_ENV="$state/agent.env"
export TARFA_AGENT_ENV

# A checkout named by agent-source runs instead of the release (deploy/serve-agent.sh writes it).
# A path that is gone, say a removed worktree, must not crash-loop the service.
if [ -f "$state/agent-source" ]; then
  checkout=""
  IFS= read -r checkout < "$state/agent-source" || true
  if [ -n "$checkout" ] && [ -f "$checkout/deploy/run-agent.sh" ]; then
    exec bash "$checkout/deploy/run-agent.sh"
  fi
  echo "tarfa-agent: $state/agent-source names $checkout, which has no deploy/run-agent.sh; running the released agent" >&2
fi

# Service managers do not inherit an interactive PATH, so find mise as deploy/run-agent.sh does.
# From $home, so no project's mise.toml picks the runtime.
cd "$home"
# `mise exec` would install every tool missing from the global config before starting the agent:
# slow, and a tool that cannot install would block it for good. So run the installed package with
# its node directly, as the tarfa wrapper does, and keep mise's shims on PATH for what the agent's
# panes and child tools run.
PATH="$home/.local/bin:${MISE_DATA_DIR:-$home/.local/share/mise}/shims:$PATH"
export PATH
for mise_bin in "$home/.local/bin/mise" /opt/homebrew/bin/mise /usr/local/bin/mise; do
  if [ -x "$mise_bin" ]; then
    install="$("$mise_bin" --cd "$home" where npm:@tarfa/cli 2>/dev/null || true)"
    node_home="$("$mise_bin" --cd "$home" where node 2>/dev/null || true)"
    if [ -n "$install" ] && [ -n "$node_home" ] && [ -x "$node_home/bin/node" ] && [ -f "$install/bin/tarfa" ]; then
      exec "$node_home/bin/node" "$install/bin/tarfa" serve
    fi
    exec "$mise_bin" exec -- tarfa serve
  fi
done
exec tarfa serve
