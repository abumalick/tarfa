---
name: tarfa-spawn
description: Launch separate local Tarfa tmux workspaces from self-contained task briefs with the `tarfa spawn` CLI (Claude Code by default, or Codex or Pi). Use when asked to open or spawn a Tarfa workspace, not for in-session Codex subagents or remote machines.
---

# Spawn a Tarfa workspace from Codex

A Tarfa workspace is a detached tmux session named after its folder and a small
number (`tarfa-3`; older ones are `perch-<6 hex>`), discovered by the machine agent.
The launcher is the `tarfa` CLI (`tarfa spawn`), on PATH on every machine running
the agent (`docs/DEPLOY.md`). It starts **Claude Code** unless `--cli codex` or
`--cli pi` says otherwise. Name the CLI in the proposed launch; if the user asks
for a Codex workspace, pass `--cli codex` rather than substituting Claude.

Use the CLI rather than raw tmux or a launcher of your own. It is
`spawnWorkspace` in `packages/agent`, tested there.

## Prepare and launch

1. Run `tarfa ls --path <project>` to see whether an existing workspace (parked
   ones included, listed with title and role) already holds the task, then resolve an existing
   project directory for each new one (a relative path resolves against the cwd).
2. Write a self-contained brief. A child has none of this conversation's context.
   Reference an issue if it contains the details; otherwise describe the observed
   problem and desired outcome. Include reporting expectations and relevant
   constraints. Do not refer to “the bug above”.
3. Show the concrete batch (project, brief, optional title, and CLI).
   Obtain launch authorization if the existing request does not already cover
   these workspaces. Honor existing authorization without asking again.
4. Run `tarfa spawn`, passing the brief through a **quoted** heredoc:

```sh
tarfa spawn --title 'issue 412' /abs/path/to/project <<'PROMPT'
Work on issue #412. Read it first and follow this project's conventions.
Complete the authorized work and report the changes, checks, and anything left open.
PROMPT
```

5. Report the returned workspace id and title. The brief remains at
   `~/.tarfa/spawn/<id>.md`.

`--model <alias>` picks the model: `claude --model '<m>'` for Claude (default
`opus[1m]`; preserve it unless the user asks otherwise), the thread's model for Codex,
`pi-reviewed --model '<m>'` for Pi. `--cli codex` creates the Codex thread and starts
it bound to the Codex daemon, which is what lets that workspace take messages; spawn
refuses when `codex --version` and the daemon's version differ. `--title` names the
workspace and holds the name, through park/unpark too. Other sessions message a
workspace with `tarfa send <id> "<message>"`.

Point children at their project roots and let each project's own worktree rules
provide isolation. If the project has no such convention and concurrent children
would edit the same files, resolve ownership before launching.

## Messaging boundary

`--child` records the calling workspace as the child's parent. The child is told
to send its questions and final report with `tarfa send <parent id>`, and a Claude
child cannot use `AskUserQuestion` or plan mode. Pass it only when this session is
itself a Tarfa workspace that can take messages: a Codex session started by
`tarfa spawn --cli codex` can, a Codex session started any other way cannot (Tarfa
has no thread of it to deliver into), and the child's reports would be stranded.

Leave `--child` off for user-driven workspaces (the default). For a user-requested
coordinated batch, follow `$tarfa-orchestrate`: prefer native Codex subagents when
suitable; follow children with `tarfa wait <id>...` and close them with
`tarfa close <id>...`. The Claude procedure is in
[the original skill](../../../.claude/skills/tarfa-spawn/SKILL.md).

## Launcher invariants

- Keep the brief on stdin through a quoted heredoc, never interpolated into a
  command line: it preserves `$`, backticks, apostrophes, and newlines.
- Do not start workspaces with raw `tmux new-session`: without the CLI's
  `@tarfa_command` a workspace can never be parked or resumed.
- Do not run `tarfa spawn` as a smoke test: it starts a real process.
