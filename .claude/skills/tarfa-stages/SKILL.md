---
name: tarfa-stages
description: Use when asked to set up stages for a project, or when a Tarfa workspace should record where its task stands (in progress, in review, QA, blocked, done). Triggers on "set up stages", "task stage", "in review status", "tarfa stage", "mark this workspace as waiting". Sets a project up (a `.tarfa.json` stage list plus rules for the agent) and explains the mechanism.
---

# Tarfa stages

## Overview

A workspace has two separate facts:

- **Activity** is what the agent is doing right now: working, needs you, idle. Hooks set it
  and nobody should.
- **Stage** is where the task stands: in progress, in review, QA testing, blocked on someone
  outside, done. **Only an explicit `tarfa stage` call or a phone pick changes it**; no hook
  ever touches it. It stays put across prompts, turns and agent restarts.

The phone's home list puts everything that needs the maintainer in a "Needs you" section on
top, whatever its stage, and folds the tasks waiting on others (kind `waiting`) or finished
(kind `done`) into one line per stage with a count.

## Commands

```bash
tarfa stage "In review"     # set this workspace's stage (the one the command runs in)
tarfa stage                 # prints the usage and refuses
```

The name must be one of the project's stages (case does not matter; it is stored with the
list's spelling). An unknown name fails and the error lists the valid ones. Re-running with the
current stage is fine: it keeps the time the task entered the stage and re-arms the waiting
mark (below). It only works from inside a Tarfa workspace.

**A turn that ends on a `waiting` stage shows "Waiting", not "Needs you".** The last
`tarfa stage` of the turn decides: a later `active` or `done` stage, any later tool call, a
prompt or a question puts the workspace back to "Needs you" at the turn's end. So the command
must be the last thing the turn does.

## The stage list: `.tarfa.json`

At the project root:

```json
{
  "stages": [
    { "name": "In progress" },
    { "name": "In review", "kind": "waiting" },
    { "name": "QA testing", "kind": "waiting" },
    { "name": "Blocked", "kind": "waiting" },
    { "name": "Done", "kind": "done" }
  ]
}
```

`kind` is `active` (the default), `waiting` or `done`. It drives the folding and the waiting
mark. The agent reads the file from the workspace's project folder first, then from the main
checkout of its git repo (a git-ignored file is absent from a new worktree). **The first file
that exists wins**, and a malformed one gives the defaults rather than falling through to the
next. Without any file the defaults are In progress (active), Waiting, Blocked (waiting) and
Done (done).

## Setting a project up

1. **Find the stages.** Read the project's workflow docs (a contributing guide, a board's
   column names in `CLAUDE.md`) and propose a list; if there is none, ask the maintainer for
   the stages and which are `waiting` (ball in someone else's court: review, QA, a supplier, an
   admin office) and which `done`. Keep it short: three to six stages.
2. **Write `.tarfa.json`** at the project root.
3. **Keep it out of git** unless the maintainer wants it shared: add `.tarfa.json` to
   `.gitignore`. A repo the team shares may commit it instead; ask.
4. **Write the rules below** into the project's `CLAUDE.md`, or `CLAUDE.local.md` when the
   repo is shared with others and the rules are the maintainer's alone. A workspace running
   Codex reads `AGENTS.md` instead: write them there too if the project uses Codex.
5. **Show the maintainer** the file and the rules, and set the first stage of the current
   workspace (`tarfa stage "In progress"`) to check it works.

### The rules to write

Adapt the stage names to the project's list:

```markdown
## Tarfa stages

- When you start work on a task, run `tarfa stage "In progress"`.
- Right after each external move, set the matching stage: PR opened or review requested ->
  "In review"; merged and deployed to the test environment -> "QA testing"; ticket moved to
  done -> "Done".
- **`tarfa stage` is the very last command of a turn**, after any end-of-work git checks
  (status, log, push). Run nothing after it, and write nothing but a one-line summary.
- A turn that polls (watching a PR, a deploy, a ticket) and finds nothing new ends by re-running
  `tarfa stage` with the same stage, again as its last command.
- When you need the maintainer (a question, a decision, an approval), ask with the question
  tool. Never close a turn on a waiting stage while the real state is "waiting for the
  maintainer": a question written in the closing text stays folded and unseen.
```

## Why the rules say what they say

- *Last command:* a waiting stage only holds while no tool call follows it; any later call
  clears the mark and the row shows "Needs you" again.
- *Same stage again:* each turn's end re-checks the mark, so a polling turn that sets nothing
  would show "Needs you" to a maintainer who has nothing to do.
- *Question tool:* it always raises "Needs you", even on a waiting stage. The known gap is an
  agent that sets a waiting stage and then asks in plain text: it stays folded.

## The phone side (for the maintainer)

The status picker lists the project's stages for an agent that supports them. Picking a
`waiting` or `done` stage on a row that needs you also marks it seen, so it leaves "Needs you"
and folds in one tap. **Seen** and **Needs hands** stay as activity actions. A "Seen" or such a
pick holds only until the agent's next turn: it suppresses the one idle reminder Claude Code
sends about a minute after a turn ends, nothing more.
