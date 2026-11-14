# Workspaces: lifecycle, parking, ids and the tarfa CLI

How workspaces are created, closed, parked, recovered, named and linked, and the `tarfa` CLI that drives them. Each bullet records a decision; read it before changing that code.

- **Hidden folders are per-machine, file-based config — not a protocol/PWA feature.** A
  gitignored `~/.tarfa/hidden-folders.json` (JSON array of folder names) on each agent
  machine hides matching projects from workspaces, recent paths, and the folder picker
  (`is-hidden-path.ts`: any path segment equal to a listed name is filtered). Read fresh
  from disk on every call (`FileHiddenFoldersStore`) — no caching, so edits take effect
  immediately with no agent restart. Missing or malformed file → empty list (opt-in;
  filtering only activates once the file exists). Manage it directly on each machine (there's
  no CLI/PWA UI to edit it), and set it up separately per machine — nothing syncs it.
- **The Create Workspace command list is per machine: detected CLIs plus remembered ones.**
  The PWA sends `listLaunchers` each time the form opens (`askCreateData`) and the agent answers
  `launchers {detected, custom}`. `detected` is `claude`/`codex` resolved **through the login
  shell** (`$SHELL -lc 'command -v …'`) — the service's own PATH lacks `~/.local/bin`, so
  walking it would hide Claude. Only the shell's exit 1 means "absent": a failing profile, a
  timeout or an unstartable shell keeps the CLI offered, since hiding Claude would silently make
  Bash the form's default. A PATH set only in `.zshrc` is invisible to a login shell. Bash is always
  offered. `custom` is a gitignored `~/.tarfa/launchers.json` (capped at 20): a `create` carrying
  `remember: true` — set only when the Custom radio was used — adds its command after the
  workspace exists, unless it is exactly `bash`/`claude`/`codex` (so `claude --resume` typed as
  Custom is kept). A remembered command runs as typed, with no model picker; `forgetLauncher`
  removes one. An agent that predates this never answers, and the PWA keeps the fixed
  Claude/Codex/Bash list. Needs an agent restart per machine.
- **The create form's `--model` value must stay single-quoted.** `CreateWorkspace.svelte`
  builds `claude --model '<value>'`, and two Claude entries carry Claude Code's `[1m]`
  suffix — `opus[1m]` (the default) and `sonnet[1m]`. That suffix used to be what bought the
  1M window, the bare alias being the *smaller* 200K one despite looking canonical; Opus 5
  and Sonnet 5 are now natively 1M, so the CLI strips the suffix for them and it buys nothing.
  It is kept because it is what ships and works — the window is what matters here (Claude Code
  never errors at the context limit, it silently autocompacts, so a small window costs
  fidelity rather than raising an error anyone would notice), and re-testing the default
  launch command to win a cosmetic tidy is a bad trade. The suffix is **not** a safety net for
  a future non-native-1M model: on one of those the CLI passes it through as a request for the
  1M beta, which a model without a 1M window rejects — `claude-haiku-4-5[1m]` returns
  a 400 because Haiku 4.5 is a 200K model, which is also why Haiku is the one 200K entry in the picker. tmux runs the command string through the login shell, and brackets
  are a glob pattern there: under zsh an unmatched glob aborts the whole command line, so an
  unquoted `opus[1m]` means the session dies before `claude` ever starts — and because the
  command *is* the pane's process, the workspace vanishes from the list instantly. The quote
  is applied to **every** model, not just this one, so the next value someone adds can't
  reintroduce it; it lives at the build site rather than in `value`, which doubles as the
  radio's identity. `resumeCommand`'s whitespace split preserves it, so park/unpark is safe
  (guarded by a test). Verified against zsh through `tmux new-session`, not just in jsdom.
