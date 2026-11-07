#!/usr/bin/env bash
# Launch the Tarfa agent from this checkout. Sources deploy/agent.env unless TARFA_AGENT_ENV names one.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The launcher (~/.tarfa/bin/tarfa-agent) has already sourced agent.env and named it in
# TARFA_AGENT_ENV, and a worktree it runs from has no deploy/agent.env of its own.
if [ -z "${TARFA_AGENT_ENV:-}" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${REPO}/deploy/agent.env"
  set +a
  # The agent refuses to start while this file is readable by another user.
  export TARFA_AGENT_ENV="${REPO}/deploy/agent.env"
fi
# Run the agent from the deploy/agent-live target when it resolves — this lets a worktree's
# agent be served for on-device testing (see deploy/serve-agent.sh). Secrets are always
# sourced from main's agent.env above. A missing or dangling symlink falls back to main.
TARGET="${REPO}"
LIVE="${REPO}/deploy/agent-live"
if [ -e "${LIVE}" ]; then TARGET="$(cd "${LIVE}" && pwd -P)"; fi
cd "${TARGET}"
# Service managers (launchd/systemd) don't inherit an interactive PATH, so pnpm/node
# (managed by mise) may be absent. Run through mise when we can find it.
for mise_bin in "${HOME}/.local/bin/mise" /opt/homebrew/bin/mise /usr/local/bin/mise; do
  if [ -x "${mise_bin}" ]; then
    exec "${mise_bin}" exec -- pnpm --filter @tarfa/cli exec tsx src/serve.ts
  fi
done
exec pnpm --filter @tarfa/cli exec tsx src/serve.ts
