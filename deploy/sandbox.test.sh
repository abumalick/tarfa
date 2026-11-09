#!/usr/bin/env bash
# Tests for deploy/sandbox.sh. Every external tool it drives (systemd-run, systemctl, tmux, pnpm,
# claude, ab, journalctl) is a stub that logs its call, so no unit starts, no tmux server is
# reached and no browser opens. The sandbox root and the caller's HOME are scratch directories.
set -euo pipefail
for _v in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "${_v}"; done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/.." && pwd)"
mkdir -p "${REPO}/.tmp"
T="$(mktemp -d "${REPO}/.tmp/sandbox-test.XXXXXX")"
trap 'rm -rf "${T}"' EXIT

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
has() { if grep -qF -- "$1" "$2"; then echo yes; else echo no; fi; }

# The scratch HOME has no mise trust, so a mise shim would refuse: use node's real directory.
NODE_DIR="$(dirname "$(node -p process.execPath)")"
TOKEN="sk-ant-oat01-STUBTOKEN"
REALHOME="${T}/realhome"
mkdir -p "${REALHOME}/.config/tarfa-sandbox" "${T}/bin" "${T}/root"
printf '%s\n' "${TOKEN}" > "${REALHOME}/.config/tarfa-sandbox/claude-oauth-token"
CALLS="${T}/calls"
: > "${CALLS}"
: > "${T}/active"

stub() { # <name> <body>
  printf '#!/usr/bin/env bash\necho "%s $*" >> "%s"\n%s\n' "$1" "${CALLS}" "$2" > "${T}/bin/$1"
  chmod +x "${T}/bin/$1"
}
# The agent unit "starts" by writing the token the agent writes at each start, into the HOME the
# unit was given.
stub systemd-run '
home=""; agent=no
for a in "$@"; do
  case "$a" in --setenv=HOME=*) home="${a#--setenv=HOME=}";; tarfa-sb-*-agent) agent=yes;; esac
