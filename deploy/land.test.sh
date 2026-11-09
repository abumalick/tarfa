#!/usr/bin/env bash
# Tests for deploy/land.sh and the pre-push guard, in a throwaway repo with a bare origin.
# The real hooks run; run-tests.sh and build-current.sh are stand-ins that log each gate.
set -euo pipefail

# Hooks export GIT_DIR and friends; the sandbox's git must not act on the outer repo.
for _v in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "${_v}"; done
unset TARFA_GATE_PASSED

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/.." && pwd)"
mkdir -p "${REPO}/.tmp"
SB="$(mktemp -d "${REPO}/.tmp/land-test.XXXXXX")"
trap 'rm -rf "${SB}"' EXIT
export HOME="${SB}/home"
mkdir -p "${HOME}"
git config --global user.email t@t
git config --global user.name test
git config --global init.defaultBranch main

export GATE_LOG="${SB}/gate.log"
: >"${GATE_LOG}"
fail() { echo "FAIL: $1" >&2; echo "--- gate log" >&2; cat "${GATE_LOG}" >&2; exit 1; }

M="${SB}/repo"
git init -q --bare "${SB}/origin.git"
git init -q "${M}"
mkdir -p "${M}/deploy/git-hooks"
cp "${HERE}/land.sh" "${M}/deploy/"
cp "${HERE}/git-hooks/pre-push" "${HERE}/git-hooks/post-merge" "${HERE}/git-hooks/pre-merge-commit" \
  "${HERE}/git-hooks/pre-commit" "${M}/deploy/git-hooks/"
cat >"${M}/deploy/git-hooks/run-tests.sh" <<'EOF'
#!/usr/bin/env bash
top="$(git rev-parse --show-toplevel)"
echo "$1 ${3:-full} $(basename "${top}")" >>"${GATE_LOG}"
if [ "$1" = pre-push ]; then # stands in for check-leaks: a commit saying LEAK is refused
  while read -r _ sha _ old; do
    [ -n "${sha:-}" ] && [ "${old}" != 0000000000000000000000000000000000000000 ] || continue
    ! git log --format=%B "${old}..${sha}" | grep -q LEAK || exit 1
  done
