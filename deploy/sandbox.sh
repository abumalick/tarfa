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
#   pnpm sandbox pair    [--worktree <path>]   pair the headless browser again (a fresh link)
#   pnpm sandbox ls                            every sandbox on this machine
#   pnpm sandbox gc [--older-than-hours N]     remove sandboxes whose worktree or agent is gone
set -euo pipefail

REAL_HOME="${HOME}"
BASE="${TARFA_SANDBOX_ROOT:-${REAL_HOME}/.cache/tsb}"
TOKEN_FILE="${TARFA_SANDBOX_CLAUDE_TOKEN_FILE:-${REAL_HOME}/.config/tarfa-sandbox/claude-oauth-token}"
# A ChatGPT login of its own for every sandbox's Codex, never the user's ~/.codex: its refresh token
# is single-use, so a sandbox sharing the user's login could sign the user's own Codex out.
CODEX_LOGIN="${TARFA_SANDBOX_CODEX_HOME:-${REAL_HOME}/.config/tarfa-sandbox/codex}"
READY_SECONDS="${TARFA_SANDBOX_READY_SECONDS:-30}"
# Each sandbox's workspaces run in tmux's own scopes, outside the agent unit's MemoryMax, so the
# number of sandboxes is what bounds their memory.
MAX_SANDBOXES="${TARFA_SANDBOX_MAX:-4}"
LOCK_HELD=""
UP_ROOT=""

die() { echo "sandbox: $*" >&2; exit 1; }

# A short readable prefix and a hash of the worktree's physical path: two checkouts with the same
# folder name get two sandboxes, and the tmux socket path stays well under its ~100-byte limit.
sb_slug() { # <worktree>
  local s
  s="$(basename "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')"
  printf '%s-%s' "${s:0:12}" "$(printf '%s' "$1" | sha1sum | cut -c1-8)"
}
sb_root() { printf '%s/%s' "${BASE}" "$1"; }
# The tmux socket the sandbox's server listens on; every tmux call names it, never the default.
sb_socket() { printf '%s/tmux/tmux-%s/default' "$1" "$(id -u)"; }
# Starting or reloading counts as live: a unit is "activating" while a peer's up or rebuild waits on it.
sb_unit_active() {
  case "$(systemctl --user is-active "$1" 2>/dev/null)" in active | activating | reloading) return 0 ;; esac
  return 1
}

# One sandbox command at a time per sandbox; gc skips a sandbox whose lock is held (an up still
# building, say), so it never removes one a peer is making.
take_lock() { # <slug>
  mkdir -p "${BASE}"
  exec 9> "${BASE}/$1.lock"
  flock -n 9 || die "another sandbox command is running on $1; try again when it is done"
  LOCK_HELD="$1"
}

