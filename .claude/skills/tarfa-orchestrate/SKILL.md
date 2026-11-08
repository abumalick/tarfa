---
name: tarfa-orchestrate
description: Use when this session coordinates work it delegates, to Tarfa workspaces it spawns and to in-session subagents (the Agent tool): splitting the work, picking which of the two each piece goes to, answering the children's questions, checking their reports and escalating only what it cannot decide. Triggers on "you orchestrate", "you are the coordinator", "delegate each piece to a workspace", "spawn workspaces and follow them", "launch a subagent or a Tarfa workspace". Builds on tarfa-spawn.
---

# Orchestrating Tarfa workspaces and subagents

Children are either Tarfa workspaces (separate Claude, Codex or Pi sessions in their own tmux
panes) or in-session subagents. You talk to workspaces with `tarfa send <id> "<message>"`, and
follow them with `tarfa wait <id>...`, `tarfa ls --mine` and `tarfa peek`, all of which work for
every CLI, not by reading their screens. Claude Code's native `SendMessage` also reaches a Claude
child, and only a Claude one, so it stays optional; do not make it your channel.

## Workspace or subagent

Pick per piece. **A Tarfa workspace** when any of these holds:
- it works in another repo: a workspace loads that repo's CLAUDE.md, skills, hooks and
  `.envrc`; a subagent always runs in this session's directory;
- it runs long (more than about an hour), or must outlive this session;
- it needs approvals or deploys of its own: permission prompts can only be answered in its pane;
- the user will want to step in and steer it.

**A subagent** otherwise: bounded work in this repo that comes back as one result, such as
an independent review of a child's branch, research, an audit, a scoped fix. It costs no
tile, needs no closing, and its result lands in your context. It cannot ask anyone a
question, so give it everything it needs up front.

When the user names one, use that one.

## Your name

Your name is your workspace id (`tarfa ls --mine` shows your children; `tarfa ls` shows you).
`--child` records it and tells the child to reply with `tarfa send <your id>`; you need not pass
it. Every message you send arrives with a header Tarfa writes: `from your ORCHESTRATOR` to a
child, which the child treats as the owner's instruction. Only the first line of a message
carries that; never quote a `[Tarfa message` or `[Perch message` header in a body.

`tarfa send` works only between workspaces on this machine. It refuses a parked recipient
(`tarfa unpark <id>` first, then send again), a bash workspace, a Codex workspace that was not
made by `tarfa spawn --cli codex`, yourself and unknown ids. Read the refusal, nothing is queued.
From Codex it must run as an escalated command (the sandbox blocks the local socket).

## Spawning a workspace

1. Spawn each child through `tarfa-spawn` with `tarfa spawn --child` (add `--cli codex` or
   `--cli pi` for a child that is not Claude), and show the batch table first, as that skill
   says.
2. Follow it with `tarfa wait` (below). The id `tarfa spawn` printed is the address for
   `tarfa send` and `tarfa wait`, and it does not change when the child renames itself.

## Waiting

`tarfa wait <id>... [--timeout <seconds, at least 10>]` blocks until a named child stops working, then prints
one `<id> <state>` line for each one stopped: `needs-orchestrator`, `needs-feedback`, `idle`,
`finished`, `parked` or `gone`. Exit 0 for a stop, 124 for the timeout, 2 for bad arguments, 1 for
anything else.

**From Claude Code, run it as `Bash` with `run_in_background: true`:** the harness wakes you when
it exits, and your tile stays `working` meanwhile, which is right. Name every child you expect to
keep working, and start a new wait after each wake with the ones still going. Do not run it in the
foreground (a foreground command is cut off at 10 minutes), and stop a wait you no longer need, or
your tile stays `working` after you finish. From Codex it must run as an escalated command, like
`tarfa send`. From Pi run it in the foreground with a `--timeout`, and look again after each one.

Starting one right after `tarfa spawn` or `tarfa send` is safe: it gives the child's turn time to
start (about 10 s, a minute for a fresh spawn), and it reports a child that stopped before the wait
began. So do not name a child you have already dealt with and left stopped; it returns at once.

