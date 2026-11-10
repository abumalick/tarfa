#!/usr/bin/env bash
# End-to-end check of deploy/sandbox.sh against the real thing: two sandboxes at once, a
# workspace created from the PWA in a headless browser, systemd scopes under the sandbox's
# runtime dir, and nothing reaching the real agent. Opt-in (it starts units, Chrome and, with
# TARFA_SANDBOX_LIVE_CLAUDE=1, a Sonnet session; with TARFA_SANDBOX_LIVE_CODEX=1, Codex sessions
# on the sandbox login); not part of the gate.
#
#   TARFA_SANDBOX_LIVE=1 [TARFA_SANDBOX_LIVE_CLAUDE=1] [TARFA_SANDBOX_LIVE_CODEX=1] bash deploy/sandbox.live.test.sh
set -euo pipefail
if [ -z "${TARFA_SANDBOX_LIVE:-}" ]; then echo "sandbox live test skipped (set TARFA_SANDBOX_LIVE=1)"; exit 0; fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
A_WT="$(cd "${HERE}/.." && pwd -P)"
SB="${HERE}/sandbox.sh"
B_WT="${A_WT}/.tmp/sandbox-live-b"
BASE="${TARFA_SANDBOX_ROOT:-${HOME}/.cache/tsb}"

fails=0
check() {
  if [ "$2" = "$3" ]; then echo "  ok: $1"; else
    echo "  FAIL: $1"; echo "    expected: $2"; echo "    actual:   $3"; fails=$((fails + 1)); fi
}
cleanup() {
  "${SB}" down --worktree "${A_WT}" > /dev/null 2>&1 || true
  [ -d "${B_WT}" ] && "${SB}" down --worktree "${B_WT}" > /dev/null 2>&1 || true
  git -C "${A_WT}" worktree remove --force "${B_WT}" > /dev/null 2>&1 || true
  git -C "${A_WT}" branch -D sandbox-live-b > /dev/null 2>&1 || true
}
if "${SB}" env --worktree "${A_WT}" > /dev/null 2>&1; then
  echo "this worktree has a sandbox up; the live test would replace it: pnpm sandbox down first" >&2
  exit 1
fi
trap cleanup EXIT
cleanup

