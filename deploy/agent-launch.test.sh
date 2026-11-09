#!/usr/bin/env bash
# Tests for the agent service's launcher (packages/agent/templates/tarfa-agent.sh) and for how
# deploy/run-agent.sh yields to it. Everything runs under a scratch HOME with a stub mise, so no
# real agent starts and nothing outside the sandbox is read or written.
set -euo pipefail
# Nothing here runs git, but the scripts under test may not: keep a hook's GIT_* out of them.
for _v in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "${_v}"; done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/.." && pwd)"
LAUNCHER="${REPO}/packages/agent/templates/tarfa-agent.sh"
mkdir -p "${REPO}/.tmp"
SANDBOX="$(mktemp -d "${REPO}/.tmp/agent-launch-test.XXXXXX")"
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

new_home() {
  local home="${SANDBOX}/$1"
  mkdir -p "${home}/.tarfa" "${home}/.local/bin"
  printf 'TARFA_TOKEN=from-state-env\n' > "${home}/.tarfa/agent.env"
  chmod 600 "${home}/.tarfa/agent.env"
  cat > "${home}/.local/bin/mise" <<'STUB'
#!/bin/sh
case "$*" in
  *" where "*)
    for last in "$@"; do :; done
    case "$last" in
      node) cat "$(dirname "$0")/../../where-node" 2>/dev/null || exit 1 ;;
      *) cat "$(dirname "$0")/../../where-cli" 2>/dev/null || exit 1 ;;
    esac
    exit 0 ;;
esac
echo "mise $* | env=${TARFA_AGENT_ENV:-} | token=${TARFA_TOKEN:-} | pwd=$(pwd -P)"
STUB
  chmod +x "${home}/.local/bin/mise"
  echo "${home}"
}

launch() { # <home> -> stdout+stderr of the launcher, run from a directory holding a mise.toml
  mkdir -p "${SANDBOX}/project"
  printf '[tools]\nnode = "1"\n' > "${SANDBOX}/project/mise.toml"
  (cd "${SANDBOX}/project" && env -i HOME="$1" PATH=/usr/bin:/bin sh "${LAUNCHER}" 2>&1) || echo "exit=$?"
}

echo "launcher"
HOME1="$(new_home h1)"
HOME1_REAL="$(cd "${HOME1}" && pwd -P)"
check "runs the released agent through mise, from \$HOME, with agent.env sourced and named" \
  "mise exec -- tarfa serve | env=${HOME1}/.tarfa/agent.env | token=from-state-env | pwd=${HOME1_REAL}" "$(launch "${HOME1}")"

CHECKOUT="${SANDBOX}/checkout"
mkdir -p "${CHECKOUT}/deploy"
cp "${HERE}/run-agent.sh" "${CHECKOUT}/deploy/run-agent.sh"
printf '%s\n' "${CHECKOUT}" > "${HOME1}/.tarfa/agent-source"
CHECKOUT_REAL="$(cd "${CHECKOUT}" && pwd -P)"
check "runs the checkout named by agent-source, which has no deploy/agent.env of its own" \
  "mise exec -- pnpm --filter @tarfa/cli exec tsx src/serve.ts | env=${HOME1}/.tarfa/agent.env | token=from-state-env | pwd=${CHECKOUT_REAL}" "$(launch "${HOME1}")"

printf '%s' "${SANDBOX}/removed-worktree" > "${HOME1}/.tarfa/agent-source"
out="$(launch "${HOME1}")"
check "falls through to the release, with one line on stderr, when agent-source names a missing path" \
  "tarfa-agent: ${HOME1}/.tarfa/agent-source names ${SANDBOX}/removed-worktree, which has no deploy/run-agent.sh; running the released agent
mise exec -- tarfa serve | env=${HOME1}/.tarfa/agent.env | token=from-state-env | pwd=${HOME1_REAL}" "${out}"

: > "${HOME1}/.tarfa/agent-source"
check "an empty agent-source is no checkout" "mise exec -- tarfa serve | env=${HOME1}/.tarfa/agent.env | token=from-state-env | pwd=${HOME1_REAL}" "$(launch "${HOME1}" | tail -1)"

