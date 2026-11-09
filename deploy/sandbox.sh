#!/usr/bin/env bash
# A disposable Tarfa machine per worktree, for testing in a browser without the phone, staging
# or the real agent. Each sandbox is a directory holding its own HOME, tmux server, runtime dir,
# projects and manifest; the worktree's agent and a vite preview of its PWA run as two
# transient user units with that environment. See docs/SANDBOX.md.
#
#   pnpm sandbox up      [--worktree <path>]   start one for the worktree you are in
#   pnpm sandbox down    [--worktree <path>]   stop it and delete it
#   pnpm sandbox env     [--worktree <path>]   print the path of its env.sh
#   pnpm sandbox exec    [--worktree <path>] -- <cmd...>   run a command in its environment
#   pnpm sandbox status  [--worktree <path>]   units, tmux sessions, the agent's last log lines
#   pnpm sandbox rebuild [--worktree <path>] [--agent|--pwa]   pick up a code change
#   pnpm sandbox ls                            every sandbox on this machine
#   pnpm sandbox gc [--older-than-hours N]     remove sandboxes whose worktree or agent is gone
set -euo pipefail

REAL_HOME="${HOME}"
BASE="${TARFA_SANDBOX_ROOT:-${REAL_HOME}/.cache/tarfa-sandbox}"
TOKEN_FILE="${TARFA_SANDBOX_CLAUDE_TOKEN_FILE:-${REAL_HOME}/.config/tarfa-sandbox/claude-oauth-token}"
TOKEN_ITEM="Tarfa sandbox - Claude Code OAuth token"
READY_SECONDS=30

die() { echo "sandbox: $*" >&2; exit 1; }

sb_slug() { # <worktree>
  local s
  s="$(basename "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')"
  printf '%s' "${s:0:24}"
}
sb_root() { printf '%s/%s' "${BASE}" "$1"; }
# The tmux socket the sandbox's server listens on; every tmux call names it, never the default.
sb_socket() { printf '%s/tmux/tmux-%s/default' "$1" "$(id -u)"; }
sb_unit_active() { systemctl --user is-active --quiet "$1" 2>/dev/null; }

resolve_worktree() { # <path or empty>
  local wt="${1:-${PWD}}"
  wt="$(git -C "${wt}" rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git checkout: ${1:-${PWD}}"
  (cd "${wt}" && pwd -P)
}

port() { node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }

# The sandbox environment, one KEY=VALUE per line: what env.sh exports and the agent unit gets.
sb_env_pairs() { # <root>
  local root="$1"
  echo "HOME=${root}/home"
  echo "TMUX_TMPDIR=${root}/tmux"
  echo "XDG_RUNTIME_DIR=${root}/run"
  # The real user bus, so systemctl --user (the pane scope reaper) still reaches the manager.
  echo "DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
  echo "TARFA_AGENT_ENV=${root}/home/.tarfa/agent.env"
  # mise keeps its installs and its list of trusted folders under the real HOME.
  echo "MISE_DATA_DIR=${REAL_HOME}/.local/share/mise"
  echo "MISE_CONFIG_DIR=${REAL_HOME}/.config/mise"
  echo "MISE_STATE_DIR=${REAL_HOME}/.local/state/mise"
  echo "MISE_CACHE_DIR=${REAL_HOME}/.cache/mise"
}

write_env_sh() { # <root>
  local kv
  {
    while IFS= read -r kv; do printf 'export %s=%q\n' "${kv%%=*}" "${kv#*=}"; done < <(sb_env_pairs "$1")
    printf 'unset TMUX TMUX_PANE\n'
  } > "$1/env.sh"
}

unit_env_flags() { # <root>
  local kv
  while IFS= read -r kv; do printf -- '--setenv=%s\n' "${kv}"; done < <(sb_env_pairs "$1")
  printf -- '--setenv=PATH=%s\n' "${PATH}"
}

in_sandbox() { # <root> <cmd...>  run a command with the sandbox env, from the worktree
  local root="$1"; shift
  (. "${root}/env.sh"; cd "$(jq -r .worktree "${root}/manifest.json")" && "$@")
}

seed_projects() { # <root>
  local p
  for p in demo-a demo-b; do
    mkdir -p "$1/projects/${p}"
    printf '# %s\n\nA throwaway project in a Tarfa sandbox.\n' "${p}" > "$1/projects/${p}/README.md"
    git -C "$1/projects/${p}" init -q
    git -C "$1/projects/${p}" add README.md
    git -C "$1/projects/${p}" -c user.name='Tarfa Sandbox' -c user.email=sandbox@example.invalid commit -qm init
  done
}