root_of() { echo "${BASE}/$(jq -r .slug <<< "$(cat "${BASE}"/*/manifest.json | jq -s --arg w "$1" '.[] | select(.worktree == $w)')")"; }
sock() { echo "$1/tmux/tmux-$(id -u)/default"; }
in_sb() { local wt="$1"; shift; (cd "${wt}" && "${SB}" exec --worktree "${wt}" -- "$@"); }
ab_in() { local root="$1"; shift; agent-browser --session "$(jq -r .browser "${root}/manifest.json")" "$@"; }
ref() { ab_in "$1" snapshot -i | grep -F -- "$2" | grep -oE 'ref=e[0-9]+' | head -n 1 | sed 's/ref=/@/'; }

REAL_LOG="${HOME}/.tarfa/workspace-log.jsonl"
real_log_lines="$(wc -l < "${REAL_LOG}" 2>/dev/null || echo 0)"

echo "two sandboxes"
git -C "${A_WT}" worktree add -q "${B_WT}" -b sandbox-live-b HEAD
(cd "${B_WT}" && mise trust -q > /dev/null 2>&1; pnpm install --frozen-lockfile --offline > /dev/null 2>&1 || pnpm install --frozen-lockfile > /dev/null)
"${SB}" up --worktree "${A_WT}" > /dev/null
"${SB}" up --worktree "${B_WT}" > /dev/null
A="$(root_of "${A_WT}")"; B="$(root_of "${B_WT}")"
OURS="tarfa-sb-($(basename "${A}")|$(basename "${B}"))-"
check "both are paired" "1 1" "$(jq '.devices | length' "${A}/home/.tarfa/devices.json") $(jq '.devices | length' "${B}/home/.tarfa/devices.json")"
check "distinct ports" "6" "$(jq -r '.ports[]' "${A}/manifest.json" "${B}/manifest.json" | sort -u | wc -l | tr -d ' ')"

echo "a Bash workspace from the PWA"
ab_in "${A}" click "$(ref "${A}" 'button "New"')" > /dev/null
ab_in "${A}" fill "$(ref "${A}" 'textbox "Path')" demo-a > /dev/null
ab_in "${A}" click "$(ref "${A}" 'radio "Bash"')" > /dev/null
ab_in "${A}" click "$(ref "${A}" 'button "Create"')" > /dev/null
for _ in $(seq 1 50); do in_sb "${A_WT}" pnpm -s tarfa ls 2>/dev/null | grep -q 'demo-a-1' && break; sleep 0.2; done
check "A's tarfa ls lists it" "yes" "$(in_sb "${A_WT}" pnpm -s tarfa ls 2>/dev/null | grep -q 'demo-a-1' && echo yes || echo no)"
check "B's tarfa ls does not" "no" "$(in_sb "${B_WT}" pnpm -s tarfa ls 2>/dev/null | grep -q 'demo-a' && echo yes || echo no)"
check "B's PWA still shows an empty list" "yes" "$(ab_in "${B}" wait --text 'No workspaces yet' --timeout 5000 > /dev/null 2>&1 && echo yes || echo no)"

echo "systemd under the sandbox runtime dir"
PANE_PID="$(tmux -S "$(sock "${A}")" list-panes -t '=demo-a-1:' -F '#{pane_pid}')"
SCOPE="$(grep -oE 'tmux-spawn-[0-9a-f-]+\.scope' "/proc/${PANE_PID}/cgroup" | head -n 1 || true)"
check "the pane is in a tmux-spawn scope" "yes" "$([ -n "${SCOPE}" ] && echo yes || echo no)"
OUT="${A}/is-active.out"
tmux -S "$(sock "${A}")" send-keys -t '=demo-a-1:' "systemctl --user is-active $(jq -r .units.agent "${A}/manifest.json") > ${OUT} 2>&1"
tmux -S "$(sock "${A}")" send-keys -t '=demo-a-1:' Enter
for _ in $(seq 1 25); do [ -s "${OUT}" ] && break; sleep 0.2; done
check "systemctl --user works inside a pane" "active" "$(cat "${OUT}" 2>/dev/null)"
in_sb "${A_WT}" pnpm -s tarfa close demo-a-1 > /dev/null
for _ in $(seq 1 25); do systemctl --user is-active --quiet "${SCOPE}" || break; sleep 0.2; done
check "closing the workspace reaps its scope" "no" "$(systemctl --user is-active --quiet "${SCOPE}" && echo yes || echo no)"

if [ -n "${TARFA_SANDBOX_LIVE_CLAUDE:-}" ]; then
  echo "a Sonnet Claude workspace"
  ab_in "${A}" open "http://127.0.0.1:$(jq -r .ports.pwa "${A}/manifest.json")/" > /dev/null
  ab_in "${A}" click "$(ref "${A}" 'button "New"')" > /dev/null
  ab_in "${A}" fill "$(ref "${A}" 'textbox "Path')" demo-b > /dev/null
  ab_in "${A}" click "$(ref "${A}" 'radio "Sonnet"')" > /dev/null
  ab_in "${A}" click "$(ref "${A}" 'button "Create"')" > /dev/null
  for _ in $(seq 1 100); do
    tmux -S "$(sock "${A}")" capture-pane -p -t '=demo-b-1:' 2>/dev/null | grep -q '❯' && break; sleep 0.2
  done
  tmux -S "$(sock "${A}")" send-keys -t '=demo-b-1:' 'Reply with just: ok'
  sleep 0.5
  tmux -S "$(sock "${A}")" send-keys -t '=demo-b-1:' Enter
  status=""
  for _ in $(seq 1 90); do
    status="$(jq -r '."demo-b-1".status // ""' "${A}/home/.tarfa/status.json" 2>/dev/null)"
    [ "${status}" = needs-feedback ] && break; sleep 1
  done
  check "hooks report the turn's end" "needs-feedback" "${status}"
fi

if [ -n "${TARFA_SANDBOX_LIVE_CODEX:-}" ]; then
  # A Codex Stop hook that reached the sandbox's agent proves the hooks were trusted by up.
  codex_stops() { jq -r --arg w "$1" 'select(.workspace == $w and .event == "Stop" and .agent == "codex") | .event' \
    "${A}/home/.tarfa/hook-events.jsonl" 2>/dev/null | wc -l | tr -d ' '; }
  wait_stops() { # <workspace> <count>
    for _ in $(seq 1 120); do [ "$(codex_stops "$1")" -ge "$2" ] && return 0; sleep 1; done; return 1; }

  echo "a Codex workspace from the PWA"
  check "the sandbox login is linked" "yes" "$([ -L "${A}/home/.codex/auth.json" ] && echo yes || echo no)"
  # Deterministic, unlike the real file's mtime, which the user's own Codex may change mid-run.
  check "and it is not your own login" "no" "$([ "$(readlink -f "${A}/home/.codex/auth.json")" = "$(readlink -f "${HOME}/.codex/auth.json")" ] && echo yes || echo no)"
  ab_in "${A}" open "http://127.0.0.1:$(jq -r .ports.pwa "${A}/manifest.json")/" > /dev/null
  ab_in "${A}" click "$(ref "${A}" 'button "New"')" > /dev/null
  ab_in "${A}" fill "$(ref "${A}" 'textbox "Path')" demo-a > /dev/null
  ab_in "${A}" click "$(ref "${A}" 'radio "Codex"')" > /dev/null
  ab_in "${A}" click "$(ref "${A}" 'button "Create"')" > /dev/null
  for _ in $(seq 1 100); do
    tmux -S "$(sock "${A}")" capture-pane -p -t '=demo-a-1:' 2>/dev/null | grep -q 'Ask Codex' && break; sleep 0.2
  done
  tmux -S "$(sock "${A}")" send-keys -t '=demo-a-1:' 'Reply with just: ok'
  sleep 0.5
  tmux -S "$(sock "${A}")" send-keys -t '=demo-a-1:' Enter
  check "its hooks report the turn's end" "yes" "$(wait_stops demo-a-1 1 && echo yes || echo no)"

  echo "tarfa spawn --cli codex and tarfa send"
  before="$(tmux -S "$(sock "${A}")" ls -F '#S' | sort)"
  echo 'Reply with just: spawned' | in_sb "${A_WT}" pnpm -s tarfa spawn --cli codex "${A}/projects/demo-b" > /dev/null 2>&1 || true
  CX="$(comm -13 <(echo "${before}") <(tmux -S "$(sock "${A}")" ls -F '#S' | sort) | head -n 1)"
  check "spawn made a workspace" "yes" "$([ -n "${CX}" ] && echo yes || echo no)"
  check "its first turn reports" "yes" "$([ -n "${CX}" ] && wait_stops "${CX}" 1 && echo yes || echo no)"
  # tarfa send names its sender by pane, so it runs in a Bash workspace, from a script: a long
  # line typed into a narrow pane does not arrive whole.
  before="$(tmux -S "$(sock "${A}")" ls -F '#S' | sort)"
  ab_in "${A}" open "http://127.0.0.1:$(jq -r .ports.pwa "${A}/manifest.json")/" > /dev/null
  ab_in "${A}" click "$(ref "${A}" 'button "New"')" > /dev/null
  ab_in "${A}" fill "$(ref "${A}" 'textbox "Path')" demo-a > /dev/null
  ab_in "${A}" click "$(ref "${A}" 'radio "Bash"')" > /dev/null
  ab_in "${A}" click "$(ref "${A}" 'button "Create"')" > /dev/null
  SENDER=""
  for _ in $(seq 1 50); do
    SENDER="$(comm -13 <(echo "${before}") <(tmux -S "$(sock "${A}")" ls -F '#S' | sort) | head -n 1)"
    [ -n "${SENDER}" ] && break; sleep 0.2
  done
  printf 'cd %q && pnpm -s tarfa send %q %q\n' "${A_WT}" "${CX}" 'Reply with just: received' > "${A}/send.sh"
  sleep 1
  tmux -S "$(sock "${A}")" send-keys -t "=${SENDER}:" "bash ${A}/send.sh > ${A}/send.out 2>&1"
  tmux -S "$(sock "${A}")" send-keys -t "=${SENDER}:" Enter
  check "tarfa send reaches it" "yes" "$([ -n "${CX}" ] && wait_stops "${CX}" 2 && echo yes || echo no)"
  check "the login is still a link" "yes" "$([ -L "${A}/home/.codex/auth.json" ] && echo yes || echo no)"
fi

echo "nothing reached the real machine"
check "the real workspace log is unchanged" "${real_log_lines}" "$(wc -l < "${REAL_LOG}" 2>/dev/null || echo 0)"
check "the real tarfa ls has no sandbox workspace" "no" "$(pnpm -s tarfa ls 2>/dev/null | grep -qF "${BASE}" && echo yes || echo no)"

echo "down"
"${SB}" down --worktree "${A_WT}" > /dev/null
"${SB}" down --worktree "${B_WT}" > /dev/null
# A stopped transient unit stays listed for a moment before systemd collects it.
ours() { systemctl --user list-units 'tarfa-sb-*' --all --no-legend | grep -cE "${OURS}" || true; }
for _ in $(seq 1 25); do [ "$(ours)" -eq 0 ] && break; sleep 0.2; done
check "no unit of either sandbox left" "0" "$(ours)"
check "no sandbox process left" "0" "$(pgrep -f "${A}|${B}" | wc -l | tr -d ' ')"

if [ "${fails}" -gt 0 ]; then echo "${fails} check(s) failed"; exit 1; fi
echo "all live sandbox checks passed"