# A stub mise that answers `where`, so the launcher can run the package with node directly.
HOME5="$(new_home h5)"
mkdir -p "${HOME5}/cli/bin" "${HOME5}/node/bin"
touch "${HOME5}/cli/bin/tarfa"
printf '%s\n' "${HOME5}/cli" > "${HOME5}/where-cli"
printf '%s\n' "${HOME5}/node" > "${HOME5}/where-node"
printf '#!/bin/sh\necho "node $* | env=${TARFA_AGENT_ENV:-} | path=$PATH | pwd=$(pwd -P)"\n' > "${HOME5}/node/bin/node"
chmod +x "${HOME5}/node/bin/node"
HOME5_REAL="$(cd "${HOME5}" && pwd -P)"
check "runs the installed package with its node, no mise exec, ~/.local/bin then shims on PATH, from \$HOME" \
  "node ${HOME5}/cli/bin/tarfa serve | env=${HOME5}/.tarfa/agent.env | path=${HOME5}/.local/bin:${HOME5}/.local/share/mise/shims:/usr/bin:/bin | pwd=${HOME5_REAL}" "$(launch "${HOME5}")"
out="$(cd "${SANDBOX}" && env -i HOME="${HOME5}" MISE_DATA_DIR="${HOME5}/data" PATH=/usr/bin:/bin sh "${LAUNCHER}" 2>&1)"
check "puts MISE_DATA_DIR's shims on PATH when it is set, after ~/.local/bin" \
  "node ${HOME5}/cli/bin/tarfa serve | env=${HOME5}/.tarfa/agent.env | path=${HOME5}/.local/bin:${HOME5}/data/shims:/usr/bin:/bin | pwd=${HOME5_REAL}" "${out}"
rm "${HOME5}/where-node"
check "falls back to mise exec when where names no node" \
  "mise exec -- tarfa serve | env=${HOME5}/.tarfa/agent.env | token=from-state-env | pwd=${HOME5_REAL}" "$(launch "${HOME5}")"
printf '%s\n' "${HOME5}/node" > "${HOME5}/where-node"
rm "${HOME5}/cli/bin/tarfa"
check "falls back to mise exec when the install has neither layout's entry" \
  "mise exec -- tarfa serve | env=${HOME5}/.tarfa/agent.env | token=from-state-env | pwd=${HOME5_REAL}" "$(launch "${HOME5}")"

# Laid out by aube (a newer mise's npm backend): no bin/, a shell script in node_modules/.bin, and
# the package's own entry under node_modules/@tarfa/cli.
mkdir -p "${HOME5}/cli/node_modules/.bin" "${HOME5}/cli/node_modules/@tarfa/cli/dist"
printf '#!/bin/sh\n' > "${HOME5}/cli/node_modules/.bin/tarfa"
touch "${HOME5}/cli/node_modules/@tarfa/cli/dist/cli.js"
check "runs the package's entry with its node where aube laid the install out" \
  "node ${HOME5}/cli/node_modules/@tarfa/cli/dist/cli.js serve | env=${HOME5}/.tarfa/agent.env | path=${HOME5}/.local/bin:${HOME5}/.local/share/mise/shims:/usr/bin:/bin | pwd=${HOME5_REAL}" "$(launch "${HOME5}")"
mkdir -p "${HOME5}/cli/bin"
touch "${HOME5}/cli/bin/tarfa"
check "prefers bin/tarfa when an install has both" \
  "node ${HOME5}/cli/bin/tarfa serve | env=${HOME5}/.tarfa/agent.env | path=${HOME5}/.local/bin:${HOME5}/.local/share/mise/shims:/usr/bin:/bin | pwd=${HOME5_REAL}" "$(launch "${HOME5}")"

HOME6="$(new_home h6)"
mkdir -p "${HOME6}/other/bin" "${HOME6}/cli/bin" "${HOME6}/node/bin"
touch "${HOME6}/cli/bin/tarfa"
printf '%s\n' "${HOME6}/cli" > "${HOME6}/where-cli"
printf '%s\n' "${HOME6}/node" > "${HOME6}/where-node"
printf '#!/bin/sh\necho "node $* | home=$HOME"\n' > "${HOME6}/node/bin/node"
chmod +x "${HOME6}/node/bin/node"
printf 'TARFA_TOKEN=x\nHOME=%s/other\n' "${HOME6}" > "${HOME6}/.tarfa/agent.env"
check "a HOME= line in agent.env does not move the lookups (it reaches the agent as written)" \
  "node ${HOME6}/cli/bin/tarfa serve | home=${HOME6}/other" "$(launch "${HOME6}")"