- **Workspace lifecycle log — a durable record of every closed workspace, agent-side only.**
  `WsServer` tracks each live workspace's last-known snapshot (`lastWorkspaces`, the same map
  that already drives rename/disappearance detection); whenever one stops existing it appends
  one JSON line — id, name, project path, machine id, created/closed timestamps, a reason
  (`closed-by-user` for an explicit close from the PWA or `tarfa close`, `exited` for a shell exit/crash/manual
  `tmux kill-session`), and the last known attention status — to a gitignored
  `~/.tarfa/workspace-log.jsonl` (`FileWorkspaceLogStore`). An explicit close snapshots via
  `WsServer.forgetWorkspace(id)` *before* killing the tmux session (tmux can't answer
  afterward) and falls back to a fresh tmux lookup if the workspace was closed within its
  first title-poll tick. The log write is best-effort (a failure must never fail the close
  or crash the poll's fire-and-forget interval). No PWA/UI, no protocol change; read the file
  by hand on the box. Log writes failing silently is accepted by design. A poll landing between the close's
  forget and its async tmux kill no longer logs a duplicate `exited`: `WsServer.closing` keeps it
  from taking the workspace back until tmux stops listing it (at most 10 s). Only an explicit close
  sets it: a park forgets the workspace too, but its parked record keeps it listed and an unpark
  revives the same id, so marking it would hide that workspace from the poll for good.
- **Parking a workspace — stop the session, keep the conversation.** Setting a workspace's
  status to `parked` (renamed from `postponed`) kills its tmux session to free the `claude`
  process, and snapshots what's needed to revive it — id, name, path, command, and the
  captured `claudeSessionId` — into a gitignored `~/.tarfa/parked.json`
  (`FileParkedStore`). `listWorkspaces` unions parked records with live tmux sessions, so
  a parked workspace stays in the list with no protocol change, no new `Workspace` field,
  and no PWA logic — and the disappearance poll never sees it vanish, so it logs no
  spurious `exited`. Opening it recreates the session with `--resume` injected into the
  **original** command (`claude --model 'opus[1m]' --resume <id>`, preserving flags), then
  clears the record. **The name is put back and held:** a workspace's name is its pane title,
  and the resumed Claude writes a new one at once (the bare id for a `--name perch-…` spawn, a
  fresh summary otherwise), so unpark sets `✳ <parked name>` (the glyph is what makes
  `deriveWorkspaceName` trust it) and locks it with `allow-set-title off` on tmux 3.5+. The lock
  applies to **every** unpark: the record cannot tell an explicit `--title` from a name Claude
  chose, and a frozen name the user knows beats one that moves to something they do not; the
  cost is that an unparked workspace stops renaming itself. On an older tmux the title is set
  unlocked and may not hold: the spawn's `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` prefix would cover
  only the left half of `<cmd> --resume <id> || exec <cmd>`, and it silences OSC 7501 too.
  `tarfa unpark <id>...` opens parked workspaces from a shell through the same path, by asking
  the running agent (`POST /unpark`, the hooks secret): the agent holds `status.json` in memory
  and writes `parked.json`, so a CLI writing either would race it, and only the agent tells the
  phones. **The parked record — not `status === 'parked'` — is the source of
  truth for behavior:** the rename migration relabels pre-existing live workspaces to
  `parked` with no record, so status-keyed logic would try to recreate a live session on
  attach. The unpark command carries a `|| exec <original>` tail because
  `claude --resume <unknown-id>` is a hard error that would otherwise destroy the
  workspace. **A known `claudeSessionId` is required to park at all** — without one the
  conversation could not be resumed, so parking would free the resources and silently throw
  the conversation away, which is worse than not parking; `parkWorkspace` returns
  `not-restorable` and the agent sends an `error` the PWA shows as a dismissible banner
  (`ActionErrorBanner`, fed by `store.actionError` — the fallback arm of the `error` handler,
  for refusals no view owns). The id arrives with the first Claude Code hook event, so a
  workspace becomes parkable once it is used; non-Claude workspaces (Codex, zsh) cannot be
  parked. Codex hooks report status too, but their `session_id` is never recorded
  (`applyHookEvent` skips it for `agent: 'codex'`): unparking would run `claude --resume` on it. `FileStatusStore`
  migrates the old `postponed` literal on read, since nothing syncs config between machines.
  At agent startup, `reconcileParked` kills any tmux session whose id collides with a
  parked record — the one case is tmux-continuum resurrecting a parked id as a Claude-less
  shell on restart — so the parked record stays the single source of truth. Requires an
  agent rebuild + restart per machine.
- **Workspaces lost with the tmux server come back parked.** Everything dies with the tmux
  server — a reboot, or a session's own `pkill -f <pattern>` matching `tmux -D` — usually with
  the agent beside it, so the disappearance poll never sees them go, and the startup prune then
  drops their status entries (and session ids). `trackLiveWorkspaces` keeps a gitignored
  `~/.tarfa/live.json` (`FileLiveSnapshotStore`): every live workspace in the parked-record shape,
  plus the server's identity (`TmuxPort.serverId`, `#{pid}:#{start_time}` from
  `display-message`, which an empty but running server still answers). It runs at startup
  **before** `reconcileParked` and the prune, and on every poll tick **before** `pollTitles`,
  connected client or not. **The server identity is the discriminator:** a workspace missing
  while the same server runs is an ordinary exit and is just dropped; one missing after the
  identity changed (or with no server) is logged `server-lost` and, when its Claude session id
  is known, written to `parked.json`, so the PWA lists it as parked and opening it resumes the
  conversation. A session present on the new server without `@tarfa_command` counts as lost too
  (tmux-resurrect's bare shell), and `reconcileParked` kills it. An explicit close or park drops
  the entry at once (`forgetWorkspace`). Accepted edge: on a machine whose tmux server exits
  with its last session, that last workspace exiting on its own comes back parked; close it.
  Nothing reopens on its own: starting every lost `claude` at once is a real memory cost.

- **Workspace ids are `<folder>-<n>`, the smallest free n** (`short-workspace-ids.ts`), so one
  is easy to say aloud; older workspaces keep their `perch-<6 hex>`. Three things follow, don't
  undo any: **Tarfa finds its sessions by the `@tarfa_command` it sets on each**, not by name
  (`listSessions` also takes the old prefix, for a tmux-resurrect shell, which has no marker;
  `reconcileParked` looks parked ids up by name for the same reason; such a shell under a new id
  whose workspace had no Claude session id to park stays invisible, holding its name). **tmux
  matches a `-t` name as a prefix** when none has it exactly, and `perch-1` is a prefix of
  `perch-10`, so every target goes through `exactTarget` (`=name:`); a bare `-t <id>` once
  killed the wrong workspace. **An id is claimed by creating its session**
  (`createWithFreshId` retries on tmux's "duplicate session"), and a spawn's brief and hook files
  are named by a nonce, never the id, since two spawns into one folder race for the same number. **A number is reused, so
  nothing keyed by an id may outlive its workspace:** a close or exit calls
  `WsServer.dropWorkspaceState` (the status entry with its Claude session id, and the in-memory
  marks; `dropGoneWorkspaces` on every tick catches exits with no phone connected), and the
  allocator also skips any id still in `status.json` or `parked.json`, any tmux
  session at all, and any live Claude session's name (Claude names an unnamed session
  `<folder>-<2 hex>`, a valid id). **A Create-form workspace gets no `--name`:** measured on
  Claude Code 2.1.316, a named session writes its name as its title and never a summary, so the
  messaging address stays Claude's own and `tarfa spawn`'s explicit `--name <id>` is the
  exception. Claude's `/rename` writes a title with no glyph, which `deriveWorkspaceName` takes
  for a `claude` pane (but not `Claude Code` or the id; the adapter reads tmux's host-name
  default as no title).

- **The `tarfa` CLI and the orchestrator → child link.** `deploy/install-cli.sh` links
  `deploy/tarfa-cli.sh` to `~/.local/bin/tarfa` (and, for one release, `~/.local/bin/perch` to
  `tarfa`) on each machine, so any session in any repo can
  run `tarfa spawn [--child]`, `tarfa ls [--mine|--role|--path]`, `tarfa peek <id>`, `tarfa wait <id>...`,
  `tarfa unpark <id>...`, `tarfa close <id>...`, `tarfa rename [<id>] <title>` and `tarfa link [<id>]`. `rename` sets `✳ <title>` locked, as unpark does, so Claude
  stops renaming that workspace; without an id it renames the caller's own. The first three read tmux and the `~/.tarfa` stores directly (read-only, no agent.env needed)
  and skip the GitHub lookup, so `ls` answers in a fraction of a second; `unpark` asks the
  running agent (parking section). **Orchestration is explicit:** a plain
  `tarfa spawn` is an ordinary workspace; `--child` records the caller's **workspace id** (never
  its Claude session name, which changes on rename) as the tmux option `@tarfa_parent`, read
  into `Workspace.parentId`. The link is carried in `parked.json` and `live.json` and re-set by
  unpark, so it survives park/unpark and a lost tmux server. A child whose turn ended right
  after messaging its parent gets `waitingOn: 'parent'` (the durable `messagedLast` mark): its
  status stays `working`, the PWA labels it "Needs orchestrator" and `tarfa ls` shows
  `needs-orchestrator`. The PWA nests one level of children under a listed, unparked parent on
  the same machine (`core/nest-workspaces.ts`), folded by default; a group ranks by its most
  urgent member, and Next walks children of folded parents too.
  **`tarfa close <id>...` is the phone's close** (`POST /close`, the hooks secret;
  `application/retire-workspace.ts` is shared with the phone's path, so the two cannot drift): the
  snapshot, the kill, the `closed-by-user` log line, the state drop, the reply, then the scope reap.
  The agent refuses an id that names no workspace, and the CLI the caller's own workspace (the kill
  would take the command with it). **It is deliberately not limited to the
  caller's children:** one Linux user can `tmux kill-session` anything anyway, the phone and
  `unpark` take any id, and a limit would stop the owner closing from a plain shell.
  **`tarfa wait <id>... [--timeout <s, at least 10>]` blocks until one stops working** and prints `<id> <state>`
  per stopped workspace, polling the same read-only stores as `ls` every 2 s, hidden folders
  included (a hidden child is not gone). Exit 0 a stop, 124 the timeout, 2 usage, 1 otherwise.
  Things not to "simplify" (`application/wait-tracker.ts`): **a stop already there when the wait
  began is reported after 10 s, not ignored.** Waiting for a change instead would hang for good on
  a child that hit a permission prompt before the wait started, which is what the wait is for; the
  10 s covers the old state lingering after a `tarfa send` (measured: at most 6.7 s for a recipient
  able to take the message, while a longer one is blocked on a prompt and is reporting truly).
  **A stop seen after working must last two polls:** a queued message's prompt lands 0.1 s after
  the `Stop` of the turn it waited behind. **`needs-orchestrator` always takes the 10 s:** the mark
  stands from the send until the next tool starts, while the model may be thinking on. **`idle` under 60 s old counts as starting**, since a
  workspace with no status entry reads `idle` until its first hook; past that it is reported, so a
  child stuck before its first hook cannot hang the wait. **`gone` and `parked` report at once.**
  **tmux listing no session at all on the first look is an error, not `gone`:** tmux says
  `error connecting to` for a socket a Codex sandbox blocks too, which `isNoServer` reads as no
  server, and every child would read as gone.