done
if [ "$agent" = yes ] && [ -n "$home" ]; then mkdir -p "$home/.tarfa"; echo t > "$home/.tarfa/token"; fi'
# is-active prints the state; like systemd, it exits non-zero for anything but active.
stub systemctl "
if [ \"\${2:-}\" = is-active ]; then
  u=\"\${!#}\"
  if grep -qxF \"\$u\" \"${T}/active\"; then echo active; exit 0; fi
  if grep -qxF \"\$u\" \"${T}/activating\" 2>/dev/null; then echo activating; exit 3; fi
  echo inactive; exit 3
fi
if [ \"\${2:-}\" = restart ]; then s=\"\${3#tarfa-sb-}\"; s=\"\${s%-agent}\"; echo t > \"${T}/root/\$s/home/.tarfa/token\"; fi"
stub tmux 'if [ "$1 ${2:-} ${3:-}" = "display-message -p #S" ]; then echo tarfa-9; fi'
stub curl ''
stub journalctl ''
# Accepting the pairing prompt enrols a device in every sandbox, as the real agent would; with
# ${T}/spend it only marks the code spent (a browser already enrolled), with ${T}/no-enrol nothing.
stub agent-browser "
echo \"  ab-env XDG_RUNTIME_DIR=\${XDG_RUNTIME_DIR:-}\" >> \"${CALLS}\"
if [ \"\$3 \${4:-}\" = 'dialog accept' ] && [ ! -e \"${T}/no-enrol\" ]; then
  for d in \"${T}\"/root/*/home/.tarfa; do
    if [ -e \"${T}/spend\" ]; then echo '[{\"secret\":\"y\",\"expiresAt\":\"x\",\"usedAt\":\"now\"}]' > \"\$d/pairing.json\"; continue; fi
    [ -f \"\$d/devices.json\" ] || echo '{\"devices\":[],\"revoked\":[]}' > \"\$d/devices.json\"
    jq '.devices += [{\"id\":\"d\"}]' \"\$d/devices.json\" > \"\$d/x\" && mv \"\$d/x\" \"\$d/devices.json\"
  done
fi"
stub claude 'echo "9.9.9 (Claude Code)"'
stub pnpm "
echo \"  env HOME=\$HOME XDG_RUNTIME_DIR=\${XDG_RUNTIME_DIR:-} TMUX=\${TMUX-unset} FLAVOR=\${TARFA_APP_FLAVOR:-} LABEL=\${TARFA_BUILD_LABEL:-}\" >> \"${CALLS}\"
case \"\$*\" in
  *'cli.ts pair'*) echo 'Open this:'; echo 'http://127.0.0.1:1/#pair?u=ws://127.0.0.1:2&k=x&s=y&n=z';;
  *'cli.ts install-hooks'*) mkdir -p \"\$HOME/.claude\"; echo '{\"hooks\":{}}' > \"\$HOME/.claude/settings.json\";;
  *build*) prev=''; for a in \"\$@\"; do [ \"\$prev\" = --outDir ] && mkdir -p \"\$a\"; prev=\"\$a\"; done;;
esac"

WT="${T}/My_Feature.Branch"
mkdir -p "${WT}/node_modules" "${WT}/packages/pwa"
git -C "${WT}" init -q

sb() { # <args...>  run sandbox.sh as a caller inside a Tarfa pane would
  env HOME="${REALHOME}" PATH="${T}/bin:${NODE_DIR}:${PATH}" TMUX="/real/server,1,0" TMUX_PANE="%1" \
    TARFA_SANDBOX_ROOT="${T}/root" TARFA_SANDBOX_NO_BROWSER=1 \
    bash "${HERE}/sandbox.sh" "$@" 2>&1
}

# The sandbox's name: the folder name's first 12 characters and a hash of its physical path.
slug_of() { printf '%s-%s' "$(basename "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | cut -c1-12)" \
  "$(printf '%s' "$(cd "$1" 2>/dev/null && pwd -P || echo "$1")" | sha1sum | cut -c1-8)"; }
SLUG="$(slug_of "${WT}")"
ROOT="${T}/root/${SLUG}"
SOCK="${ROOT}/tmux/tmux-$(id -u)/default"

echo "up"
out="$(sb up --worktree "${WT}")" || { echo "  FAIL: up exited non-zero"; echo "${out}"; fails=$((fails + 1)); }
check "creates the root" "yes" "$([ -d "${ROOT}" ] && echo yes || echo no)"
check "root is private" "700" "$(stat -c %a "${ROOT}")"
check "secrets.env is private" "600" "$(stat -c %a "${ROOT}/secrets.env")"
check "secrets.env holds the token" "CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}" "$(cat "${ROOT}/secrets.env")"
ENVF="${ROOT}/home/.tarfa/agent.env"
for line in "TARFA_MACHINE_ID=sandbox-${SLUG}" "TARFA_PROJECT_ROOTS=${ROOT}/projects" \
  "TARFA_DEFAULT_PATH=${ROOT}/projects" "TARFA_STATS=off"; do
  check "agent.env has ${line%%=*}" "yes" "$(has "${line}" "${ENVF}")"
done
M="${ROOT}/manifest.json"
HP="$(jq -r .ports.hooks "${M}")"; PP="$(jq -r .ports.phone "${M}")"; WP="$(jq -r .ports.pwa "${M}")"
check "three distinct numeric ports" "3" "$(printf '%s\n' "${HP}" "${PP}" "${WP}" | grep -E '^[0-9]+$' | sort -u | wc -l | tr -d ' ')"
check "agent.env hooks port" "yes" "$(has "TARFA_PORT=${HP}" "${ENVF}")"
check "agent.env phone port" "yes" "$(has "TARFA_PHONE_PORT=${PP}" "${ENVF}")"
check "agent.env phone address" "yes" "$(has "TARFA_PHONE_ADDRESSES=ws://127.0.0.1:${PP}" "${ENVF}")"
check "agent.env PWA origin" "yes" "$(has "TARFA_PWA_ORIGIN=http://127.0.0.1:${WP}" "${ENVF}")"
check "manifest slug" "${SLUG}" "$(jq -r .slug "${M}")"
check "manifest worktree" "$(cd "${WT}" && pwd -P)" "$(jq -r .worktree "${M}")"
check "manifest units" "tarfa-sb-${SLUG}-agent tarfa-sb-${SLUG}-pwa" "$(jq -r '.units.agent + " " + .units.pwa' "${M}")"
check "manifest pair link" "http://127.0.0.1:1/#pair?u=ws://127.0.0.1:2&k=x&s=y&n=z" "$(jq -r .pairLink "${M}")"

for p in demo-a demo-b; do
  check "${p} is a repo with one commit" "1" "$(git -C "${ROOT}/projects/${p}" rev-list --count HEAD 2>/dev/null || echo 0)"
done
CJ="${ROOT}/home/.claude.json"
check "onboarding done" "true" "$(jq -r .hasCompletedOnboarding "${CJ}")"
check "onboarding version" "9.9.9" "$(jq -r .lastOnboardingVersion "${CJ}")"
for p in "${ROOT}/projects" "${ROOT}/projects/demo-a" "${ROOT}/projects/demo-b"; do
  check "trusted ${p#"${ROOT}/"}" "true" "$(jq -r --arg p "${p}" '.projects[$p].hasTrustDialogAccepted' "${CJ}")"
done
check "settings keep the hooks" "{}" "$(jq -c .hooks "${ROOT}/home/.claude/settings.json")"
check "settings model sonnet" "sonnet" "$(jq -r .model "${ROOT}/home/.claude/settings.json")"
check "gitconfig name" "Tarfa Sandbox" "$(git config -f "${ROOT}/home/.gitconfig" user.name)"
check "gitconfig email" "sandbox@example.invalid" "$(git config -f "${ROOT}/home/.gitconfig" user.email)"
check "sandbox CLAUDE.md" "yes" "$([ -s "${ROOT}/home/CLAUDE.md" ] && echo yes || echo no)"

check "install-hooks ran under the sandbox HOME" "yes" \
  "$(grep -A1 'cli.ts install-hooks' "${CALLS}" | has "HOME=${ROOT}/home XDG_RUNTIME_DIR=${ROOT}/run TMUX=unset" /dev/stdin)"
check "pair ran under the sandbox HOME" "yes" \
  "$(grep -A1 'cli.ts pair' "${CALLS}" | has "HOME=${ROOT}/home" /dev/stdin)"
check "PWA built for the sandbox" "yes" \
  "$(grep -A1 "build --outDir ${ROOT}/pwa-dist --emptyOutDir" "${CALLS}" | has "FLAVOR=dev LABEL=sandbox-${SLUG}" /dev/stdin)"

AGENT_RUN="$(grep "^systemd-run .*tarfa-sb-${SLUG}-agent" "${CALLS}" || true)"
for want in "KillMode=process" "MemoryMax=4G" "EnvironmentFile=${ROOT}/secrets.env" "-u TMUX -u TMUX_PANE" \
  "--setenv=HOME=${ROOT}/home" "--setenv=TMUX_TMPDIR=${ROOT}/tmux" "--setenv=XDG_RUNTIME_DIR=${ROOT}/run" \
  "--setenv=TARFA_AGENT_ENV=${ENVF}" "--setenv=DBUS_SESSION_BUS_ADDRESS=" \
  "--setenv=MISE_DATA_DIR=${REALHOME}/.local/share/mise" "--setenv=MISE_CONFIG_DIR=${REALHOME}/.config/mise" \
  "--setenv=MISE_STATE_DIR=${REALHOME}/.local/state/mise" "--setenv=MISE_CACHE_DIR=${REALHOME}/.cache/mise" \
  "src/serve.ts"; do
  check "agent unit: ${want}" "yes" "$(printf '%s' "${AGENT_RUN}" | has "${want}" /dev/stdin)"
done
check "PWA unit previews the sandbox build" "yes" \
  "$(grep "^systemd-run .*tarfa-sb-${SLUG}-pwa" "${CALLS}" | has "vite preview --host 127.0.0.1 --port ${WP} --strictPort --outDir ${ROOT}/pwa-dist" /dev/stdin)"
check "PWA unit memory cap" "yes" "$(grep "^systemd-run .*tarfa-sb-${SLUG}-pwa" "${CALLS}" | has "MemoryMax=1G" /dev/stdin)"
check "no bare tmux call" "0" "$(grep '^tmux ' "${CALLS}" | grep -v '^tmux display-message -p #S$' | grep -cvF -- "-S ${SOCK}" || true)"
check "the slug is a short name and a path hash" "yes" "$(printf '%s' "${SLUG}" | grep -qE '^my-feature-b-[0-9a-f]{8}$' && echo yes || echo no)"
check "token never in an argv" "no" "$(has "${TOKEN}" "${CALLS}")"
check "token not in the manifest" "no" "$(has "${TOKEN}" "${M}")"
check "token not printed" "no" "$(printf '%s' "${out}" | has "${TOKEN}" /dev/stdin)"

echo "env"
check "env prints env.sh" "${ROOT}/env.sh" "$(sb env --worktree "${WT}")"
check "env.sh unsets TMUX and sets HOME" "unset ${ROOT}/home" \
  "$(env TMUX=x TMUX_PANE=%1 bash -c ". '${ROOT}/env.sh'; echo \"\${TMUX-unset} \${HOME}\"")"
check "env.sh gives Claude its token" "${TOKEN}" "$(env -i bash -c ". '${ROOT}/env.sh'; echo \"\${CLAUDE_CODE_OAUTH_TOKEN:-}\"")"

