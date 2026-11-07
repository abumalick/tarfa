#!/usr/bin/env bash
# Tests for the `tarfa` wrapper (packages/agent/templates/tarfa-cli-wrapper.sh) that setup puts in
# ~/.local/bin. The wrapper runs as a real script under `env -i`, with a stub mise and a stub node,
# so nothing outside the scratch HOME is read or written.
set -euo pipefail
for _v in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "${_v}"; done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/.." && pwd)"
WRAPPER="${REPO}/packages/agent/templates/tarfa-cli-wrapper.sh"
mkdir -p "${REPO}/.tmp"
SANDBOX="$(mktemp -d "${REPO}/.tmp/cli-wrapper-test.XXXXXX")"
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

# A HOME with the wrapper installed, a stub mise (answers only `--cd $HOME where ...`), the install
# it names and a stub node that reports where it runs.
new_home() {
  local home="${SANDBOX}/$1"
  mkdir -p "${home}/.local/bin" "${home}/install/bin" "${home}/node/bin"
  cp "${WRAPPER}" "${home}/.local/bin/tarfa"
  cat > "${home}/.local/bin/mise" <<STUB
#!/bin/sh
if [ "\$1" = "--cd" ] && [ "\$2" = "${home}" ] && [ "\$3" = "where" ]; then
  case "\$4" in
    npm:@tarfa/cli) echo "${home}/install" ;;
    node) echo "${home}/node" ;;
  esac
  exit 0
fi
echo "mise: refused \$*" >&2
exit 1
STUB
  printf '// the installed cli\n' > "${home}/install/bin/tarfa"
  cat > "${home}/node/bin/node" <<'STUB'
#!/bin/sh
printf 'node %s | pwd=%s\n' "$*" "$(pwd -P)"
STUB
  chmod +x "${home}/.local/bin/mise" "${home}/node/bin/node"
  echo "${home}"
}

# The project holds an untrusted mise.toml, which a shim run from it would die on.
mkdir -p "${SANDBOX}/project"
printf '[tools]\nnode = "1"\n' > "${SANDBOX}/project/mise.toml"
PROJECT_REAL="$(cd "${SANDBOX}/project" && pwd -P)"

echo "wrapper"
H1="$(new_home h1)"
out="$(cd "${SANDBOX}/project" && env -i HOME="${H1}" PATH=/usr/bin:/bin sh "${H1}/.local/bin/tarfa" spawn . --title 'two words' 2>&1)"
check "runs the install under its node, from the caller's folder, with every argument intact" \
  "node ${H1}/install/bin/tarfa spawn . --title two words | pwd=${PROJECT_REAL}" "${out}"

out="$(cd "${SANDBOX}/project" && env -i HOME="${H1}" PATH="${H1}/.local/bin:/usr/bin:/bin" tarfa ls 2>&1)"
check "works when found through PATH" "node ${H1}/install/bin/tarfa ls | pwd=${PROJECT_REAL}" "${out}"

H2="$(new_home h2)"
rm "${H2}/.local/bin/mise"
mkdir -p "${SANDBOX}/other"
printf '#!/bin/sh\necho "other tarfa $* | pwd=$(pwd -P)"\n' > "${SANDBOX}/other/tarfa"
chmod +x "${SANDBOX}/other/tarfa"
out="$(cd "${SANDBOX}/project" && env -i HOME="${H2}" PATH="${H2}/.local/bin:${SANDBOX}/other:/usr/bin:/bin" tarfa ls 2>&1)"
check "with no mise, runs the next tarfa on PATH that is not itself" "other tarfa ls | pwd=${PROJECT_REAL}" "${out}"

out="$(cd "${SANDBOX}/project" && env -i HOME="${H2}" PATH="${H2}/.local/bin:/usr/bin:/bin" tarfa ls 2>&1)" && code=0 || code=$?
check "with no mise and no other tarfa, fails in one line without calling itself" \
  "tarfa: no installed @tarfa/cli found (mise use -g npm:@tarfa/cli)|exit=1" "${out}|exit=${code}"

cp "${H2}/.local/bin/tarfa" "${SANDBOX}/other/copy-of-wrapper"
cp "${H2}/.local/bin/tarfa" "${SANDBOX}/other/tarfa"
out="$(cd "${SANDBOX}/project" && env -i HOME="${H2}" PATH="${H2}/.local/bin:${SANDBOX}/other:/usr/bin:/bin" tarfa ls 2>&1)" && code=0 || code=$?
check "a second copy of the wrapper on PATH ends in the same line, never a loop" \
  "tarfa: no installed @tarfa/cli found (mise use -g npm:@tarfa/cli)|exit=1" "${out}|exit=${code}"

H3="$(new_home h3)"
rm -r "${H3}/install"
out="$(cd "${SANDBOX}/project" && env -i HOME="${H3}" PATH="${H3}/.local/bin:/usr/bin:/bin" tarfa ls 2>&1)" && code=0 || code=$?
check "a mise that names an install with no bin/tarfa is no install" \
  "tarfa: no installed @tarfa/cli found (mise use -g npm:@tarfa/cli)|exit=1" "${out}|exit=${code}"

if [ "${fails}" -gt 0 ]; then
  echo "${fails} check(s) failed"
  exit 1
fi
echo "all tarfa-cli-wrapper checks passed"