- **Workspace links open the app on one workspace** (`tarfa link [<id>] [--pwa <origin>]`, for a
  session to hand the owner in its terminal or a chat message). The link is
  `<TARFA_PWA_ORIGIN>/#open?k=<agent key>&w=<workspace id>` (`workspaceLink` in contracts): the
  machine is named by its agent key, the one thing every phone paired with it shares (each phone's
  entry id is its own). The CLI only reads (`readAgentPublicKey`, never `loadOrCreateAgentKeys`),
  and refuses an id it cannot list or one in a hidden folder, which phones never see. The PWA takes
  the fragment at launch (read before `replaceState`, as a pairing link), on `hashchange` (an
  Android app already open gets the link as a same-page navigation, with no reload), from a tap in
  the app (this origin only) and from the paste field. Things not to "simplify"
  (`core/workspace-link-open.ts`, `store.requestWorkspaceOpen`): **only a list that arrived after
  the link proves a workspace gone** (a resumed app's list predates the workspace it was told
  about), so the request also probes the machine and asks for `list`; **it is navigation only**
  (never switches an entry on, pairs or unparks beyond what a tap does) and **gives way** to
  anything the user opens while it waits, then gives up after `RECONNECT_GRACE_MS`. On iOS outside
  the Home Screen app the link is held (`OpenInAppFirst`: copy, then paste in the app). Ids are
  reused, so an old link may open a newer workspace of the same id: accepted.
  **Inside a terminal a bare id is already a link** (`core/workspace-id-links.ts`, a link provider):
  one a listed, unparked workspace has, other than the open one, opens it on a tap. xterm underlines
  a link only under a hovering pointer, so `lib/workspace-id-underlines.ts` keeps a bar drawn under
  each in a layer of its own, redrawn per frame at most from `onRender`/`onScroll`/`onResize` and on
  a list change. **Not xterm's decorations:** they exist only in the normal buffer, and a tmux
  client draws in the alternate one. The skills tell sessions to write the bare id in the terminal
  and add `tarfa link` anywhere else.