echo "up again"
echo "tarfa-sb-${SLUG}-agent" > "${T}/active"
set +e; out="$(sb up --worktree "${WT}")"; rc=$?; set -e
check "a live sandbox is refused" "1" "${rc}"
check "and says what to do" "yes" "$(printf '%s' "${out}" | has 'already up' /dev/stdin)"
: > "${T}/active"
: > "${CALLS}"
sb up --worktree "${WT}" > /dev/null
check "a stale sandbox is torn down first" "tmux -S ${SOCK} kill-server" "$(grep -v " is-active " "${CALLS}" | head -n 1)"
check "and comes back up" "yes" "$([ -f "${M}" ] && echo yes || echo no)"

echo "down"
: > "${CALLS}"
sb down --worktree "${WT}" > /dev/null
check "down order" "tmux -S ${SOCK} kill-server|systemctl --user stop tarfa-sb-${SLUG}-agent tarfa-sb-${SLUG}-pwa|systemctl --user reset-failed tarfa-sb-${SLUG}-agent tarfa-sb-${SLUG}-pwa" \
  "$(grep -E '^(tmux|systemctl)' "${CALLS}" | paste -sd '|')"
check "root removed" "no" "$([ -e "${ROOT}" ] && echo yes || echo no)"
set +e; sb down --worktree "${WT}" > /dev/null; rc=$?; set -e
check "down again succeeds" "0" "${rc}"