HOME2="$(new_home h2)"
rm "${HOME2}/.local/bin/mise"
mkdir -p "${SANDBOX}/stubbin"
printf '#!/bin/sh\necho "tarfa $* | env=${TARFA_AGENT_ENV:-}"\n' > "${SANDBOX}/stubbin/tarfa"
chmod +x "${SANDBOX}/stubbin/tarfa"
out="$(cd "${SANDBOX}" && env -i HOME="${HOME2}" PATH="${SANDBOX}/stubbin:/usr/bin:/bin" sh "${LAUNCHER}" 2>&1)"
check "with no mise, runs tarfa serve from PATH" "tarfa serve | env=${HOME2}/.tarfa/agent.env" "${out}"

HOME7="$(new_home h7)"
rm "${HOME7}/.local/bin/mise"
mkdir -p "${HOME7}/.local/share/mise/shims"
printf '#!/bin/sh\necho "wrapper $*"\n' > "${HOME7}/.local/bin/tarfa"
printf '#!/bin/sh\necho "shim $*"\n' > "${HOME7}/.local/share/mise/shims/tarfa"
chmod +x "${HOME7}/.local/bin/tarfa" "${HOME7}/.local/share/mise/shims/tarfa"
check "a tarfa in ~/.local/bin wins over mise's shims" "wrapper serve" "$(launch "${HOME7}")"

HOME3="$(new_home h3)"
rm "${HOME3}/.tarfa/agent.env"
out="$(launch "${HOME3}")"
check "refuses, naming the fix, when agent.env is missing" "tarfa-agent: ${HOME3}/.tarfa/agent.env is missing: run tarfa setup
exit=1" "${out}"

echo "deploy/run-agent.sh"
RUN_HOME="$(new_home h4)"
mkdir -p "${SANDBOX}/clone/deploy"
cp "${HERE}/run-agent.sh" "${SANDBOX}/clone/deploy/run-agent.sh"
printf 'TARFA_TOKEN=from-clone-env\n' > "${SANDBOX}/clone/deploy/agent.env"
CLONE_REAL="$(cd "${SANDBOX}/clone" && pwd -P)"
out="$(env -i HOME="${RUN_HOME}" PATH=/usr/bin:/bin bash "${SANDBOX}/clone/deploy/run-agent.sh" 2>&1)"
check "sources its own deploy/agent.env and names it when TARFA_AGENT_ENV is unset" \
  "mise exec -- pnpm --filter @tarfa/cli exec tsx src/serve.ts | env=${CLONE_REAL}/deploy/agent.env | token=from-clone-env | pwd=${CLONE_REAL}" "${out}"
out="$(env -i HOME="${RUN_HOME}" PATH=/usr/bin:/bin TARFA_AGENT_ENV=/elsewhere/agent.env bash "${SANDBOX}/clone/deploy/run-agent.sh" 2>&1)"
check "skips deploy/agent.env and keeps TARFA_AGENT_ENV when it is already set" \
  "mise exec -- pnpm --filter @tarfa/cli exec tsx src/serve.ts | env=/elsewhere/agent.env | token= | pwd=${CLONE_REAL}" "${out}"
mkdir -p "${SANDBOX}/live"
ln -s "${SANDBOX}/live" "${SANDBOX}/clone/deploy/agent-live"
LIVE_REAL="$(cd "${SANDBOX}/live" && pwd -P)"
out="$(env -i HOME="${RUN_HOME}" PATH=/usr/bin:/bin TARFA_AGENT_ENV=/elsewhere/agent.env bash "${SANDBOX}/clone/deploy/run-agent.sh" 2>&1)"
check "still runs the deploy/agent-live target" \
  "mise exec -- pnpm --filter @tarfa/cli exec tsx src/serve.ts | env=/elsewhere/agent.env | token= | pwd=${LIVE_REAL}" "${out}"

if [ "${fails}" -gt 0 ]; then
  echo "${fails} check(s) failed"
  exit 1
fi
echo "all agent-launch checks passed"