seed_home() { # <root>
  local root="$1" home="$1/home" version
  version="$(claude --version | awk '{print $1}')"
  jq -n --arg v "${version}" --arg p "${root}/projects" --arg a "${root}/projects/demo-a" --arg b "${root}/projects/demo-b" \
    '{hasCompletedOnboarding: true, lastOnboardingVersion: $v,
      projects: {($p): {hasTrustDialogAccepted: true}, ($a): {hasTrustDialogAccepted: true}, ($b): {hasTrustDialogAccepted: true}}}' \
    > "${home}/.claude.json"
  git config -f "${home}/.gitconfig" user.name 'Tarfa Sandbox'
  git config -f "${home}/.gitconfig" user.email sandbox@example.invalid
  cat > "${home}/CLAUDE.md" <<'EOF'
# Tarfa sandbox

This machine is a disposable Tarfa sandbox, made for testing. Its projects are throwaway
repositories and nothing here matters. It runs as a real user account, though: stay inside this
HOME and the projects folder, and never touch paths outside them.
EOF
}

install_hooks() { # <root>
  local root="$1" settings="$1/home/.claude/settings.json"
  in_sandbox "${root}" pnpm --filter @tarfa/cli exec tsx src/cli.ts install-hooks > /dev/null
  jq '.model = "sonnet"' "${settings}" > "${settings}.new" && mv "${settings}.new" "${settings}"
}

build_pwa() { # <root>
  local root="$1" wt slug
  wt="$(jq -r .worktree "${root}/manifest.json")"; slug="$(jq -r .slug "${root}/manifest.json")"
  (cd "${wt}" && TARFA_APP_FLAVOR=dev TARFA_BUILD_LABEL="sandbox-${slug}" \
    pnpm --filter @tarfa/pwa build --outDir "${root}/pwa-dist" --emptyOutDir > /dev/null)
}

wait_agent_ready() { # <root>  the agent writes its hooks token at each start
  local root="$1" i
  for ((i = 0; i < READY_SECONDS * 5; i++)); do
    [ -s "${root}/home/.tarfa/token" ] && return 0
    sleep 0.2
  done
  journalctl --user -u "$(jq -r .units.agent "${root}/manifest.json")" -n 30 --no-pager >&2 || true
  return 1
}

start_agent() { # <root>
  local root="$1" unit wt
  unit="$(jq -r .units.agent "${root}/manifest.json")"; wt="$(jq -r .worktree "${root}/manifest.json")"
  rm -f "${root}/home/.tarfa/token"
  local flags=()
  mapfile -t flags < <(unit_env_flags "${root}")
  # KillMode=process: a restart (rebuild) keeps the tmux server and its workspaces, as in production.
  systemd-run --user --quiet --collect --unit "${unit}" -p KillMode=process -p MemoryMax=4G \
    -p EnvironmentFile="${root}/secrets.env" --working-directory="${wt}" "${flags[@]}" \
    env -u TMUX -u TMUX_PANE bash -c 'set -a; . "$TARFA_AGENT_ENV"; set +a; exec pnpm --filter @tarfa/cli exec tsx src/serve.ts'
}

start_pwa() { # <root>
  local root="$1" unit wt pwa
  unit="$(jq -r .units.pwa "${root}/manifest.json")"; wt="$(jq -r .worktree "${root}/manifest.json")"
  pwa="$(jq -r .ports.pwa "${root}/manifest.json")"
  systemd-run --user --quiet --collect --unit "${unit}" -p MemoryMax=1G \
    --working-directory="${wt}/packages/pwa" --setenv=PATH="${PATH}" \
    pnpm exec vite preview --host 127.0.0.1 --port "${pwa}" --strictPort --outDir "${root}/pwa-dist"
}

pair_link() { # <root>  mint a pairing link, one use, ten minutes
  in_sandbox "$1" pnpm --filter @tarfa/cli exec tsx src/cli.ts pair | grep -oE 'http://127\.0\.0\.1:[0-9]+/#pair\?[^[:space:]]+' | head -n 1
}

manifest_set() { # <root> <jq filter> [--arg k v]...
  local root="$1" filter="$2"; shift 2
  jq "$@" "${filter}" "${root}/manifest.json" > "${root}/manifest.json.new" && mv "${root}/manifest.json.new" "${root}/manifest.json"
}