echo "refusals"
mv "${REALHOME}/.config/tarfa-sandbox/claude-oauth-token" "${T}/token.bak"
set +e; out="$(sb up --worktree "${WT}")"; rc=$?; set -e
check "no token: refused" "1" "${rc}"
check "no token: says how to make one" "yes" "$(printf '%s' "${out}" | has 'claude setup-token' /dev/stdin)"
check "no token: nothing created" "no" "$([ -e "${ROOT}" ] && echo yes || echo no)"
printf '  \n' > "${REALHOME}/.config/tarfa-sandbox/claude-oauth-token"
set +e; sb up --worktree "${WT}" > /dev/null; rc=$?; set -e
check "a blank token: refused" "1" "${rc}"
mv "${T}/token.bak" "${REALHOME}/.config/tarfa-sandbox/claude-oauth-token"
rmdir "${WT}/node_modules"
set +e; out="$(sb up --worktree "${WT}")"; rc=$?; set -e
check "no node_modules: refused" "1" "${rc}"
check "no node_modules: says pnpm install" "yes" "$(printf '%s' "${out}" | has 'pnpm install' /dev/stdin)"
check "no node_modules: nothing created" "no" "$([ -e "${ROOT}" ] && echo yes || echo no)"
mkdir "${WT}/node_modules"

