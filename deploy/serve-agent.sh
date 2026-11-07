#!/usr/bin/env bash
# Temporarily run the agent service from a worktree's source, so agent/protocol changes
# can be tested on-device without merging — the agent equivalent of serve-build.sh.
# On a machine whose service runs the launcher (~/.tarfa/bin/tarfa-agent), it writes or removes
# ~/.tarfa/agent-source, which the launcher follows, and restarts the service. Otherwise it flips
# the deploy/agent-live symlink (which run-agent.sh runs the agent from) and restarts. Secrets
# come from agent.env either way. See docs/WORKTREES.md.
# `pnpm serve:agent .` from main runs unreleased main in place of the installed release.
#
#   pnpm serve:agent <worktree-path>   # run that worktree's agent live
#   pnpm serve:agent-restore           # point back at main's agent
#   pnpm serve:agent-heal              # restore main only if agent-live dangles
#
# Set TARFA_SKIP_RESTART=1 to switch without restarting (used by the tests).
set -euo pipefail
# The main checkout, wherever this copy runs from: the live symlinks the services read are main's.
REPO="$(cd "$(dirname "$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --path-format=absolute --git-common-dir)")" && pwd)"
LIVE="${REPO}/deploy/agent-live"
LAUNCHER="${HOME}/.tarfa/bin/tarfa-agent"
SOURCE="${HOME}/.tarfa/agent-source"

# Whether the installed unit or plist runs the launcher rather than a checkout's run-agent.sh.
runs_launcher() {
  local definition
  for definition in "${HOME}/.config/systemd/user/tarfa-agent.service" "${HOME}/Library/LaunchAgents/app.tarfa.agent.plist"; do
    if [ -f "${definition}" ] && grep -qF -- "${LAUNCHER}" "${definition}"; then return 0; fi
  done
  return 1
}

# Restart is safe: the unit uses KillMode=process, so the tmux server and its sessions
# survive (the agent re-discovers them via `tmux list-sessions`), and each keeps its status
# (FileStatusStore, ~/.tarfa/status.json).
restart_agent() {
  if [ -n "${TARFA_SKIP_RESTART:-}" ]; then return 0; fi
  # perch-agent / com.perch.agent: the service's names until `tarfa setup` swaps them.
  if command -v systemctl >/dev/null 2>&1; then
    for unit in tarfa-agent perch-agent; do
      if [ -f "${HOME}/.config/systemd/user/${unit}.service" ]; then
        systemctl --user restart "${unit}"
        return 0
      fi
    done
  fi
  if command -v launchctl >/dev/null 2>&1; then
    for label in app.tarfa.agent com.perch.agent; do
      if [ -f "${HOME}/Library/LaunchAgents/${label}.plist" ]; then
        launchctl kickstart -k "gui/$(id -u)/${label}"
        return 0
      fi
    done
  fi
  echo "warning: no agent service found; restart the agent manually." >&2
}

restore_main() { ln -sfn "${REPO}" "${LIVE}"; }

if [ "${1:-}" = "--restore" ]; then
  if runs_launcher; then
    rm -f "${SOURCE}"
    restart_agent
    echo "Restored: agent running the installed release."
    exit 0
  fi
  restore_main
  restart_agent
  echo "Restored: agent running from main."
  exit 0
fi

if [ "${1:-}" = "--heal" ]; then
  if runs_launcher; then
    # The launcher already falls through to the release when the checkout is gone; this clears
    # the stale pointer.
    if [ -f "${SOURCE}" ] && [ ! -d "$(head -n 1 "${SOURCE}")" ]; then
      rm -f "${SOURCE}"
      restart_agent
      echo "Healed: agent-source named a missing path; removed it."
    else
      echo "agent-source is healthy; nothing to heal."
    fi
    exit 0
  fi
  # A symlink that exists but resolves to nothing means its worktree was removed out from
  # under the live agent. Fall back to main so the next (re)start runs a valid checkout.
  if [ -L "${LIVE}" ] && [ ! -e "${LIVE}" ]; then
    restore_main
    restart_agent
    echo "Healed: agent-live was dangling; restored main."
  else
    echo "agent-live is healthy; nothing to heal."
  fi
  exit 0
fi

WT_ARG="${1:?usage: serve-agent.sh <worktree-path> | --restore | --heal}"
WT="$(cd "${WT_ARG}" && pwd)"   # absolutize; fails loudly if the path is missing
SLUG="$(basename "${WT}")"

if runs_launcher; then
  mkdir -p "${HOME}/.tarfa"
  (umask 077 && printf '%s\n' "${WT}" > "${SOURCE}")
  chmod 600 "${SOURCE}"
else
  ln -sfn "${WT}" "${LIVE}"
fi
restart_agent
echo "Now running the agent from '${SLUG}'. Restore main with: pnpm serve:agent-restore"