cmd_down() { # <root>
  local root="$1" slug
  slug="$(basename "${root}")"
  if [ ! -d "${root}" ]; then echo "no sandbox for ${slug}"; return 0; fi
  case "${root}" in "${BASE}/"?*) ;; *) die "refusing to remove ${root}: outside ${BASE}" ;; esac
  tmux -S "$(sb_socket "${root}")" kill-server 2>/dev/null || true
  systemctl --user stop "tarfa-sb-${slug}-agent" "tarfa-sb-${slug}-pwa" 2>/dev/null || true
  systemctl --user reset-failed "tarfa-sb-${slug}-agent" "tarfa-sb-${slug}-pwa" 2>/dev/null || true
  rm -rf "${root}"
  echo "sandbox ${slug} is down"
}

cmd_exec() { # <root> <cmd...>
  local root="$1"; shift
  (. "${root}/env.sh"; exec "$@")
}

cmd_status() { # <root>
  local root="$1" unit
  jq -r '"sandbox \(.slug)  worktree \(.worktree)\n  ports  hooks \(.ports.hooks)  phone \(.ports.phone)  pwa \(.ports.pwa)"' "${root}/manifest.json"
  for unit in $(jq -r '.units.agent, .units.pwa' "${root}/manifest.json"); do
    if sb_unit_active "${unit}"; then echo "  ${unit}: active"; else echo "  ${unit}: not running"; fi
  done
  echo "tmux sessions:"
  tmux -S "$(sb_socket "${root}")" ls 2>/dev/null | sed 's/^/  /' || echo "  no tmux server"
  echo "agent log:"
  journalctl --user -u "$(jq -r .units.agent "${root}/manifest.json")" -n 15 --no-pager 2>/dev/null | sed 's/^/  /' || true
}

cmd_rebuild() { # <root> <agent|pwa|both>
  local root="$1" what="$2"
  if [ "${what}" != agent ]; then build_pwa "${root}"; echo "PWA rebuilt"; fi
  if [ "${what}" != pwa ]; then
    install_hooks "${root}"
    rm -f "${root}/home/.tarfa/token"
    systemctl --user restart "$(jq -r .units.agent "${root}/manifest.json")"
    wait_agent_ready "${root}" || die "the agent did not come back within ${READY_SECONDS}s (its log is above)"
    echo "agent restarted; workspaces kept"
  fi
}

age_hours() { # <ISO time>
  echo $(( ($(date +%s) - $(date -d "$1" +%s)) / 3600 ))
}

cmd_ls() {
  local m slug wt state
  for m in "${BASE}"/*/manifest.json; do
    [ -f "${m}" ] || continue
    slug="$(jq -r .slug "${m}")"; wt="$(jq -r .worktree "${m}")"
    [ -d "${wt}" ] || wt="${wt} (gone)"
    if sb_unit_active "$(jq -r .units.agent "${m}")"; then state=up; else state=down; fi
    printf '%s  %s  %s  pwa=%s  %sh\n' "${slug}" "${wt}" "${state}" "$(jq -r .ports.pwa "${m}")" "$(age_hours "$(jq -r .createdAt "${m}")")"
  done
}

# By default only sandboxes nobody can be using: a peer's live sandbox is never collected by age
# unless asked.
cmd_gc() { # [max age in hours]
  local max="${1:-}" m root why
  for m in "${BASE}"/*/manifest.json; do
    [ -f "${m}" ] || continue
    root="$(dirname "${m}")"; why=""
    if [ ! -d "$(jq -r .worktree "${m}")" ]; then why="worktree gone"
    elif ! sb_unit_active "$(jq -r .units.agent "${m}")"; then why="agent not running"
    elif [ -n "${max}" ] && [ "$(age_hours "$(jq -r .createdAt "${m}")")" -ge "${max}" ]; then why="older than ${max}h"
    fi
    if [ -n "${why}" ]; then
      echo "removing $(basename "${root}") (${why})"
      cmd_down "${root}" > /dev/null
    fi
  done
}