echo "exec, ls, status"
sb up --worktree "${WT}" > /dev/null
check "exec runs in the sandbox env" "${ROOT}/home unset" "$(sb exec --worktree "${WT}" -- sh -c 'echo "$HOME ${TMUX-unset}"')"
set +e; sb exec --worktree "${WT}" -- sh -c 'exit 3' > /dev/null; rc=$?; set -e
check "exec passes the exit code through" "3" "${rc}"
echo "tarfa-sb-${SLUG}-agent" > "${T}/active"
check "ls shows a live sandbox" "yes" "$(sb ls | grep -qE "^${SLUG} +$(cd "${WT}" && pwd -P) +up +pwa=[0-9]+ " && echo yes || echo no)"
: > "${CALLS}"
sb status --worktree "${WT}" > "${T}/status.out" || true
check "status names the units" "yes" "$(has "tarfa-sb-${SLUG}-agent" "${T}/status.out")"
check "status lists tmux on the sandbox socket" "yes" "$(has "tmux -S ${SOCK} ls" "${CALLS}")"
check "status reads the agent journal" "yes" "$(has "journalctl --user -u tarfa-sb-${SLUG}-agent" "${CALLS}")"

echo "rebuild"
: > "${CALLS}"
sb rebuild --worktree "${WT}" --agent > /dev/null
check "rebuild --agent reinstalls the hooks in the sandbox" "yes" \
  "$(grep -A1 'cli.ts install-hooks' "${CALLS}" | has "HOME=${ROOT}/home" /dev/stdin)"
check "rebuild --agent restarts the agent unit" "yes" "$(has "systemctl --user restart tarfa-sb-${SLUG}-agent" "${CALLS}")"
check "rebuild --agent keeps the workspaces" "no" "$(grep -qE 'kill-server|systemctl --user stop' "${CALLS}" && echo yes || echo no)"
check "rebuild --agent keeps the model" "sonnet" "$(jq -r .model "${ROOT}/home/.claude/settings.json")"
: > "${CALLS}"
sb rebuild --worktree "${WT}" --pwa > /dev/null
check "rebuild --pwa rebuilds into the sandbox" "yes" "$(has "build --outDir ${ROOT}/pwa-dist --emptyOutDir" "${CALLS}")"
check "rebuild --pwa restarts nothing" "no" "$(has "systemctl --user restart" "${CALLS}")"

echo "gc"
WT2="${T}/gone-tree"; WT3="${T}/dead-agent"; WT4="${T}/old-live"
WT5="${T}/being-made"
for w in "${WT2}" "${WT3}" "${WT4}" "${WT5}"; do mkdir -p "${w}/node_modules"; git -C "${w}" init -q; sb up --worktree "${w}" > /dev/null; done
R2="${T}/root/$(slug_of "${WT2}")"; R3="${T}/root/$(slug_of "${WT3}")"; R4="${T}/root/$(slug_of "${WT4}")"; R5="${T}/root/$(slug_of "${WT5}")"
rm -rf "${WT2}"
printf '%s\n' "tarfa-sb-${SLUG}-agent" "tarfa-sb-$(basename "${R4}")-agent" > "${T}/active"
jq '.createdAt = "2000-01-01T00:00:00Z"' "${R4}/manifest.json" > "${T}/m" && mv "${T}/m" "${R4}/manifest.json"
# A sandbox whose agent is still starting, and one another command holds the lock of.
echo "tarfa-sb-$(basename "${R3}")-agent" > "${T}/activating"
bash -c 'exec 7> "$1"; flock 7; exec sleep 30' _ "${T}/root/$(basename "${R5}").lock" &
LOCKER=$!
sleep 0.3
check "ls marks a gone worktree" "yes" "$(sb ls | grep -E "^$(basename "${R2}") " | grep -qF '(gone)' && echo yes || echo no)"
sb gc > /dev/null
check "gc removes a sandbox whose worktree is gone" "no" "$([ -e "${R2}" ] && echo yes || echo no)"
check "gc keeps a sandbox whose agent is starting" "yes" "$([ -e "${R3}" ] && echo yes || echo no)"
check "gc keeps a sandbox another command holds" "yes" "$([ -e "${R5}" ] && echo yes || echo no)"
check "gc keeps a live old sandbox" "yes" "$([ -e "${R4}" ] && echo yes || echo no)"
kill "${LOCKER}" 2>/dev/null; wait "${LOCKER}" 2>/dev/null || true
: > "${T}/activating"
sb gc > /dev/null
check "gc removes a sandbox whose agent is down" "no" "$([ -e "${R3}" ] && echo yes || echo no)"
check "and the one no command holds any more" "no" "$([ -e "${R5}" ] && echo yes || echo no)"
check "gc keeps a live fresh sandbox" "yes" "$([ -e "${ROOT}" ] && echo yes || echo no)"
sb gc --older-than-hours 24 > /dev/null
check "gc --older-than-hours takes the old one" "no" "$([ -e "${R4}" ] && echo yes || echo no)"
check "and keeps the fresh one" "yes" "$([ -e "${ROOT}" ] && echo yes || echo no)"
: > "${T}/active"
sb down --worktree "${WT}" > /dev/null

