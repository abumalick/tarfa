# Attention status and hooks

How a workspace's status (working, Needs you, Needs orchestrator) is decided from Claude Code and Codex hooks and from OSC 7501, and the kill guard `install-hooks` adds. Each bullet records a decision; read it before changing that code.

- Install Claude Code hooks on each agent machine: the agent CLI `install-hooks` command.
- **Attention status self-heals via tool hooks:** the attention state is last-hook-wins
  (`attention-decision.ts`). `UserPromptSubmit`/`PreToolUse`/`PostToolUse` → `working`,
  `Notification` and `Stop` → `needs-feedback` ("Needs you"). A bare `Stop` only means the
  turn ended, **not** that the task is done, so it maps to `needs-feedback`. **`finished`
  is a manual status the user sets from the PWA StatusPicker** — no hook emits it (a trailing
  `Stop` would overwrite anything Claude tried to set, so auto-`finished` isn't possible
  without a side channel; intentionally out of scope). Mapping `Pre`/`PostToolUse` to
  `working` is what unsticks a stale "Needs you" after a mid-task permission/idle
  `Notification` once Claude resumes — keep these five registered in `install-hooks.ts`, beside the two
  that end a stale `working`: **`StopFailure`**, which Claude Code fires *instead of*
  `Stop` when an API error (usage limit, overload, dropped connection) ends the turn, maps to
  `needs-feedback`; and **`SessionStart`** with source `startup`/`resume`/`clear`/`fork` (a new
  `claude` process or conversation, which has none of the old one's background tasks) drops all
  three marks and turns a `working` into `needs-feedback`, leaving any other status
  alone (an unpark sets `idle` just before its resume fires it). Source `compact` fires
  mid-turn on auto-compaction and changes nothing. An Esc interrupt fires no hook at all, so it
  still leaves `working` behind unless tmux reports OSC 7501 (next item).
- **A tmux patched for OSC 7501 is a second status source; the hooks stay.** Claude Code and
  Codex report their status with OSC 7501 (Program Status Protocol); stock tmux drops it and never
  answers the probe Claude waits for. `deploy/tmux-osc7501/` patches tmux to answer the probe and
  keep each pane's record as `#{pane_program_state}`/`#{pane_program_time}`, which the agent reads
  in `listSessions` on every tick, phone connected or not (`applyProgramStatus`). Rules in
  `program-status-decision.ts`; build, rules and cutover in `docs/TMUX-OSC7501.md`. Things not to
  "simplify": **only a change is applied, and a first sighting only records** (no heartbeat: an
  hours-old `done` must not overwrite `status.json` after an agent restart, nor a `finished` the
  user set; the change time is in the key, since a whole turn fits between two polls); **a turn
  end yields to the deferral and `messagedLast`** (OSC says `done` while a background shell runs
  and while a child waits on its orchestrator); `idle` moves only a `working` session, to
  `needs-feedback` (Codex says `idle` at a turn end); **a deferring `Stop` sets `working` only
  over a needs-feedback that an OSC turn end set** (the in-memory `oscTurnEnded` mark): OSC's
  `done` lands before the Stop hook's curl, so a poll in that gap would leave `needs-feedback`
  while the shell runs, but a needs-feedback from a permission prompt or an OSC `blocked` (a
  background subagent asking) must stand, or the prompt waits behind "working". A titled `tarfa spawn` locks the pane title
  with `allow-set-title off` (3.5+) rather than `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`, which also
  silences Claude's OSC 7501; the env switch remains on an older tmux. The agent's tests never
  need the patched binary: `tmux-adapter.osc.test.ts` runs only with `TARFA_TMUX_OSC` set.
- **Every hook event is logged with the rule that decided it.** `applyHookEvent` appends one
  JSON line per event to a gitignored `~/.tarfa/hook-events.jsonl` (`FileHookEventLog`, moved to
  `.1` past 50 MB): workspace, event, session id, tool, notification type, source, whether a
  subagent made the call, the Stop's `background_tasks` (trimmed), a `StopFailure`'s `error`,
  the `reason` (`AttentionReason`), and the status and three marks before and after. Never the
  prompt, a tool's input or output, or the assistant's message. It is what answers "why is this
  workspace still `working`": `rg '"workspace":"perch-xxxx"' ~/.tarfa/hook-events.jsonl | tail`.
  Best-effort: a failed write never changes the decision or the 204. No PWA/UI.
- **A session parked on background work stays `working`, and the 60s idle notification must
  not undo it.** `tarfa-hook.sh` forwards Claude's hook stdin verbatim as a nested `claude`
  object on `POST /hooks`; `attention-decision.ts` reads `background_tasks` from it. A `Stop`
  with a running or pending task the session is **waiting on** leaves the session at `working`
  and marks it deferred in an in-memory `Set` on `WsServer`. That is a task of type `shell`
  (backgrounded Bash, and also the Monitor tool and `until` loops), `subagent`, `workflow`,
  `teammate` or `cloud session`, or one naming a `server` (an MCP monitor or task). **A watched
  artifact is a `monitor` task with no `server` that lasts the session's whole life**, so it
  must not count: it pinned every session with a `⧉` watch at `working` until closed. Nor do
  Claude's housekeeping kinds (`dream`, `auto-mode scan`, `memory import`) or any kind not on
  the list: a wrong "Needs you" costs a glance, a wrong `working` hides a waiting session
  indefinitely. (Kinds read from the claude 2.1.310 Stop payload builder.) This is **not** an LLM judgement — the Stop payload carries the answer
  as data (`background_tasks`, `last_assistant_message`, `session_crons` — all undocumented,
  so read defensively; anything unexpected falls back to `needs-feedback`, i.e. the old
  behaviour). **Claude Code emits a `Notification` with `notification_type: 'idle_prompt'`
  exactly 60s after every `Stop` — even while a background task is still running** — so
  without suppressing that one on a deferred session the feature would silently die after a
  minute. Only `idle_prompt` is suppressed; permission prompts always get through. And
  `Pre`/`PostToolUse` must **keep** the deferral (they don't clear it): a background
  subagent's own tool calls fire them in the parent session after its `Stop`, and clearing
  there would re-open the 60s hole for the subagent case. The deferral `Set` is deliberately
  in-memory — losing it on restart costs one extra "Needs you", never a missed one.
  **`tarfa-hook.sh` posts only when the pane named by `$TMUX_PANE` has its own process among
  the script's ancestors.** `$TMUX`/`$TMUX_PANE` alone prove nothing: an untargeted
  `tmux display-message -p '#S'` resolves to the most-recently-active session, and Codex runs
  hooks in a shared daemon that kept the environment of whichever pane started it. Both stamped
  statuses onto unrelated workspaces. Changing the script means re-running `install-hooks` per
  machine (it copies it to `~/.tarfa/tarfa-hook.sh`).
  **A turn that ends right after a main-loop `SendMessage` defers the same way.** That is a
  session waiting on another Claude session's reply (a spawned child on its orchestrator, an
  orchestrator on its children; see the `tarfa-orchestrate` skill), not on the user. The fact
  is a second marker (`messagedLast`), set by a main-loop `PostToolUse` of
  `SendMessage`, cleared by the next main-loop tool call starting or finishing and by
  `UserPromptSubmit` (the reply arrives as one). Without the `PreToolUse` clear, a child that sent a
  progress note and started a long test read "Needs orchestrator" for the whole test. It must stay separate from the deferral `Set`, because tool calls keep
  the deferral but change this. Unlike the other two marks it is **durable**, an entry field in
  `status.json` (pruned with its entry), because it is what derives a child's
  `waitingOn: 'parent'` ("Needs orchestrator"), which the PWA and `tarfa ls` both show. Accepted
  cost: a child whose last act was its final report stays `working` until it is closed.
- **`install-hooks` also installs a kill guard (`tarfa-guard.sh`, a `PreToolUse` hook on `Bash`
  for Claude Code and Codex).** A workspace session once ran `pkill -f "x"`, which matches
  nearly every command line: it took down the tmux server, the agent and every other session in
  one second. Everything runs as one Linux user, so nothing at the OS level can stop that; a
  private PID namespace per pane would, but breaks `sudo` in workspaces and `tarfa-hook.sh`'s
  pane-ancestry check (the pane pid tmux reports would be outside the namespace). The guard
  refuses `pkill`, `killall`, `kill -1`, `xargs kill`, `kill $(pgrep|pidof …)` and `tmux
  kill-server`/`kill-session -a` without `-S`/`-L`, including behind `sudo`/`env`/`sh -c`, and
  tells the session to `pgrep -af` then `kill <pid>`. It acts only when `$TMUX_PANE` is set, and
  is an accident guard, not a boundary. Its splitter (awk, so it runs on macOS's bash 3.2 and
  BSD tools) keeps a quoted string whole, so `rg "pkill|killall"` or a commit message naming
  these commands is not refused (refusing those taught sessions to route around the hook), and
  checks a `sh -c` script as its own command line. It also refuses the two plain routes to
  another session's authority (docs/MESSAGING.md): a raw socket client (`nc`, `ncat`, `socat`,
  `curl`) whose command names a message socket (`cc-socks/`, `.tarfa/inbox/`,
  `app-server-control/`; a client on any other socket passes), and `tmux set`/`set-option`/
  `setw`/`set-window-option` of `@tarfa_parent` or `@tarfa_codex_thread` on the default server;
  it points at `tarfa send` and `tarfa spawn --child`. It parses the JSON without `jq`, like
  `tarfa-hook.sh`. Table-tested in `tarfa-guard.test.sh`; re-run `install-hooks` per machine,
  and re-trust the Codex hooks in `/hooks`.