fi
[ ! -f "${top}/RED" ] || exit 1
case "$1" in land|pre-merge-commit) sleep "${GATE_SLEEP:-0}" ;; esac
EOF
printf '#!/usr/bin/env bash\nexit 0\n' >"${M}/deploy/build-current.sh"
chmod +x "${M}"/deploy/*.sh "${M}"/deploy/git-hooks/*
printf '.worktrees/\n' >"${M}/.gitignore"
echo base >"${M}/a.txt"
git -C "${M}" add -A
git -C "${M}" commit -qm init --no-verify
git -C "${M}" remote add origin "${SB}/origin.git"
git -C "${M}" push -q --no-verify -u origin main
git -C "${M}" config core.hooksPath "${M}/deploy/git-hooks"

LAND="${M}/deploy/land.sh"
origin_main() { git -C "${SB}/origin.git" rev-parse main; }
feature() { # <name> <file> <content> [base]: a worktree with one commit
  git -C "${M}" worktree add -q "${M}/.worktrees/$1" -b "$1" "${4:-origin/main}" 2>/dev/null
  echo "$3" >"${M}/.worktrees/$1/$2"
  git -C "${M}/.worktrees/$1" add -A
  git -C "${M}/.worktrees/$1" commit -qm "$1" --no-verify
}

# 1. A branch lands: gated once in its worktree, pushed without a second suite.
feature a a.txt a
(cd "${M}" && "${LAND}" a >/dev/null) || fail "land a"
[ "$(origin_main)" = "$(git -C "${M}" rev-parse a)" ] || fail "origin main is not a"
[ "$(git -C "${M}" rev-parse main)" = "$(git -C "${M}" rev-parse a)" ] || fail "local main is not a"
grep -qx 'land full a' "${GATE_LOG}" || fail "the gate did not run in a's worktree"
grep -qx 'pre-push leaks-only repo' "${GATE_LOG}" || fail "the push did not skip the gated suite"
echo "ok: land gates in the worktree and pushes main without a second suite"

# 2. The guard: a worktree cannot push its branch to main; a mismatched tree runs the suite.
feature b b.txt b
before="$(origin_main)"
if (cd "${M}/.worktrees/b" && git push -q origin HEAD:main 2>"${SB}/err"); then fail "HEAD:main from a worktree was pushed"; fi
grep -q 'only local main may be pushed' "${SB}/err" || fail "no guard message: $(cat "${SB}/err")"
[ "$(origin_main)" = "${before}" ] || fail "origin main moved"
: >"${GATE_LOG}"
(cd "${M}/.worktrees/b" && TARFA_GATE_PASSED=deadbeef git push -q origin b) || fail "push b"
grep -qx 'pre-push full b' "${GATE_LOG}" || fail "a tree land never gated skipped the suite"
echo "ok: only local main reaches main, and the skip needs the gated tree"

# 3. A release tag must already be on origin/main.
git -C "${M}" tag v9.9.9 b
if git -C "${M}" push -q origin v9.9.9 2>"${SB}/err"; then fail "a tag off main was pushed"; fi
grep -q 'not on origin/main' "${SB}/err" || fail "no tag message: $(cat "${SB}/err")"
git -C "${M}" tag -d v9.9.9 >/dev/null
git -C "${M}" tag v9.9.8 main
git -C "${M}" push -q origin v9.9.8 || fail "a tag on main was refused"
echo "ok: a release tag goes out only once its commit is on main"

# 4. A dirty main checkout stops a landing before anything moves.
echo dirty >>"${M}/a.txt"
if (cd "${M}" && "${LAND}" b >/dev/null 2>"${SB}/err"); then fail "landed onto a dirty main checkout"; fi
grep -q 'uncommitted changes or an open merge' "${SB}/err" || fail "no dirty message: $(cat "${SB}/err")"
git -C "${M}" checkout -q -- a.txt
[ "$(origin_main)" = "${before}" ] || fail "origin main moved"
echo "ok: a dirty main checkout is refused"

# 5. Local main ahead of origin is refused: it reached main without land.
git -C "${M}" commit -q --allow-empty -m stray --no-verify
if (cd "${M}" && "${LAND}" b >/dev/null 2>"${SB}/err"); then fail "landed over unpushed main commits"; fi
grep -q 'commits origin/main lacks' "${SB}/err" || fail "no ahead message: $(cat "${SB}/err")"
git -C "${M}" reset -q --hard origin/main
echo "ok: unpushed commits on main are refused"

# 6. A red gate lands nothing.
feature red RED x
if (cd "${M}" && "${LAND}" red >/dev/null 2>&1); then fail "a red branch landed"; fi
[ "$(origin_main)" = "${before}" ] || fail "origin main moved after a red gate"
echo "ok: a red gate lands nothing"

# 7. A conflict with origin/main is left in the branch's worktree; main is untouched.
feature c a.txt c "$(git -C "${M}" rev-list --max-parents=0 main)"
if (cd "${M}" && "${LAND}" c >/dev/null 2>"${SB}/err"); then fail "a conflicting branch landed"; fi
grep -q "merging origin/main into c failed" "${SB}/err" || fail "no conflict message: $(cat "${SB}/err")"
git -C "${M}/.worktrees/c" rev-parse -q --verify MERGE_HEAD >/dev/null || fail "the conflict was not left in c"
[ -z "$(git -C "${M}" status --porcelain)" ] || fail "the main checkout was touched"
echo "ok: a conflict stays in the branch's worktree"

# 8. A commit the leak check refuses is caught before main moves.
feature leak leak.txt x
git -C "${M}/.worktrees/leak" commit -q --allow-empty -m "LEAK" --no-verify
main_before="$(git -C "${M}" rev-parse main)"
if (cd "${M}" && "${LAND}" leak >/dev/null 2>"${SB}/err"); then fail "a leaking branch landed"; fi
grep -q 'leak check refused' "${SB}/err" || fail "no leak message: $(cat "${SB}/err")"
[ "$(git -C "${M}" rev-parse main)" = "${main_before}" ] || fail "local main moved for a leaking branch"
echo "ok: a leak in the branch's commits is refused before main moves"

# 9. A push origin refuses puts local main back where it was.
feature refused r.txt r
printf '#!/bin/sh\necho "origin says no" >&2\nexit 1\n' >"${SB}/origin.git/hooks/pre-receive"
chmod +x "${SB}/origin.git/hooks/pre-receive"
if (cd "${M}" && "${LAND}" refused >/dev/null 2>"${SB}/err"); then fail "a refused push reported success"; fi
rm "${SB}/origin.git/hooks/pre-receive"
grep -q 'was refused' "${SB}/err" || fail "no refusal message: $(cat "${SB}/err")"
[ "$(git -C "${M}" rev-parse main)" = "${main_before}" ] || fail "local main was left ahead of origin"
[ -z "$(git -C "${M}" status --porcelain)" ] || fail "the main checkout was left dirty"
echo "ok: a refused push leaves main where it was"

# 10. Two landings at once both land, one after the other.
(cd "${M}" && "${LAND}" b >/dev/null) || fail "land b"
feature d d.txt d
feature e e.txt e
export GATE_SLEEP=1
(cd "${M}" && "${LAND}" d >"${SB}/d.out" 2>&1) & pd=$!
(cd "${M}" && "${LAND}" e >"${SB}/e.out" 2>&1) & pe=$!
wait "${pd}" || fail "concurrent land d: $(cat "${SB}/d.out")"
wait "${pe}" || fail "concurrent land e: $(cat "${SB}/e.out")"
unset GATE_SLEEP
for f in a.txt b.txt d.txt e.txt; do
  git -C "${SB}/origin.git" cat-file -e "main:${f}" || fail "origin main lacks ${f}"
done
[ "$(git -C "${M}" rev-parse main)" = "$(origin_main)" ] || fail "local main and origin differ"
cat "${SB}/d.out" "${SB}/e.out" | grep -q 'moved during the gate' || fail "the second landing never re-merged"
echo "ok: concurrent landings serialize and both land"
