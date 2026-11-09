#!/usr/bin/env bash
# Land a feature branch on main and push it, one landing at a time.
#
#   deploy/land.sh <branch>      (from the main checkout or any worktree)
#
# The branch must be checked out in its own worktree, committed and clean.
# 1. In that worktree, outside any lock: fetch, merge origin/main into the branch and
#    run the full gate there. This is the slow part, so concurrent landings do it in
#    parallel, each on its own checkout (and its own packages/pwa/dist).
# 2. Under a lock shared by every checkout of this repo: refuse a main checkout that is
#    dirty or mid-merge, bring main up to origin/main, fast-forward main to the branch
#    and push it. Seconds, with no test run: pre-push skips the suite for the exact tree
#    step 1 gated (TARFA_GATE_PASSED), and still checks for leaks.
# If origin/main moved between the two, the lock is released and step 1 runs again.
#
# Why: integrating in the shared main checkout behind a gate of several minutes left
# merges open there (MERGE_HEAD, a staged index) for every other session to trip over,
# and nothing made concurrent sessions wait their turn.
set -euo pipefail

die() { echo "land: $*" >&2; exit 1; }

BRANCH="${1:-}"
[ -n "${BRANCH}" ] && [ "$#" -eq 1 ] || die "usage: deploy/land.sh <branch>"
[ "${BRANCH}" != main ] || die "main is the target, not a branch to land"
command -v flock >/dev/null || die "flock not found (util-linux); land serializes with it"
git rev-parse -q --verify "refs/heads/${BRANCH}" >/dev/null || die "no local branch '${BRANCH}'"

COMMON="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
worktree_of() {
  git worktree list --porcelain | awk -v want="$1" '
    /^worktree / { wt = substr($0, 10) }
    want == "" && /^worktree / { print wt; exit }
    want != "" && $0 == "branch refs/heads/" want { print wt; exit }'
}
MAIN="$(worktree_of "")"
WT="$(worktree_of "${BRANCH}")"
[ -n "${WT}" ] || die "'${BRANCH}' is not checked out in a worktree; land runs its gate there"
[ -z "$(git -C "${WT}" status --porcelain)" ] || die "${WT} has uncommitted changes; commit them first"

LOCK="${COMMON}/land.lock"
WAIT="${TARFA_LAND_WAIT:-1800}"
GATED_TREE=""

for attempt in 1 2 3 4 5; do
  echo "land: [${attempt}] bringing origin/main into ${BRANCH} (${WT})…"
  git -C "${WT}" fetch -q origin
  before="$(git -C "${WT}" rev-parse HEAD)"
  # A merge commit runs pre-merge-commit, which is the gate on the merged tree.
  if ! TARFA_NO_BUILD=1 git -C "${WT}" merge -q --no-edit origin/main; then
    die "merging origin/main into ${BRANCH} failed (a conflict, or the gate went red). It is left in ${WT}: resolve or fix, commit, then run land again."
  fi
  after="$(git -C "${WT}" rev-parse HEAD)"
  tree="$(git -C "${WT}" rev-parse "HEAD^{tree}")"
  [ -z "$(git -C "${WT}" status --porcelain)" ] || die "${WT} is dirty after the merge"

  if [ "${after}" != "${before}" ] \
    && [ "$(git -C "${WT}" rev-parse HEAD^1)" = "${before}" ] \
    && git -C "${WT}" rev-parse -q --verify HEAD^2 >/dev/null; then
    GATED_TREE="${tree}"
  fi
  if [ "${GATED_TREE}" != "${tree}" ]; then
    echo "land: running the gate in ${WT}…"
    (cd "${WT}" && "${WT}/deploy/git-hooks/run-tests.sh" land) || die "the gate failed in ${WT}; nothing landed"
    [ -z "$(git -C "${WT}" status --porcelain)" ] || die "the gate left ${WT} dirty; nothing landed"
    GATED_TREE="${tree}"
  fi
  # The gate's leak check reads only the tree; what the push will publish (each commit's
  # message and added lines) is checked here, before main moves, as pre-push will.
  base="$(git -C "${WT}" rev-parse origin/main)"
  (cd "${WT}" && "${WT}/deploy/git-hooks/run-tests.sh" pre-push origin leaks-only \
    <<<"refs/heads/main ${after} refs/heads/main ${base}") || die "the leak check refused ${BRANCH}; nothing landed"

  exec 9>"${LOCK}"
  if ! flock -n 9; then
    echo "land: waiting for another landing to finish (up to ${WAIT}s)…"
    flock -w "${WAIT}" 9 || die "gave up waiting for ${LOCK}"
  fi

  [ "$(git -C "${MAIN}" symbolic-ref -q --short HEAD)" = main ] || die "the main checkout ${MAIN} is not on main"
  if git -C "${MAIN}" rev-parse -q --verify MERGE_HEAD >/dev/null || [ -n "$(git -C "${MAIN}" status --porcelain)" ]; then
    git -C "${MAIN}" status --short >&2
    die "the main checkout ${MAIN} has uncommitted changes or an open merge; nothing may be done there. Find whose they are before touching them."
  fi
  git -C "${MAIN}" fetch -q origin
  git -C "${MAIN}" merge-base --is-ancestor main origin/main \
    || die "local main has commits origin/main lacks ($(git -C "${MAIN}" log --oneline origin/main..main | tr '\n' ' ')); they reached main without land"
  TARFA_NO_BUILD=1 git -C "${MAIN}" merge -q --ff-only origin/main

  if ! git -C "${MAIN}" merge-base --is-ancestor origin/main "${after}"; then
    echo "land: origin/main moved during the gate; going again."
    exec 9>&-
    continue
  fi

  # post-merge pushes main; the exported tree lets pre-push skip the suite it already passed.
  previous="$(git -C "${MAIN}" rev-parse main)"
  TARFA_NO_BUILD=1 TARFA_GATE_PASSED="${tree}" git -C "${MAIN}" merge -q --ff-only "${after}"
  remote="$(git -C "${MAIN}" ls-remote origin refs/heads/main | cut -f1)"
  if [ "${remote}" != "${after}" ] && ! TARFA_GATE_PASSED="${tree}" git -C "${MAIN}" push -q origin main; then
    # Main moved here only; put it back so it never sits ahead of origin.
    git -C "${MAIN}" reset -q --keep "${previous}"
    die "the push of ${BRANCH} was refused (see above); main is back at ${previous:0:7}, nothing landed"
  fi
  exec 9>&-
  # Outside the landing lock (a build takes a while), but one build of main's dist at a time.
  (cd "${MAIN}" && flock "${COMMON}/land-build.lock" "${MAIN}/deploy/build-current.sh") \
    || echo "land: rebuilding main's PWA failed; the landing stands" >&2
  echo "land: ${BRANCH} is on main and origin/main (${after:0:7})."
  echo "land: next, from ${MAIN}: pnpm worktree:remove ${WT#"${MAIN}/"} && git branch -d ${BRANCH}"
  exit 0
done
die "origin/main kept moving; tried 5 times"