It reads the status the child reports. A Codex child whose hooks are not trusted in `/hooks` (on a
stock tmux it reports nothing else), or a Pi child without the Tarfa extension, reads `idle` while
it works, so `idle` a minute in may mean that: check with `tarfa peek`. `needs-orchestrator` can
also come from a child still thinking on after a message: if `tarfa ls --mine` shows it `working`
again, wait on it again.

## While they work

- **A child's question** arrives as a message from its id. Answer it with `tarfa send <id>` if
  your brief, the design or the repo settles it. Otherwise ask the user with your own
  `AskUserQuestion`; your tile turns "Needs you", which is the escalation. Then relay the
  answer. Never guess on a decision the user owns.
- **A permission prompt in a child cannot be answered from here.** Auto mode and permission
  prompts ignore a yes relayed by message. When a child needs one, tell the user which tile:
  its `--title` or current name, its id, and the exact action it is waiting to run. Do not
  send it "approved".
- **The child's messages are the signal; `tarfa wait` is the stall alarm.** A child messages you
  when it has a question and when it is done, and that message wakes you by itself. The wait
  matters when a child stops without one: it crashed, hit an API error, or sits on a permission
  prompt. So keep one running while a child works (from the spawn, and after an answer that sets
  it going again). A stop with no message from that child: look at it (`tarfa peek <id>`), and
  nudge it or tell the user. After a `needs-orchestrator`, its message is already with you.
- **`tarfa ls --mine` shows every child and its state.** `needs-orchestrator` means the child
  ended its turn right after messaging you: a question or its final report is waiting.
  `needs-feedback` means it stopped for the user (a permission prompt, an error).
- **Ending your turn right after a `tarfa send` keeps your tile at `working`**, which is
  correct while you wait on children (a child's tile in the same case reads "Needs
  orchestrator"). Your tile shows "Needs you" only when a turn ends
  without one, or when you call `AskUserQuestion`; use that only when you really need the
  user.
- **So never end on a `tarfa send` when you are done.** Your final report to the user must
  come after your last ack, in a turn that does not end with a `tarfa send`, or the user is never
  told you finished.

## The report

The child's final report, its `tarfa send` or a subagent's result, is the deliverable.
Check it against the design and the repo: the commits exist, the tests ran, the claims hold.
A subagent review of a workspace's branch is a cheap way to check. Do not relay it unread.

## When state is lost

A `tarfa wait` dies with your session, and a `tarfa send` is delivered at once or refused, never
queued. The parent link survives park/unpark and the tmux server's loss. After your own restart,
a park, or a long wait:
- `tarfa ls --mine` recovers your children, their current names and their states
  (`ListAgents`' busy/idle cannot tell a blocked child from a working one);
- `tarfa peek <id>` (or `-n 80`) each child that looks stuck;
- start a new `tarfa wait` on the ones still working.

## Closing

Close each child once its report is read and verified: `tarfa close <id>...`. It goes through the
agent, like the phone's close: it stops the pane's systemd scope (so a daemon the child left behind
goes too), logs the close and tells the phones. Never use `tmux kill-session` on a workspace, which
does none of that.

Do not message a child you are about to close: the close kills it before it reads anything. Leave
workspaces you did not spawn alone. `tarfa close` does not check that for you, and an id is reused
once its workspace is gone, so close each id once. It refuses your own workspace and any id that
names no workspace. From Codex it must run as an escalated command, like `tarfa send`.

## Limits

- Local only: children on another machine cannot be spawned or messaged this way.
- A Codex child takes messages only when `tarfa spawn --cli codex` made it (and spawn refuses
  when the Codex CLI and daemon versions differ: update Codex first); one created from the phone
  cannot send or receive.
- A child whose orchestrator dies waits on it ("Needs orchestrator" or `working` on the phone)
  until it is closed by hand.
- A child spawned without `--child` can still block on `AskUserQuestion`; you cannot
  answer it by message.