echo "no sandbox"
for c in exec status rebuild env; do
  set +e; out="$(sb "${c}" --worktree "${WT}" -- true)"; rc=$?; set -e
  check "${c} without a sandbox exits 1" "1" "${rc}"
  check "${c} without a sandbox says so" "yes" "$(printf '%s' "${out}" | has "no sandbox for ${SLUG}; pnpm sandbox up" /dev/stdin)"
done

echo "browser"
sbb() { # like sb, with the browser step on
  env HOME="${REALHOME}" PATH="${T}/bin:${NODE_DIR}:${PATH}" TMUX="/real/server,1,0" TMUX_PANE="%1" \
    XDG_RUNTIME_DIR="/run/user/caller" TARFA_SANDBOX_ROOT="${T}/root" TARFA_SANDBOX_READY_SECONDS=1 \
    bash "${HERE}/sandbox.sh" "$@" 2>&1
}
: > "${CALLS}"
sbb up --worktree "${WT}" > /dev/null
LINK="$(jq -r .pairLink "${M}")"
SESSION="tarfa-9__sb-${SLUG}"
check "up pairs the browser in order" \
  "agent-browser --session ${SESSION} set viewport 412 900|agent-browser --session ${SESSION} open ${LINK}|agent-browser --session ${SESSION} dialog accept|agent-browser --session ${SESSION} wait --text No workspaces yet" \
  "$(grep '^agent-browser ' "${CALLS}" | paste -sd '|')"
check "up waits for the PWA before pairing" "yes" "$(has "curl -sf -o /dev/null http://127.0.0.1:$(jq -r .ports.pwa "${M}")/" "${CALLS}")"
check "the manifest names the session" "${SESSION}" "$(jq -r .browser "${M}")"
check "the device is enrolled" "1" "$(jq '.devices | length' "${ROOT}/home/.tarfa/devices.json")"
check "agent-browser runs in the caller's runtime dir" "0" "$(grep '^  ab-env' "${CALLS}" | grep -cv 'XDG_RUNTIME_DIR=/run/user/caller' || true)"
: > "${CALLS}"
sbb pair --worktree "${WT}" > /dev/null
check "pair mints a new link" "yes" "$(has 'cli.ts pair' "${CALLS}")"
check "pair opens it and accepts" "yes" "$(grep '^agent-browser ' "${CALLS}" | paste -sd '|' | grep -qF "open http://127.0.0.1:1/#pair?u=ws://127.0.0.1:2&k=x&s=y&n=z|agent-browser --session ${SESSION} dialog accept" && echo yes || echo no)"
check "pair waits for a second device" "2" "$(jq '.devices | length' "${ROOT}/home/.tarfa/devices.json")"
touch "${T}/spend"
set +e; sbb pair --worktree "${WT}" > /dev/null; rc=$?; set -e
check "pair on an enrolled browser succeeds once the code is spent" "0" "${rc}"
rm -f "${T}/spend"
: > "${CALLS}"
sbb rebuild --worktree "${WT}" --pwa > /dev/null
PWAP="$(jq -r .ports.pwa "${M}")"
check "rebuild --pwa reloads the browser" "yes" "$(has "agent-browser --session ${SESSION} open http://127.0.0.1:${PWAP}/" "${CALLS}")"
check "and taps the update banner" "yes" "$(grep -q '^agent-browser .* eval .*Reload' "${CALLS}" && echo yes || echo no)"
: > "${CALLS}"
sbb down --worktree "${WT}" > /dev/null
check "down closes the browser" "yes" "$(has "agent-browser --session ${SESSION} close" "${CALLS}")"