cmd_up() { # <worktree>
  local wt="$1" slug root
  slug="$(sb_slug "${wt}")"; root="$(sb_root "${slug}")"
  [ -d "${wt}/node_modules" ] || die "no node_modules in ${wt}: run pnpm install in ${wt}"
  [ -s "${TOKEN_FILE}" ] || die "no Claude token at ${TOKEN_FILE}: copy it from the Bitwarden item \"${TOKEN_ITEM}\" (0600), or make one with \`claude setup-token\`"
  if [ -e "${root}" ]; then
    if sb_unit_active "tarfa-sb-${slug}-agent"; then
      die "sandbox ${slug} is already up — pnpm sandbox rebuild, or pnpm sandbox down first"
    fi
    cmd_down "${root}" > /dev/null
  fi

  umask 077
  mkdir -p "${BASE}" "${root}"/{home/.tarfa,home/.claude,home/.codex,tmux,run,projects,pwa-dist}
  chmod 700 "${root}"
  local hooks phone pwa
  hooks="$(port)"; phone="$(port)"; pwa="$(port)"
  while [ "${phone}" = "${hooks}" ]; do phone="$(port)"; done
  while [ "${pwa}" = "${hooks}" ] || [ "${pwa}" = "${phone}" ]; do pwa="$(port)"; done

  jq -n --arg slug "${slug}" --arg wt "${wt}" --arg root "${root}" \
    --argjson hooks "${hooks}" --argjson phone "${phone}" --argjson pwa "${pwa}" \
    --arg agent "tarfa-sb-${slug}-agent" --arg pwaunit "tarfa-sb-${slug}-pwa" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{slug: $slug, worktree: $wt, root: $root, ports: {hooks: $hooks, phone: $phone, pwa: $pwa},
      units: {agent: $agent, pwa: $pwaunit}, browser: null, pairLink: null, createdAt: $at}' > "${root}/manifest.json"
  cat > "${root}/home/.tarfa/agent.env" <<EOF
TARFA_MACHINE_ID=sandbox-${slug}
TARFA_PROJECT_ROOTS=${root}/projects
TARFA_DEFAULT_PATH=${root}/projects
TARFA_PORT=${hooks}
TARFA_PHONE_PORT=${phone}
TARFA_PHONE_ADDRESSES=ws://127.0.0.1:${phone}
TARFA_PWA_ORIGIN=http://127.0.0.1:${pwa}
TARFA_STATS=off
EOF
  printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$(tr -d '[:space:]' < "${TOKEN_FILE}")" > "${root}/secrets.env"
  seed_projects "${root}"
  seed_home "${root}"
  write_env_sh "${root}"
  install_hooks "${root}"
  build_pwa "${root}"
  start_agent "${root}"
  start_pwa "${root}"
  if ! wait_agent_ready "${root}"; then
    cmd_down "${root}" > /dev/null
    die "the agent did not start within ${READY_SECONDS}s (its log is above)"
  fi
  local link
  link="$(pair_link "${root}")"
  manifest_set "${root}" '.pairLink = $l' --arg l "${link}"

  echo "sandbox ${slug} is up"
  echo "  PWA       http://127.0.0.1:${pwa}/"
  echo "  pair      ${link}"
  echo "  env       ${root}/env.sh   (pnpm sandbox exec -- <cmd> runs a command in it)"
  echo "  tmux      tmux -S $(sb_socket "${root}") ls"
}

main() {
  local cmd="${1:-}"; shift || true
  local wt_arg="" what=both max=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --worktree) wt_arg="${2:?--worktree needs a path}"; shift 2 ;;
      --agent) what=agent; shift ;;
      --pwa) what=pwa; shift ;;
      --older-than-hours) max="${2:?--older-than-hours needs a number}"; shift 2 ;;
      --) shift; break ;;
      *) break ;;
    esac
  done
  case "${cmd}" in
    ls) cmd_ls; return ;;
    gc) cmd_gc "${max}"; return ;;
  esac
  local wt slug root
  wt="$(resolve_worktree "${wt_arg}")"; slug="$(sb_slug "${wt}")"; root="$(sb_root "${slug}")"
  case "${cmd}" in
    up) cmd_up "${wt}"; return ;;
    down) cmd_down "${root}"; return ;;
    exec | status | rebuild | env) [ -f "${root}/manifest.json" ] || die "no sandbox for ${slug}; pnpm sandbox up" ;;
    *) die "usage: sandbox.sh up|down|env|exec|status|rebuild|ls|gc [--worktree <path>] (see the header of this script)" ;;
  esac
  case "${cmd}" in
    exec) [ $# -gt 0 ] || die "usage: sandbox.sh exec -- <cmd...>"; cmd_exec "${root}" "$@" ;;
    status) cmd_status "${root}" ;;
    rebuild) cmd_rebuild "${root}" "${what}" ;;
    env) echo "${root}/env.sh" ;;
  esac
}

main "$@"