- **Codex reports status through the same hook script, with `codex` as a third argument.**
  `install-hooks` also writes Codex's `hooks.json` where its home exists (`infrastructure/codex-home.ts`:
  `CODEX_HOME` from agent.env or the environment, else the login shell's, else `~/.codex`; the agent
  reads it once at startup, and the app-server socket is found there too, connected through its
  link's short `/tmp/codex-daemon-<uid>/` target since node refuses a socket path over 107 bytes); Codex runs nothing
  until the user trusts the hooks in `/hooks` (hash-keyed, so re-trust after a change). Three
  differences from Claude Code, all observed on Codex 0.162:
  - **Hooks run outside the pane unless Codex is started with `--no-daemon`**, which the create
    form adds. Under the shared daemon the hook posts the payload's `session_id` as `thread`
    instead of a session name, and `/hooks` maps it through `@tarfa_codex_thread`; a thread no
    workspace recorded changes nothing (`docs/MESSAGING.md`, "Codex delivery").
  - **A question is asynchronous.** `request_user_input_async`'s `PostToolUse` fires as soon as
    the question is shown, then the model sleeps on `clocksleep`; the answer arrives as a
    `UserPromptSubmit`. A third in-memory marker (`questionPending`) holds `needs-feedback`
    across those tool events. It is the opposite of the deferral (stay `needs-feedback` despite
    tool events, versus stay `working` despite `Stop`), so keep the two separate.
  - **Approval is `PermissionRequest`, with no `Notification`.** It fires under an automatic
    reviewer too, so an auto-approved call flashes "Needs you" for a second until `PostToolUse`.
    A subagent's request still maps to `needs-feedback`: the user is the one asked. `SessionEnd`
    is not registered: it can fire late, from a newer Codex process.