echo "failures leave nothing running"
touch "${T}/no-enrol"
: > "${CALLS}"
set +e; out="$(sbb up --worktree "${WT}")"; rc=$?; set -e
check "a failed pairing fails up" "1" "${rc}"
check "and takes the sandbox down" "no" "$([ -e "${ROOT}" ] && echo yes || echo no)"
check "and stops its units" "yes" "$(has "systemctl --user stop tarfa-sb-${SLUG}-agent tarfa-sb-${SLUG}-pwa" "${CALLS}")"
check "and keeps a screenshot" "yes" "$(has "screenshot ${T}/root/${SLUG}-pair-failed.png" "${CALLS}")"
rm -f "${T}/no-enrol"
mv "${T}/bin/agent-browser" "${T}/agent-browser.bak"
: > "${CALLS}"
set +e; out="$(env HOME="${REALHOME}" PATH="${T}/bin:${NODE_DIR}:/usr/bin:/bin" TARFA_SANDBOX_ROOT="${T}/root" bash "${HERE}/sandbox.sh" up --worktree "${WT}" 2>&1)"; rc=$?; set -e
check "no agent-browser: refused" "1" "${rc}"
check "no agent-browser: says how to skip the browser" "yes" "$(printf '%s' "${out}" | has 'TARFA_SANDBOX_NO_BROWSER=1' /dev/stdin)"
check "no agent-browser: nothing started" "no" "$(has 'systemd-run' "${CALLS}")"
mv "${T}/agent-browser.bak" "${T}/bin/agent-browser"
sb up --worktree "${WT}" > /dev/null
set +e; out="$(sb rebuild --worktree "${WT}" --agent)"; rc=$?; set -e
check "rebuild with the agent down is refused" "1" "${rc}"
check "and points at up" "yes" "$(printf '%s' "${out}" | has 'pnpm sandbox up' /dev/stdin)"
sb down --worktree "${WT}" > /dev/null

echo "one sandbox per worktree"
TWIN_A="${T}/one/tarfa"; TWIN_B="${T}/two/tarfa"
for w in "${TWIN_A}" "${TWIN_B}"; do mkdir -p "${w}/node_modules"; git -C "${w}" init -q; sb up --worktree "${w}" > /dev/null; done
check "same folder name, two sandboxes" "2" "$(find "${T}/root" -maxdepth 1 -name 'tarfa-*' -type d | wc -l | tr -d ' ')"
jq --arg w "${TWIN_B}" '.worktree = $w' "${T}/root/$(slug_of "${TWIN_A}")/manifest.json" > "${T}/m" && mv "${T}/m" "${T}/root/$(slug_of "${TWIN_A}")/manifest.json"
set +e; out="$(sb status --worktree "${TWIN_A}")"; rc=$?; set -e
check "a sandbox naming another worktree is refused" "1" "${rc}"
check "and says whose it is" "yes" "$(printf '%s' "${out}" | has "belongs to ${TWIN_B}" /dev/stdin)"

echo "down after the worktree is gone"
GONE="${T}/removed-tree"
mkdir -p "${GONE}/node_modules"; git -C "${GONE}" init -q
GONE_PHYS="$(cd "${GONE}" && pwd -P)"; GONE_ROOT="${T}/root/$(slug_of "${GONE}")"
sb up --worktree "${GONE}" > /dev/null
rm -rf "${GONE}"
set +e; sb down --worktree "${GONE_PHYS}" > /dev/null; rc=$?; set -e
check "down by the path of a removed worktree" "0" "${rc}"
check "removes its sandbox" "no" "$([ -e "${GONE_ROOT}" ] && echo yes || echo no)"

if [ "${fails}" -gt 0 ]; then
  echo "${fails} check(s) failed"
  exit 1
fi
echo "all sandbox checks passed"
