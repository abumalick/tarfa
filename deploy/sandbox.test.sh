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
stub systemctl "if [ \"\${2:-}\" = is-active ]; then grep -qxF \"\${4:-}\" \"${T}/active\"; exit; fi"
stub tmux ''
stub journalctl ''
stub ab ''
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

SLUG="my-feature-branch"
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
check "no bare tmux call" "0" "$(grep '^tmux ' "${CALLS}" | grep -cvF -- "-S ${SOCK}" || true)"
check "token never in an argv" "no" "$(has "${TOKEN}" "${CALLS}")"
check "token not in the manifest" "no" "$(has "${TOKEN}" "${M}")"
check "token not printed" "no" "$(printf '%s' "${out}" | has "${TOKEN}" /dev/stdin)"

echo "env"
check "env prints env.sh" "${ROOT}/env.sh" "$(sb env --worktree "${WT}")"
check "env.sh unsets TMUX and sets HOME" "unset ${ROOT}/home" \
  "$(env TMUX=x TMUX_PANE=%1 bash -c ". '${ROOT}/env.sh'; echo \"\${TMUX-unset} \${HOME}\"")"

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
check "no token: names the Bitwarden item" "yes" "$(printf '%s' "${out}" | has 'Tarfa sandbox - Claude Code OAuth token' /dev/stdin)"
check "no token: nothing created" "no" "$([ -e "${ROOT}" ] && echo yes || echo no)"
mv "${T}/token.bak" "${REALHOME}/.config/tarfa-sandbox/claude-oauth-token"
rmdir "${WT}/node_modules"
set +e; out="$(sb up --worktree "${WT}")"; rc=$?; set -e
check "no node_modules: refused" "1" "${rc}"
check "no node_modules: says pnpm install" "yes" "$(printf '%s' "${out}" | has 'pnpm install' /dev/stdin)"
check "no node_modules: nothing created" "no" "$([ -e "${ROOT}" ] && echo yes || echo no)"
mkdir "${WT}/node_modules"

if [ "${fails}" -gt 0 ]; then
  echo "${fails} check(s) failed"
  exit 1
fi
echo "all sandbox checks passed"