- **A subagent's tool calls must not stamp the parent workspace's status.** `PreToolUse`/
  `PostToolUse` fire in the **parent** session for a subagent's own tool calls, carrying an
  `agent_id`/`agent_type` pair that is absent on the main loop's calls. Mapping those to
  `working` meant that whenever a session sat blocked on a question with a background subagent
  still running, the subagent's next tool call (seconds later) silently overwrote the
  `needs-feedback` the block had just raised — so the workspace showed `working` with a prompt
  waiting on screen, indefinitely. `attentionDecision` now returns `status: null` for any tool
  event carrying an `agent_id`, leaving the parent's status alone. Read `agent_id` defensively;
  it is undocumented.
- **A pending multiple choice is read off the tool name, not a notification.** Claude blocks
  indefinitely on `AskUserQuestion`/`ExitPlanMode` waiting for the user to pick an option, and
  (from v2.1.200) these never auto-time-out. A `Notification` with
  `notification_type: 'permission_prompt'` *is* emitted for them on 2.1.215 — but a few seconds
  late and undocumented for `AskUserQuestion`, so it is not the primary signal. `PreToolUse` for
  those two tools maps straight to `needs-feedback`; the matching `PostToolUse` (which fires only
  once the user has answered) returns the session to `working`. Both checks are skipped for
  subagent calls, so a subagent's own question never speaks for the parent.
