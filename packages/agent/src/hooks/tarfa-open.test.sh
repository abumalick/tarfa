#!/usr/bin/env bash
# Tests for tarfa-open.sh, a workspace's BROWSER. Hermetic: a fake `curl` on PATH, no network.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "${SANDBOX}"' EXIT
OPEN="${SANDBOX}/tarfa-open.sh"
sed 's/__TARFA_HOOKS_PORT__/8799/' "${HERE}/tarfa-open.sh" > "${OPEN}"
chmod +x "${OPEN}"

BIN="${SANDBOX}/bin"
mkdir -p "${BIN}" "${SANDBOX}/.tarfa"
printf 's3cret' > "${SANDBOX}/.tarfa/token"
cat > "${BIN}/curl" <<'FAKE'
#!/usr/bin/env bash
# Records what the script gave curl (argv, the header file, the body on stdin) and answers
# FAKE_ANSWER.
printf '%s\n' "$@" > "${CURL_LOG}.argv"
: > "${CURL_LOG}.headers"
prev=""
for arg in "$@"; do
  if [ "$prev" = "-H" ] && [ "${arg#@}" != "$arg" ]; then cat "${arg#@}" >> "${CURL_LOG}.headers"; fi
  if [ "$prev" = "--data-binary" ] && [ "$arg" = "@-" ]; then cat > "${CURL_LOG}"; fi
  prev="$arg"
done
printf '%s' "${FAKE_ANSWER:-}"
FAKE
chmod +x "${BIN}/curl"
export PATH="${BIN}:${PATH}"
export HOME="${SANDBOX}"
export CURL_LOG="${SANDBOX}/curl"
unset CODEX_THREAD_ID

fails=0
check() {
  if [ "$2" = "$3" ]; then
    echo "  ok: $1"
  else
    echo "  FAIL: $1"
    echo "    expected: $3"
    echo "    actual:   $2"
    fails=$((fails + 1))
  fi
}
run() {
  rm -f "${CURL_LOG}" "${CURL_LOG}.argv" "${CURL_LOG}.headers"
  set +e
  TMUX_PANE="${PANE:-%7}" "${OPEN}" "$@" 2>/dev/null
  status=$?
  set -e
}

echo "tarfa-open.sh"
URL='https://claude.ai/code/artifact/3f2a?x=1&y=2'
FAKE_ANSWER='{"result":"shown"}' run "${URL}"
check "exits 0 when the agent shows the page" "${status}" "0"
body="$(cat "${CURL_LOG}")"
check "posts the pane and the URL" "$(sed -E 's/"pid":[0-9]+/"pid":N/' <<<"${body}")" "{\"pane\":\"%7\",\"pid\":N,\"url\":\"${URL}\"}"
check "to the agent's /open on its port" "$(grep -c '^http://127.0.0.1:8799/open$' "${CURL_LOG}.argv")" "1"
check "with the secret in a header file" "$(cat "${CURL_LOG}.headers")" "authorization: Bearer s3cret"
check "and neither the secret nor the URL on argv" "$(grep -c -e s3cret -e claude.ai "${CURL_LOG}.argv" || true)" "0"

FAKE_ANSWER='{"result":"refused","reason":"not run from a Tarfa workspace"}' run "${URL}"
check "exits 1 when the agent refuses" "${status}" "1"
FAKE_ANSWER='' run "${URL}"
check "exits 1 when no agent answers" "${status}" "1"

for bad in 'file:///etc/passwd' 'javascript:alert(1)' '/home/u/report.pdf' 'https://a.example/"},"x":"' 'https://a.example/a\b' 'https://a.example/a b'; do
  FAKE_ANSWER='{"result":"shown"}' run "${bad}"
  check "refuses ${bad} without calling the agent" "${status}:$([ -e "${CURL_LOG}" ] && echo called || echo none)" "1:none"
done

PANE='%7"x' FAKE_ANSWER='{"result":"shown"}' run "${URL}"
check "drops a malformed pane rather than splicing it" "$(sed -E 's/"pid":[0-9]+/"pid":N/' "${CURL_LOG}")" "{\"pane\":\"\",\"pid\":N,\"url\":\"${URL}\"}"

CODEX_THREAD_ID='019a-ff' FAKE_ANSWER='{"result":"shown"}' run "${URL}"
check "names a Codex thread" "$(grep -c '"codexThread":"019a-ff"' "${CURL_LOG}")" "1"

[ "${fails}" -eq 0 ] || { echo "${fails} failed"; exit 1; }
echo "all passed"
