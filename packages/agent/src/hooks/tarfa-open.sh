#!/usr/bin/env bash
# A Tarfa workspace's BROWSER: asks the phone viewing this workspace to open the page, as a card it
# opens with one tap. Usage: tarfa-open.sh <url>. The agent writes this file at startup with its
# hooks port and state directory in place of the placeholders below.
# On a refusal it exits non-zero, so the caller falls back to printing the link.
port=__TARFA_HOOKS_PORT__
token_file='__TARFA_STATE_DIR__/token'
url="${1:-}"
case "${url}" in
  http://* | https://*) ;;
  *) echo "tarfa-open: not a web page: ${url}" >&2; exit 1 ;;
esac
# The URL is spliced into the JSON body below, so nothing that needs escaping gets through; the
# agent checks the URL itself as well.
if [[ "${url}" =~ [[:space:][:cntrl:]\"\\] ]]; then
  echo "tarfa-open: refusing a URL with spaces, quotes or control characters" >&2
  exit 1
fi
pane="${TMUX_PANE:-}"
[[ "${pane}" =~ ^%[0-9]+$ ]] || pane=""
thread_field=""
# Codex under its daemon runs tools outside the pane: its thread names the workspace instead.
[[ "${CODEX_THREAD_ID:-}" =~ ^[0-9A-Za-z-]+$ ]] && thread_field=",\"codexThread\":\"${CODEX_THREAD_ID}\""
token=""
[ -r "${token_file}" ] && token="$(cat "${token_file}")"
# The secret goes in as a header file and the body (the URL may hold a login code) on stdin, so
# neither shows on a command line another local user could read.
answer="$(printf '{"pane":"%s","pid":%s,"url":"%s"%s}' "${pane}" "$$" "${url}" "${thread_field}" |
  curl -s -m 5 -X POST "http://127.0.0.1:${port}/open" \
    -H 'content-type: application/json' \
    -H @<(printf 'authorization: Bearer %s\n' "${token}") \
    --data-binary @- 2>/dev/null)"
case "${answer}" in
  *'"result":"shown"'*) exit 0 ;;
esac
echo "tarfa-open: the Tarfa agent did not take the page${answer:+: ${answer}}" >&2
exit 1