- **Closing a workspace reaps the pane's systemd scope — and acknowledges before it does.**
  tmux (built with systemd support) puts every pane it spawns in its own transient
  `tmux-spawn-<uuid>.scope`. `tmux kill-session` only SIGHUPs the pane's process **group**, so
  anything that called `setsid()` — a backgrounded dev server, or a self-daemonizing tool like
  `adb`'s fork-server or `Xvfb` — survives with no tmux session left to find it by. Left alone,
  such scopes accumulate indefinitely, holding memory/swap and squatting localhost ports.
  `closeWorkspace` resolves the pane's scope **before** the kill (`/proc/<pid>/cgroup` vanishes
  with the process, so afterwards there is nothing to read) and returns it; `reapWorkspaceScope`
  stops it with `systemctl --user stop`. `SystemdScopeReaper` **refuses any unit that is not
  `tmux-spawn-<uuid>.scope`** — a pane under a tmux built without systemd support sits in
  `tarfa-agent.service`, and stopping that would kill the agent itself. Linux-only by
  construction: on macOS `scopeForPid` returns null and the leak remains.
  **Two orderings carry the design.** Claude Code exits gracefully on SIGTERM as well as SIGHUP
  (verified: its `~/.claude/sessions/<pid>.json` registry entry, key and socket are all removed;
  only SIGKILL leaves a stale entry), so the scope stop cannot strand a session — but the tmux
  kill must still come first. And the `closed` reply is sent **before** the slow tail
  (`finishClose` — the scope stop, then the agent-browser cascade, which waits on a Chrome
  shutdown). Don't move either back in front of the acknowledgement: everything after the kill
  only touches the local machine, and waiting on it is what made the phone's close button feel
  hung. Reaping is best-effort at every layer — a workspace must still close on a machine where
  none of this works. There is no exclusion list, so a shared daemon started from a workspace
  (the `adb` fork-server is the one that bites) dies with it; re-running `adb connect` is the cost.