resolve_worktree() { # <path or empty> [allow-missing]
  local wt="${1:-${PWD}}"
  # A worktree already removed can still be named by its absolute path, to take its sandbox down.
  if [ -n "${2:-}" ] && [ ! -e "${wt}" ]; then
    case "${wt}" in /*) printf '%s' "${wt}"; return ;; esac
  fi
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
    printf 'set -a; . %q; set +a\n' "$1/secrets.env"
    # Codex prefers CODEX_HOME to HOME: one the caller had would be the user's own login.
    printf 'unset TMUX TMUX_PANE CODEX_HOME\n'
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
  codex_config "${root}"
}

# Codex runs a hook only once it is trusted in /hooks, which stores
# [hooks.state."<hooks.json>:<event>:<group>:<handler>"] trusted_hash = sha256 of the hook's
# normalised identity, as compact JSON with sorted keys. Computed here the way Codex 0.167 does
# (a command handler gets timeout 600 and async false when unset), so the sandbox trusts exactly
# the hooks install-hooks wrote. The live test catches a Codex release that hashes differently.
CODEX_TRUST_VERSION=0.167.0
codex_hook_trust() { # <hooks.json>
  local hj="$1" row
  [ -f "${hj}" ] || return 0
  jq -c '.hooks | to_entries[] | .key as $ev
    | ($ev | gsub("(?<a>[a-z])(?<b>[A-Z])"; "\(.a)_\(.b)") | ascii_downcase) as $label
    | .value | to_entries[] | .key as $g | .value as $grp
    | $grp.hooks | to_entries[] | select(.value.type == "command")
    | ["\($label):\($g):\(.key)",
       ({event_name: $label, hooks: [.value + {timeout: (.value.timeout // 600), async: (.value.async // false)}]}
        + (if $grp.matcher then {matcher: $grp.matcher} else {} end))]' "${hj}" |
    while IFS= read -r row; do
      printf '\n[hooks.state."%s:%s"]\ntrusted_hash = "sha256:%s"\n' "${hj}" "$(jq -r '.[0]' <<< "${row}")" \
        "$(jq -cSj '.[1]' <<< "${row}" | sha256sum | cut -d' ' -f1)"
    done
}

codex_config() { # <root>
  local root="$1" p
  (
    umask 077
    {
      printf 'cli_auth_credentials_store = "file"\ncheck_for_update_on_startup = false\n'
      for p in "${root}/projects" "${root}/projects/demo-a" "${root}/projects/demo-b"; do
        printf '\n[projects."%s"]\ntrust_level = "trusted"\n' "${p}"
      done
      codex_hook_trust "${root}/home/.codex/hooks.json"
    } > "${root}/home/.codex/config.toml"
  )
}

# Links, not copies: Codex follows a linked auth.json and renames its refreshed tokens onto the
# target, so every sandbox sees each rotation. The commit lock beside auth.json is shared that way;
# auth.lock lives in each CODEX_HOME, so it is linked too.
link_codex_login() { # <root>
  [ -f "${CODEX_LOGIN}/auth.json" ] || return 0
  touch "${CODEX_LOGIN}/auth.lock"
  ln -s "${CODEX_LOGIN}/auth.json" "$1/home/.codex/auth.json"
  ln -s "${CODEX_LOGIN}/auth.lock" "$1/home/.codex/auth.lock"
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
    env -u TMUX -u TMUX_PANE -u CODEX_HOME bash -c 'set -a; . "$TARFA_AGENT_ENV"; set +a; exec pnpm --filter @tarfa/cli exec tsx src/serve.ts'
}

# The app server tarfa spawn --cli codex and tarfa send talk to, in its own unit so down stops it
# (run as a daemon from a shell it would stay in that shell's cgroup and outlive the sandbox).
start_codex() { # <root>
  local root="$1" unit
  unit="$(jq -r .units.codex "${root}/manifest.json")"
  [ "${unit}" != null ] || return 0
  local flags=()
  mapfile -t flags < <(unit_env_flags "${root}")
  systemd-run --user --quiet --collect --unit "${unit}" -p MemoryMax=2G \
    --working-directory="${root}/projects" "${flags[@]}" \
    env -u TMUX -u TMUX_PANE -u CODEX_HOME codex app-server --listen unix://
}

start_pwa() { # <root>
  local root="$1" unit wt pwa
  unit="$(jq -r .units.pwa "${root}/manifest.json")"; wt="$(jq -r .worktree "${root}/manifest.json")"
  pwa="$(jq -r .ports.pwa "${root}/manifest.json")"
  systemd-run --user --quiet --collect --unit "${unit}" -p MemoryMax=1G \
    --working-directory="${wt}/packages/pwa" --setenv=PATH="${PATH}" \
    pnpm exec vite preview --host 127.0.0.1 --port "${pwa}" --strictPort --outDir "${root}/pwa-dist"
}

wait_pwa_ready() { # <root>
  local url i
  url="http://127.0.0.1:$(jq -r .ports.pwa "$1/manifest.json")/"
  for ((i = 0; i < READY_SECONDS * 5; i++)); do
    curl -sf -o /dev/null "${url}" && return 0
    sleep 0.2
  done
  journalctl --user -u "$(jq -r .units.pwa "$1/manifest.json")" -n 30 --no-pager >&2 || true
  return 1
}

pair_link() { # <root>  mint a pairing link (the headless browser opens it), one use
  in_sandbox "$1" pnpm --filter @tarfa/cli exec tsx src/cli.ts pair --link | grep -oE 'http://127\.0\.0\.1:[0-9]+/#pair\?[^[:space:]]+' | head -n 1
}

manifest_set() { # <root> <jq filter> [--arg k v]...
  local root="$1" filter="$2"; shift 2
  jq "$@" "${filter}" "${root}/manifest.json" > "${root}/manifest.json.new" && mv "${root}/manifest.json.new" "${root}/manifest.json"
}

devices_enrolled() { # <root>
  jq '.devices | length' "$1/home/.tarfa/devices.json" 2>/dev/null || echo 0
}

pairing_spent() { # <root> <link>
  local secret
  secret="$(printf '%s' "$2" | grep -oE '[?&]s=[^&]+' | head -n 1 | cut -d= -f2)"
  jq -e --arg s "${secret}" 'any(.[]; .secret == $s and .usedAt != null)' "$1/home/.tarfa/pairing.json" > /dev/null 2>&1
}

# agent-browser always runs in the caller's environment, never env.sh's: its sidecar must land in
# the real runtime dir, where the real agent attaches the browser to the caller's workspace.
browser() { # <root> <agent-browser args...>
  local root="$1"; shift
  agent-browser --session "$(jq -r .browser "${root}/manifest.json")" "$@"
}

# The real agent shows a browser on the workspace whose tmux session name prefixes it with `__`.
browser_name() { # <slug>
  local ws=""
  [ -n "${TMUX:-}" ] && ws="$(tmux display-message -p '#S' 2>/dev/null || true)"
  printf '%ssb-%s' "${ws:+${ws}__}" "$1"
}

# Opens a pairing link in the sandbox's headless browser and waits until the agent enrolled it, or
# spent the code on a browser already enrolled.
browser_pair() { # <root> <link>
  local root="$1" link="$2" slug before i
  slug="$(jq -r .slug "${root}/manifest.json")"
  if [ "$(jq -r .browser "${root}/manifest.json")" = null ]; then
    manifest_set "${root}" '.browser = $n' --arg n "$(browser_name "${slug}")"
    browser "${root}" set viewport 412 900 > /dev/null
  fi
  before="$(devices_enrolled "${root}")"
  # The pairing prompt is a confirm() that holds the page's load, so open returns an error.
  browser "${root}" open "${link}" > /dev/null 2>&1 || true
  browser "${root}" dialog accept > /dev/null
  for ((i = 0; i < READY_SECONDS * 5; i++)); do
    if [ "$(devices_enrolled "${root}")" -gt "${before}" ] || pairing_spent "${root}" "${link}"; then
      # The empty list renders only once the machine is online; a sandbox with workspaces shows them.
      if [ "$(tmux -S "$(sb_socket "${root}")" ls 2>/dev/null | wc -l)" -eq 0 ]; then
        browser "${root}" wait --text "No workspaces yet" > /dev/null
      fi
      return 0
    fi
    sleep 0.2
  done
  browser "${root}" screenshot "${BASE}/${slug}-pair-failed.png" > /dev/null 2>&1 || true
  die "the browser did not pair within ${READY_SECONDS}s; see ${BASE}/${slug}-pair-failed.png"
}

cmd_pair() { # <root>
  local link
  link="$(pair_link "$1")"
  manifest_set "$1" '.pairLink = $l' --arg l "${link}"
  browser_pair "$1" "${link}"
  echo "browser $(jq -r .browser "$1/manifest.json") paired"
}

# The service worker serves the old build until its update bar is tapped (registerType: prompt).
browser_reload() { # <root>
  local root="$1"
  [ "$(jq -r .browser "${root}/manifest.json")" != null ] || return 0
  browser "${root}" open "http://127.0.0.1:$(jq -r .ports.pwa "${root}/manifest.json")/" > /dev/null
  if browser "${root}" wait --fn '!!document.querySelector("button.update")' --timeout 10000 > /dev/null 2>&1; then
    browser "${root}" eval '(() => { const b = document.querySelector("button.update"); b?.click(); return !!b; })()' > /dev/null
  else
    echo "no update bar within 10s: if the browser still shows the old build, open the PWA again and tap Update" >&2
  fi
}

cmd_down() { # <root>
  local root="$1" slug
  slug="$(basename "${root}")"
  if [ ! -d "${root}" ]; then echo "no sandbox for ${slug}"; return 0; fi
  case "${root}" in "${BASE}/"?*) ;; *) die "refusing to remove ${root}: outside ${BASE}" ;; esac
  [ "${LOCK_HELD}" = "${slug}" ] || take_lock "${slug}"
  tmux -S "$(sb_socket "${root}")" kill-server 2>/dev/null || true
  if [ -f "${root}/manifest.json" ] && [ "$(jq -r .browser "${root}/manifest.json")" != null ]; then
    browser "${root}" close > /dev/null 2>&1 || true
  fi
  systemctl --user stop "tarfa-sb-${slug}-agent" "tarfa-sb-${slug}-pwa" "tarfa-sb-${slug}-codex" 2>/dev/null || true
  systemctl --user reset-failed "tarfa-sb-${slug}-agent" "tarfa-sb-${slug}-pwa" "tarfa-sb-${slug}-codex" 2>/dev/null || true
  # The lock file stays: whoever holds it (an up replacing this sandbox) would otherwise hold a
  # deleted file nobody else can see.
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
  for unit in $(jq -r '.units[] | select(. != null)' "${root}/manifest.json"); do
    if sb_unit_active "${unit}"; then echo "  ${unit}: active"; else echo "  ${unit}: not running"; fi
  done
  echo "tmux sessions:"
  tmux -S "$(sb_socket "${root}")" ls 2>/dev/null | sed 's/^/  /' || echo "  no tmux server"
  echo "agent log:"
  journalctl --user -u "$(jq -r .units.agent "${root}/manifest.json")" -n 15 --no-pager 2>/dev/null | sed 's/^/  /' || true
}

cmd_rebuild() { # <root> <agent|pwa|both>
  local root="$1" what="$2"
  if [ "${what}" != agent ]; then build_pwa "${root}"; browser_reload "${root}"; echo "PWA rebuilt"; fi
  if [ "${what}" != pwa ]; then
    sb_unit_active "$(jq -r .units.agent "${root}/manifest.json")" || die "the sandbox's agent is not running: pnpm sandbox down, then pnpm sandbox up"
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
    [ -n "${why}" ] || continue
    if ( exec 8> "${BASE}/$(basename "${root}").lock"; flock -n 8 && LOCK_HELD="$(basename "${root}")" && cmd_down "${root}" > /dev/null ); then
      echo "removed $(basename "${root}") (${why})"
    else
      echo "skipped $(basename "${root}") (${why}, but a sandbox command is running on it)"
    fi
  done
}

cmd_up() { # <worktree>
  local wt="$1" slug root
  slug="$(sb_slug "${wt}")"; root="$(sb_root "${slug}")"
  [[ "${MAX_SANDBOXES}" =~ ^[0-9]+$ ]] || die "TARFA_SANDBOX_MAX must be a number, not ${MAX_SANDBOXES}"
  [ -d "${wt}/node_modules" ] || die "no node_modules in ${wt}: run pnpm install in ${wt}"
  # A unix socket path holds at most 107 bytes (bytes, not characters), and the sandbox's tmux and
  # agent-browser sockets live under its root; the Codex link, the longest path there, bounds them all.
  local codex_sock="${root}/home/.codex/app-server-control/app-server-control.sock" codex_bytes
  codex_bytes="$(printf '%s' "${codex_sock}" | wc -c)"
  [ "${codex_bytes}" -le 107 ] || die "the sandbox folder is too deep for the Codex socket (${codex_sock}: ${codex_bytes} bytes, at most 107): set TARFA_SANDBOX_ROOT to a shorter folder"
  [ -n "$(tr -d '[:space:]' < "${TOKEN_FILE}" 2>/dev/null)" ] || die "no Claude token at ${TOKEN_FILE}: make one with \`claude setup-token\` and save it there (mode 0600)"
  if [ -z "${TARFA_SANDBOX_NO_BROWSER:-}" ] && ! command -v agent-browser > /dev/null; then
    die "agent-browser is not installed: install it, or set TARFA_SANDBOX_NO_BROWSER=1 to pair a browser yourself"
  fi
  take_lock "${slug}"
  if [ -e "${root}" ]; then
    if sb_unit_active "tarfa-sb-${slug}-agent"; then
      die "sandbox ${slug} is already up — pnpm sandbox rebuild, or pnpm sandbox down first"
    fi
    cmd_down "${root}" > /dev/null
  fi
  # Locks as well as manifests: a sandbox still being built holds its lock long before its agent
  # starts. Two ups at once then count each other, which errs toward refusing.
  local s m live=()
  for s in $( { for m in "${BASE}"/*.lock "${BASE}"/*/manifest.json; do [ -e "${m}" ] || continue
                case "${m}" in *.lock) basename "${m}" .lock ;; *) basename "$(dirname "${m}")" ;; esac; done; } | sort -u); do
    m="${BASE}/${s}/manifest.json"
    [ "${s}" != "${slug}" ] || continue
    if [ -e "${BASE}/${s}.lock" ] && ( exec 8> "${BASE}/${s}.lock"; ! flock -n 8 ); then live+=("${s} (being made)")
    elif [ -f "${m}" ] && sb_unit_active "$(jq -r .units.agent "${m}")"; then live+=("${s} ($(jq -r .worktree "${m}"))")
    fi
  done
  if [ "${#live[@]}" -ge "${MAX_SANDBOXES}" ]; then
    die "${#live[@]} sandboxes are already up (the limit is ${MAX_SANDBOXES}, TARFA_SANDBOX_MAX): $(printf '%s, ' "${live[@]}" | sed 's/, $//'). They may be other agents': wait for one to finish, run pnpm sandbox gc to clear dead ones, or ask the maintainer"
  fi

  # Asked once: a codex on PATH that cannot run (a shim with nothing installed) counts as absent.
  local codex_version
  codex_version="$(codex --version 2>/dev/null | awk 'NR == 1 {print $NF}')" || codex_version=""

  umask 077
  UP_ROOT="${root}"
  # Whatever fails from here on, nothing is left running: the next up would refuse it as "already up".
  trap 'if [ $? -ne 0 ] && [ -n "${UP_ROOT}" ]; then cmd_down "${UP_ROOT}" > /dev/null 2>&1 || true; fi' EXIT
  mkdir -p "${BASE}" "${root}"/{home/.tarfa,home/.claude,home/.codex,tmux,run,projects,pwa-dist}
  chmod 700 "${root}"
  local hooks phone pwa
  hooks="$(port)"; phone="$(port)"; pwa="$(port)"
  while [ "${phone}" = "${hooks}" ]; do phone="$(port)"; done
  while [ "${pwa}" = "${hooks}" ] || [ "${pwa}" = "${phone}" ]; do pwa="$(port)"; done

  jq -n --arg slug "${slug}" --arg wt "${wt}" --arg root "${root}" \
    --argjson hooks "${hooks}" --argjson phone "${phone}" --argjson pwa "${pwa}" \
    --arg agent "tarfa-sb-${slug}-agent" --arg pwaunit "tarfa-sb-${slug}-pwa" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg codex "$([ -f "${CODEX_LOGIN}/auth.json" ] && [ -n "${codex_version}" ] && echo "tarfa-sb-${slug}-codex")" \
    '{slug: $slug, worktree: $wt, root: $root, ports: {hooks: $hooks, phone: $phone, pwa: $pwa},
      units: {agent: $agent, pwa: $pwaunit, codex: (if $codex == "" then null else $codex end)},
      browser: null, pairLink: null, createdAt: $at}' > "${root}/manifest.json"
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
  link_codex_login "${root}"
  write_env_sh "${root}"
  install_hooks "${root}"
  build_pwa "${root}"
  start_codex "${root}"
  start_agent "${root}"
  start_pwa "${root}"
  wait_agent_ready "${root}" || die "the agent did not start within ${READY_SECONDS}s (its log is above)"
  wait_pwa_ready "${root}" || die "the PWA preview did not answer within ${READY_SECONDS}s (its log is above)"
  local link
  link="$(pair_link "${root}")"
  manifest_set "${root}" '.pairLink = $l' --arg l "${link}"
  if [ -z "${TARFA_SANDBOX_NO_BROWSER:-}" ]; then browser_pair "${root}" "${link}"; fi

  echo "sandbox ${slug} is up"
  echo "  PWA       http://127.0.0.1:${pwa}/"
  echo "  pair      ${link}"
  if [ "$(jq -r .browser "${root}/manifest.json")" != null ]; then
    echo "  browser   agent-browser --session $(jq -r .browser "${root}/manifest.json") snapshot -i   (or screenshot <png>)"
  fi
  echo "  env       ${root}/env.sh   (pnpm sandbox exec -- <cmd> runs a command in it)"
  echo "  tmux      tmux -S $(sb_socket "${root}") ls"
  if [ -z "${codex_version}" ]; then
    echo "  codex     not installed or not runnable (codex --version failed): no Codex app server"
  elif [ ! -L "${root}/home/.codex/auth.json" ]; then
    echo "  codex     not logged in: once for every sandbox, mkdir -p -m 700 ${CODEX_LOGIN} && CODEX_HOME=${CODEX_LOGIN} codex login --device-auth, then pnpm sandbox down and up"
  else
    if [ "${codex_version}" = "${CODEX_TRUST_VERSION}" ]; then
      echo "  codex     ${codex_version} (hook trust made for Codex ${CODEX_TRUST_VERSION})"
    else
      echo "  codex     ${codex_version} (hook trust made for Codex ${CODEX_TRUST_VERSION}: if its hooks do not report, see docs/SANDBOX.md)"
    fi
  fi
  UP_ROOT=""
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
  local wt slug root owner
  if [ "${cmd}" = down ]; then wt="$(resolve_worktree "${wt_arg}" allow-missing)"; else wt="$(resolve_worktree "${wt_arg}")"; fi
  slug="$(sb_slug "${wt}")"; root="$(sb_root "${slug}")"
  if [ -f "${root}/manifest.json" ]; then
    owner="$(jq -r .worktree "${root}/manifest.json")"
    [ "${owner}" = "${wt}" ] || die "sandbox ${slug} belongs to ${owner}, not ${wt}"
  fi
  case "${cmd}" in rebuild | pair) take_lock "${slug}" ;; esac
  case "${cmd}" in
    up) cmd_up "${wt}"; return ;;
    down) cmd_down "${root}"; return ;;
    exec | status | rebuild | env | pair) [ -f "${root}/manifest.json" ] || die "no sandbox for ${slug}; pnpm sandbox up" ;;
    *) die "usage: sandbox.sh up|down|env|exec|status|rebuild|ls|gc [--worktree <path>] (see the header of this script)" ;;
  esac
  case "${cmd}" in
    exec) [ $# -gt 0 ] || die "usage: sandbox.sh exec -- <cmd...>"; cmd_exec "${root}" "$@" ;;
    status) cmd_status "${root}" ;;
    rebuild) cmd_rebuild "${root}" "${what}" ;;
    env) echo "${root}/env.sh" ;;
    pair) cmd_pair "${root}" ;;
  esac
}

main "$@"
