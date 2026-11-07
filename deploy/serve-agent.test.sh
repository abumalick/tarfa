#!/usr/bin/env bash
# Tests for deploy/serve-agent.sh. It runs from a scratch git repo and a scratch HOME with a stub
# systemctl, so no real service is restarted and no real symlink or agent-source is touched.
set -euo pipefail
# A git hook exports GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE and more, which would send the scratch
# repo's git calls (init writes core.bare) to the real repository: strip every GIT_* variable first.
for _v in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "${_v}"; done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/.." && pwd)"
mkdir -p "${REPO}/.tmp"
SANDBOX="$(mktemp -d "${REPO}/.tmp/serve-agent-test.XXXXXX")"
trap 'rm -rf "${SANDBOX}"' EXIT

fails=0
check() {
  if [ "$2" = "$3" ]; then
    echo "  ok: $1"
  else
    echo "  FAIL: $1"
    echo "    expected: $2"
    echo "    actual:   $3"
    fails=$((fails + 1))
  fi
}

MAIN="${SANDBOX}/main"
mkdir -p "${MAIN}/deploy"
git -C "${MAIN}" init -q
cp "${HERE}/serve-agent.sh" "${MAIN}/deploy/serve-agent.sh"
WT="${SANDBOX}/worktree"
mkdir -p "${WT}"
MAIN_REAL="$(cd "${MAIN}" && pwd -P)"
WT_REAL="$(cd "${WT}" && pwd -P)"

mkdir -p "${SANDBOX}/bin"
printf '#!/bin/sh\necho "systemctl $*" >> "%s"\n' "${SANDBOX}/calls" > "${SANDBOX}/bin/systemctl"
chmod +x "${SANDBOX}/bin/systemctl"

serve() { # <home> <args...>
  local home="$1"; shift
  (cd "${MAIN}" && env HOME="${home}" PATH="${SANDBOX}/bin:/usr/bin:/bin" bash deploy/serve-agent.sh "$@" 2>&1)
}
unit() { # <home> <ExecStart>
  mkdir -p "$1/.config/systemd/user"
  printf '[Service]\nExecStart=%s\nKillMode=process\n' "$2" > "$1/.config/systemd/user/tarfa-agent.service"
}

echo "a unit that runs the launcher"
H1="${SANDBOX}/h1"
unit "${H1}" "${H1}/.tarfa/bin/tarfa-agent"
: > "${SANDBOX}/calls"
serve "${H1}" "${WT}" > /dev/null
check "writes the worktree to agent-source" "${WT_REAL}" "$(cat "${H1}/.tarfa/agent-source")"
check "keeps agent-source private" "600" "$(stat -c %a "${H1}/.tarfa/agent-source" 2>/dev/null || stat -f %Lp "${H1}/.tarfa/agent-source")"
check "does not touch deploy/agent-live" "absent" "$([ -e "${MAIN}/deploy/agent-live" ] || [ -L "${MAIN}/deploy/agent-live" ] && echo present || echo absent)"
check "restarts the service" "systemctl --user restart tarfa-agent" "$(cat "${SANDBOX}/calls")"

: > "${SANDBOX}/calls"
serve "${H1}" . > /dev/null
check "'.' from main runs unreleased main" "${MAIN_REAL}" "$(cat "${H1}/.tarfa/agent-source")"

serve "${H1}" --restore > /dev/null
check "--restore removes agent-source" "absent" "$([ -e "${H1}/.tarfa/agent-source" ] && echo present || echo absent)"

: > "${SANDBOX}/calls"
out="$(serve "${H1}" --heal)"
check "--heal with no agent-source does nothing" "agent-source is healthy; nothing to heal." "${out}"
check "and restarts nothing" "" "$(cat "${SANDBOX}/calls")"
printf '%s\n' "${WT_REAL}" > "${H1}/.tarfa/agent-source"
serve "${H1}" --heal > /dev/null
check "--heal keeps agent-source when its path exists" "${WT_REAL}" "$(cat "${H1}/.tarfa/agent-source")"
printf '%s\n' "${SANDBOX}/gone" > "${H1}/.tarfa/agent-source"
: > "${SANDBOX}/calls"
serve "${H1}" --heal > /dev/null
check "--heal removes it when the path is gone" "absent" "$([ -e "${H1}/.tarfa/agent-source" ] && echo present || echo absent)"
check "and restarts" "systemctl --user restart tarfa-agent" "$(cat "${SANDBOX}/calls")"

echo "TARFA_SKIP_RESTART"
: > "${SANDBOX}/calls"
(cd "${MAIN}" && env HOME="${H1}" PATH="${SANDBOX}/bin:/usr/bin:/bin" TARFA_SKIP_RESTART=1 bash deploy/serve-agent.sh "${WT}" > /dev/null)
check "switches without restarting" "${WT_REAL}|" "$(cat "${H1}/.tarfa/agent-source")|$(cat "${SANDBOX}/calls")"

echo "a unit that runs a checkout"
H2="${SANDBOX}/h2"
unit "${H2}" "/usr/bin/env bash ${MAIN}/deploy/run-agent.sh"
serve "${H2}" "${WT}" > /dev/null
check "flips deploy/agent-live as before" "${WT_REAL}" "$(readlink "${MAIN}/deploy/agent-live")"
check "and writes no agent-source" "absent" "$([ -e "${H2}/.tarfa/agent-source" ] && echo present || echo absent)"
serve "${H2}" --restore > /dev/null
check "--restore points agent-live back at main" "${MAIN_REAL}" "$(readlink "${MAIN}/deploy/agent-live")"

if [ "${fails}" -gt 0 ]; then
  echo "${fails} check(s) failed"
  exit 1
fi
echo "all serve-agent checks passed"
