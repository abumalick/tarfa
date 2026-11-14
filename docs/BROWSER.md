# Browser sessions for agents

Agents in a Tarfa workspace can drive headless browsers with
[agent-browser](https://github.com/vercel-labs/agent-browser) (a CDP CLI). Tarfa's browser
view discovers those sessions, streams them to the phone, and relays input back — so you can
watch an agent's browser, or take over to log in, from the PWA.

The browser view was built against agent-browser 0.31.x and depends on its stream wire
format. After upgrading agent-browser, re-check that session open/close, `get cdp-url`, and
the Tarfa browser view (stream attach + input) still work.

## Session naming — how Tarfa attaches a browser to a workspace

Name each session `<wsid>__<slug>`, where `<wsid>` is the workspace id (the tmux session
name, `tmux display-message -p '#S'`) and `<slug>` is a short task label. Compute the name
rather than hand-picking it, so the prefix is never dropped:

```bash
wsid=$(tmux display-message -p '#S' 2>/dev/null)   # empty outside a Tarfa tmux session
session="${wsid:+${wsid}__}login"                  # -> perch-fix-ui__login, or just "login"
```

- Tarfa attaches a session to a workspace **only** when its name is *exactly* `<wsid>` or
  starts with `<wsid>__` (`browser-session-owner.ts` on the agent, `browser-sessions.ts` in
  the PWA). Anything else shows as unattached in the home "Browser sessions" list.
- An attached session opens from the workspace's 🌐 icon (a picker when there are several),
  and closing the workspace closes its sessions.
- `__` (double underscore) is the delimiter and never appears in a workspace id, so keep the
  id verbatim before it. Outside a Tarfa workspace a plain `<slug>` is fine. Avoid the
  implicit `default` session.
- **A mis-named session can't be relinked.** Attachment is purely by name, so there is
  nothing to refresh; close it and reopen with the computed name.
- Sessions are isolated Chrome processes that outlive the CLI call. Close a session when
  done (closing its workspace closes it too):

  ```bash
  agent-browser --session "$session" open <url>
  agent-browser --session "$session" close
  ```

- **Never set `AGENT_BROWSER_*` variables on a session you want to see on the phone.**
  agent-browser relaunches a session whose launch settings differ from the calling command's
  (the idle timeout included), and the agent runs every command with no `AGENT_BROWSER_*`
  variable (`agent-browser-cli.ts`). A session opened with, say,
  `AGENT_BROWSER_IDLE_TIMEOUT_MS` is relaunched blank the moment the browser view attaches:
  the right page flashes, then the screen goes white. Machine-wide browser settings (a custom
  executable, init scripts) belong in agent-browser's own `~/.agent-browser/config.json`,
  which it reads whatever the caller's environment, so the agent and every shell resolve the
  same session. There is no idle auto-close from that file; closing is explicit.

## Cookies: fresh by default, per-site login opt-in

A default session gets a fresh temporary profile, deleted on close — no cookies, no history.
That is the right mode for almost all work. When a task genuinely needs a real login, open a
**per-site session** with `--restore`, which auto-saves that site's cookies + localStorage
on close and restores them on the next open, keyed by name:

```bash
site=github
agent-browser --session "${wsid:+${wsid}__}$site" --restore "$site" open "https://$site.com"
```

This separates two concerns:

- **`--session <wsid>__<site>` — attachment.** The live browser shows under the workspace's
  🌐 icon and closes with it.
- **`--restore <site>` — persistence.** The login is stored under the `<site>` key, not the
  session name, so one login is reused across every workspace instead of fragmenting into
  per-workspace copies.

Why not the alternatives:

- One shared state file for every site mixes unrelated logins into one blob; per-site keys
  isolate them.
- A `--profile <dir>` user-data-dir does not keep a login across restarts with
  Chrome for Testing: it doesn't flush HttpOnly/Secure session cookies on close, so the
  login silently disappears. `--restore` reads cookies over CDP instead of relying on the
  on-disk profile store, so it persists.

### Seeding a login (one-time, by a human)

Agents should not hold credentials or attempt logins. A person seeds each site once, through
Tarfa:

1. Start the per-site session (the command above), or ask the agent to.
2. Open it in Tarfa — the workspace's 🌐 icon, or the home **Browser sessions** list — and
   log in, completing 2FA. The input relay lets you type and tap from the phone.
3. Close the session; `--restore` saves the cookies. The next open is already logged in.
4. To refresh an expired login, repeat.

### Rules

- **Keep a per-site `--restore` session on its own site.** Navigating a session that
  carries a real login to untrusted pages hands that login to whatever the page can reach.
- Two workspaces driving the same site at once share one restore key; the last one to close
  wins on auto-save. Fine for stable login cookies.

## Security notes

- CDP ports and stream servers bind 127.0.0.1 only. Nothing is exposed on the tailnet
  directly; the browser view goes through the Tarfa agent's authenticated session.
- Saved `--restore` states hold live session cookies. Treat `~/.agent-browser/` like a
  credential store.

## Things not to simplify

- **Browser-view typing reads the hidden input's text, and every key event carries `text`.**
  Two causes made soft-keyboard typing in the browser view do nothing. The PWA forwarded only
  the hidden input's `keydown`, and an Android keyboard's is `Unidentified` (229) with the text
  delivered as a field edit; so `lib/browser-typing.ts` lets the browser apply each edit and
  sends `editMessages(sent, field)` (backspace to the common prefix, type the tail, per code
  point), like the terminal's Android adapter. Only keys that edit nothing go from `keydown`
  (Enter, Tab, arrows, Escape, Ctrl/Meta shortcuts, Backspace on an empty field); the field
  starts over on those, a page tap, the keyboard bar and blur. And agent-browser's stream
  (0.31.1) **silently drops an `input_keyboard` with no `text` field**, while Chrome acts on a
  named key only with `windowsVirtualKeyCode` (a Backspace without it fires a keydown and
  deletes nothing) and submits a form on Enter only with `text: '\r'`; so the keyboard bar's
  keys never worked either. `keyMessages` always sets `text` and the virtual key code; measured
  against a live session's stream socket, not assumed. The agent forwards the message verbatim.
- **Every browser command replays the launch env of the session it targets.** agent-browser
  (0.31.1) relaunches a session's browser when a command's launch config differs from the one
  that created it (headed, profile, executable, args, init scripts, proxy, user agent…), and
  restarts its daemon when the idle timeout or a policy differs. A session started on a
  persistent profile, headed under Xvfb (Google/Shopify/Cloudflare logins), came back as a
  profile-less `about:blank` on the first Tarfa command, so opening the viewer (it sends
  `set viewport`) logged it out. The CLI hands each setting to the daemon it spawns as an
  `AGENT_BROWSER_*` variable, so `procSessionLaunchEnv` reads `<session>.pid` →
  `/proc/<pid>/environ` (only when it says `AGENT_BROWSER_DAEMON=1` and names that session)
  and `execFileRunner` **replaces** the agent's inherited `AGENT_BROWSER_*` with it, plus
  `DISPLAY`: extending would keep a variable the session was created without (the service
  inherits an idle timeout and init scripts from the user's environment). Plumbing
  (`_DAEMON`, `_SESSION`, `_STREAM_PORT`, `_NAMESPACE`, `_SOCKET_DIR`) is never replayed;
  `_DAEMON` would make the CLI run as a daemon. With nothing to read (Tarfa's own `start`,
  macOS) the inherited env is kept, and Tarfa never imposes a setting of its own.
